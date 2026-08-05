'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';
import WhatsAppLinkPanel from '../../../components/whatsapp/WhatsAppLinkPanel';
import { useWhatsAppConnection } from '../../../components/whatsapp/WhatsAppConnectProvider';
import ConnectionStatus from '../../../components/shared/ConnectionStatus';
import FriendlyError from '../../../components/ui/FriendlyError';
import { useSocket } from '../../../hooks/useSocket';
import { useLanguage } from '../../../components/providers/I18nProvider';
import { useDirection } from '../../../hooks/useDirection';
import LanguageSwitcher from '../../../components/ui/LanguageSwitcher';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Settings2, Globe, CheckCircle2, MessageCircle,
  User, LogOut, SlidersHorizontal,
  Wifi, WifiOff, RefreshCw,
  ChevronRight, ShieldCheck, Eye, EyeOff, Loader, Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SIMPLE_ROLE_LABEL, SIMPLE_ROLE_BADGE, toSimpleRole } from '@/lib/roles';

type Section = 'whatsapp' | 'account' | 'password' | 'language';

function initials(name?: string | null, email?: string | null): string {
  if (name) return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (email) return email[0].toUpperCase();
  return '?';
}

export default function SettingsPage() {
  const { data: session, status: sessionStatus } = useSession();
  const { t } = useTranslation('settings');
  const { language } = useLanguage();
  const { isRTL } = useDirection();
  const searchParams = useSearchParams();

  // Deep-link support: /settings?section=whatsapp opens the right tab straight away
  // (the global connect banner + dashboard CTA both link here).
  const sectionParam = searchParams.get('section') as Section | null;
  const validSections: Section[] = ['whatsapp', 'account', 'password', 'language'];
  const [activeSection, setActiveSection] = useState<Section>(
    sectionParam && validSections.includes(sectionParam) ? sectionParam : 'whatsapp',
  );

  // ── WhatsApp state ────────────────────────────────────────────────────────
  //
  // The pairing half (QR, expired-pairing flag, refresh) comes from the shell's
  // shared handshake. This page used to run its own, which meant its "New QR
  // code" button issued a second `POST /connect` against a socket the shared one
  // was already pairing — each wiping the other's credentials mid-handshake.
  // What stays local is everything the shared connector has no concept of:
  // warm-up, session reset, and the detailed error read-out.
  const { refreshQr } = useWhatsAppConnection();
  const [status, setStatus]               = useState<'connected' | 'disconnected' | 'connecting'>('disconnected');
  const [connectedPhone, setConnectedPhone] = useState<string | null>(null);
  const [whatsAppError, setWhatsAppError] = useState<string>('');
  const [waLoading, setWaLoading]         = useState(false);
  const [warmupEnabled, setWarmupEnabled] = useState(false);
  const [warmupSaving, setWarmupSaving]   = useState(false);

  // ── Password change state ──────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword]   = useState('');
  const [newPassword, setNewPassword]           = useState('');
  const [confirmPassword, setConfirmPassword]   = useState('');
  const [passwordError, setPasswordError]       = useState('');
  const [passwordSuccess, setPasswordSuccess]   = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword]   = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // ── Fetchers ──────────────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.get('/api/whatsapp/status');
      setStatus(data.status);
      setConnectedPhone(data.connectedPhone ?? null);
      if (typeof data.session?.warmupEnabled === 'boolean') {
        setWarmupEnabled(data.session.warmupEnabled);
      }
      const e = data?.error;
      if (e?.statusCode || e?.reason || e?.message) {
        const parts = [
          e.statusCode ? `Status ${e.statusCode}` : null,
          e.reason     ? `Reason ${e.reason}` : null,
          e.message    ? e.message : null,
        ].filter(Boolean);
        setWhatsAppError(parts.join(' — '));
      } else {
        setWhatsAppError('');
      }
    } catch (err) {
      setWhatsAppError(err instanceof Error ? err.message : 'Failed to fetch status');
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === 'loading' || sessionStatus !== 'authenticated') return;
    fetchStatus();
    const iv = setInterval(fetchStatus, 5000);
    return () => clearInterval(iv);
  }, [sessionStatus, fetchStatus]);

  useSocket('wa:status', fetchStatus);

  // ── Handlers ──────────────────────────────────────────────────────────────
  //
  // Anything that starts a pairing goes through the shared connector's
  // `refreshQr`, so this page can never be handshaking against a socket the rest
  // of the shell is already pairing with.
  const handleConnect = async () => {
    setWaLoading(true);
    try {
      setWhatsAppError('');
      setStatus('connecting');
      await refreshQr();
      await fetchStatus();
    } catch (err) {
      setWhatsAppError(err instanceof Error ? err.message : 'Failed to connect');
    } finally { setWaLoading(false); }
  };

  const handleDisconnect = async () => {
    setWaLoading(true);
    try {
      await api.post('/api/whatsapp/disconnect', {});
      setStatus('disconnected');
      setConnectedPhone(null);
    } catch {} finally { setWaLoading(false); }
  };

  const handleWarmupToggle = async (enabled: boolean) => {
    setWarmupSaving(true);
    try {
      await api.patch('/api/whatsapp/session-settings', { warmupEnabled: enabled });
      setWarmupEnabled(enabled);
    } catch {} finally { setWarmupSaving(false); }
  };

  const handleResetSession = async () => {
    setWaLoading(true);
    try {
      setWhatsAppError('');
      setStatus('disconnected');
      setConnectedPhone(null);
      await api.post('/api/whatsapp/reset-auth', {});
      await refreshQr();
      setStatus('connecting');
      await fetchStatus();
    } catch (err) {
      setWhatsAppError(err instanceof Error ? err.message : 'Failed to reset');
    } finally { setWaLoading(false); }
  };

  // ── Password change handler ───────────────────────────────────────────────
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError(t('password.errorMessages.allFieldsRequired'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError(t('password.errorMessages.passwordMismatch'));
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError(t('password.errorMessages.passwordTooShort'));
      return;
    }

    if (currentPassword === newPassword) {
      setPasswordError(t('password.errorMessages.passwordSame'));
      return;
    }

    setChangingPassword(true);
    try {
      await api.post('/api/auth/change-password', {
        currentPassword,
        newPassword,
      });
      setPasswordSuccess(t('password.successMessage'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(''), 3000);
    } catch (err: any) {
      const errorMsg = err?.response?.data?.error;
      if (errorMsg?.includes('incorrect')) {
        setPasswordError(t('password.errorMessages.invalidCurrent'));
      } else {
        setPasswordError(errorMsg || t('password.errorMessages.generic'));
      }
    } finally {
      setChangingPassword(false);
    }
  };

  // ── Nav items ─────────────────────────────────────────────────────────────
  const navItems: { id: Section; icon: React.ElementType; label: string }[] = [
    { id: 'whatsapp',     icon: MessageCircle,      label: t('tabs.whatsapp') },
    { id: 'account',      icon: User,               label: t('tabs.account') },
    { id: 'password',     icon: ShieldCheck,        label: language === 'ar' ? t('password.title', { defaultValue: 'كلمة المرور' }) : t('password.title', { defaultValue: 'Password' }) },
    { id: 'language',     icon: Globe,              label: t('tabs.language') },
  ];

  // ── Content renderers ─────────────────────────────────────────────────────
  function WhatsAppSection() {
    const statusConfig = {
      connected:    { color: 'text-[#25D366]', bg: 'bg-[#25D366]/10', border: 'border-[#25D366]/30', dot: 'bg-[#25D366]', icon: Wifi },
      // Not red. Having no number linked is a setup step, not a fault — and this
      // card sits directly above the form that resolves it.
      disconnected: { color: 'text-gray-600 dark:text-[#8696A0]', bg: 'bg-gray-100 dark:bg-white/5', border: 'border-gray-200 dark:border-white/10', dot: 'bg-gray-400', icon: WifiOff },
      connecting:   { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', dot: 'bg-amber-400', icon: RefreshCw },
    }[status];

    const StatusIcon = statusConfig.icon;

    return (
      <div className="space-y-4">
        {/* Status card */}
        <div className={cn('rounded-2xl border p-5', statusConfig.bg, statusConfig.border)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', statusConfig.bg, 'border', statusConfig.border)}>
                <StatusIcon className={cn('h-5 w-5', statusConfig.color, status === 'connecting' && 'animate-spin')} />
              </div>
              <div>
                <p className={cn('font-semibold', statusConfig.color)}>
                  {t(`whatsapp.status.${status}`)}
                </p>
                {status === 'connected' && connectedPhone && (
                  <p className="text-xs text-gray-500 mt-0.5 font-mono dark:text-[#8696A0]">{connectedPhone}</p>
                )}
                {status === 'disconnected' && (
                  <p className="text-xs text-gray-500 mt-0.5 dark:text-[#8696A0]">{t('whatsapp.noQR')}</p>
                )}
              </div>
            </div>
            <span className="relative flex h-2.5 w-2.5">
              {status === 'connected' && (
                <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', statusConfig.dot)} />
              )}
              <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', statusConfig.dot)} />
            </span>
          </div>
        </div>

        {/* Error — friendly, actionable explanation. Action is hidden since the
            connect controls live right here on this page.
            Suppressed while connected-less by design: the server no longer
            reports pairing-cycle closes as account errors, and anything left is
            worth reading. */}
        {whatsAppError && (
          <FriendlyError error={whatsAppError} hideAction compact onRetry={handleConnect} />
        )}

        {/* Linking — the same panel the dashboard and the connect popup render,
            so both routes (scan, or type a code) behave identically wherever the
            user happens to be looking. */}
        {status !== 'connected' && (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-white/10 dark:bg-[#202C33]">
            {/* Not "scan this QR code" — on a phone there is no QR on screen to
                scan, and the panel decides which route to offer. */}
            <p className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">
              {t('whatsapp.linkTitle', { defaultValue: 'Connect your WhatsApp' })}
            </p>
            <p className="mb-4 text-xs leading-relaxed text-gray-500 dark:text-[#8696A0]">
              {t('whatsapp.linkBody', {
                defaultValue: "Enter your number and we'll give you a code to type into WhatsApp.",
              })}
            </p>
            <WhatsAppLinkPanel size="lg" />
          </div>
        )}

        {/* Warm-up toggle */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-[#202C33]">
          <div className="flex items-start gap-3">
            <div className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
              warmupEnabled
                ? 'bg-amber-500/15 text-amber-500'
                : 'bg-[#25D366]/10 text-[#25D366]',
            )}>
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">{t('whatsapp.warmup.label')}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-[#8696A0]">{t('whatsapp.warmup.description')}</p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={warmupEnabled}
                  disabled={warmupSaving}
                  onClick={() => handleWarmupToggle(!warmupEnabled)}
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/50 disabled:opacity-50 disabled:cursor-not-allowed',
                    warmupEnabled ? 'bg-amber-500' : 'bg-gray-200 dark:bg-white/20',
                  )}
                >
                  <span className={cn(
                    'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                    warmupEnabled ? 'translate-x-5' : 'translate-x-0.5',
                  )} />
                </button>
                <span className={cn(
                  'text-xs font-medium',
                  warmupEnabled ? 'text-amber-500' : 'text-[#25D366]',
                )}>
                  {warmupSaving ? t('whatsapp.warmup.saving') : warmupEnabled ? t('whatsapp.warmup.on') : t('whatsapp.warmup.off')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          {status !== 'connected' && (
            <>
              <Button
                onClick={handleConnect}
                disabled={waLoading || status === 'connecting'}
                className="gap-2 bg-[#25D366] text-black hover:bg-[#128C7E] hover:text-white"
              >
                <Wifi className="h-4 w-4" />
                {t('whatsapp.connect')}
              </Button>
              <Button
                onClick={handleResetSession}
                disabled={waLoading}
                variant="outline"
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                {t('whatsapp.resetSession')}
              </Button>
            </>
          )}
          {status === 'connected' && (
            <Button
              onClick={handleDisconnect}
              disabled={waLoading}
              variant="destructive"
              className="gap-2"
            >
              <WifiOff className="h-4 w-4" />
              {t('whatsapp.disconnect')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  function AccountSection() {
    const name  = session?.user?.name;
    const email = session?.user?.email;
    const role  = (session?.user as any)?.role ?? 'AGENT';

    return (
      <div className="space-y-5">
        {/* Profile card */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 flex items-center gap-4 dark:border-white/10 dark:bg-[#202C33]">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#25D366] to-[#128C7E] text-lg font-bold text-white shadow-[0_4px_12px_rgba(37,211,102,0.3)]">
            {initials(name, email)}
          </div>
          <div className="min-w-0 flex-1">
            {name && <p className="truncate text-base font-semibold text-gray-900 dark:text-white">{name}</p>}
            <p className="truncate text-sm text-gray-500 dark:text-[#8696A0]">{email}</p>
            <span className={cn('mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SIMPLE_ROLE_BADGE[toSimpleRole(role)])}>
              {t(`team.roles.${toSimpleRole(role)}`, { defaultValue: SIMPLE_ROLE_LABEL[toSimpleRole(role)] })}
            </span>
          </div>
        </div>

        {/* Sign out */}
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
          <p className="mb-3 text-sm font-medium text-gray-900 dark:text-white">{t('account.signOutConfirm.title')}</p>
          <p className="mb-4 text-xs text-gray-500 dark:text-[#8696A0]">{t('account.signOutConfirm.message')}</p>
          <Button
            onClick={() => signOut()}
            variant="destructive"
            className="gap-2"
          >
            <LogOut className="h-4 w-4" />
            {t('account.signOut')}
          </Button>
        </div>
      </div>
    );
  }

  function PasswordSection() {
    const { t: tPass } = useTranslation('settings');

    return (
      <form onSubmit={handleChangePassword} className="space-y-6 max-w-2xl">

        {/* Password fields grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Current password - Full width on mobile */}
          <div className="md:col-span-2">
            <label htmlFor="current-password" className="block text-sm font-semibold text-gray-900 dark:text-white mb-2.5 flex items-center gap-2">
              <Lock className="h-4 w-4 text-[#25D366]" />
              {tPass('password.currentPassword')}
            </label>
            <div className="relative group">
              <input
                id="current-password"
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={changingPassword}
                className="w-full px-4 py-3 pr-12 rounded-xl border border-gray-300/60 bg-white/50 text-sm text-gray-900 placeholder:text-gray-500 outline-none transition-all duration-200 hover:bg-white/70 dark:hover:bg-white/10 focus:border-[#25D366] focus:ring-2 focus:ring-[#25D366]/30 disabled:opacity-50 disabled:cursor-not-allowed dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-[#8696A0]"
                placeholder={tPass('password.currentPasswordPlaceholder')}
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
                disabled={changingPassword}
                aria-label={showCurrentPassword ? 'Hide password' : 'Show password'}
              >
                {showCurrentPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {/* New password */}
          <div>
            <label htmlFor="new-password" className="block text-sm font-semibold text-gray-900 dark:text-white mb-2.5 flex items-center gap-2">
              <Lock className="h-4 w-4 text-[#25D366]" />
              {tPass('password.newPassword')}
            </label>
            <div className="relative group">
              <input
                id="new-password"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={changingPassword}
                className="w-full px-4 py-3 pr-12 rounded-xl border border-gray-300/60 bg-white/50 text-sm text-gray-900 placeholder:text-gray-500 outline-none transition-all duration-200 hover:bg-white/70 dark:hover:bg-white/10 focus:border-[#25D366] focus:ring-2 focus:ring-[#25D366]/30 disabled:opacity-50 disabled:cursor-not-allowed dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-[#8696A0]"
                placeholder={tPass('password.newPasswordPlaceholder')}
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
                disabled={changingPassword}
                aria-label={showNewPassword ? 'Hide password' : 'Show password'}
              >
                {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {/* Confirm password */}
          <div>
            <label htmlFor="confirm-password" className="block text-sm font-semibold text-gray-900 dark:text-white mb-2.5 flex items-center gap-2">
              <Lock className="h-4 w-4 text-[#25D366]" />
              {tPass('password.confirmPassword')}
            </label>
            <div className="relative group">
              <input
                id="confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={changingPassword}
                className="w-full px-4 py-3 pr-12 rounded-xl border border-gray-300/60 bg-white/50 text-sm text-gray-900 placeholder:text-gray-500 outline-none transition-all duration-200 hover:bg-white/70 dark:hover:bg-white/10 focus:border-[#25D366] focus:ring-2 focus:ring-[#25D366]/30 disabled:opacity-50 disabled:cursor-not-allowed dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-[#8696A0]"
                placeholder={tPass('password.confirmPasswordPlaceholder')}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
                disabled={changingPassword}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              >
                {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Error message */}
        {passwordError && (
          <div className="animate-in fade-in slide-in-from-top-2 rounded-xl border border-red-200/50 bg-red-50/80 backdrop-blur px-4 py-3 dark:border-red-500/30 dark:bg-red-500/10">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">{passwordError}</p>
          </div>
        )}

        {/* Success message */}
        {passwordSuccess && (
          <div className="animate-in fade-in slide-in-from-top-2 rounded-xl border border-[#25D366]/30 bg-[#25D366]/10 backdrop-blur px-4 py-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-[#25D366] flex-shrink-0" />
              <p className="text-sm font-medium text-[#25D366]">{tPass('password.successMessage')}</p>
            </div>
          </div>
        )}

        {/* Submit button */}
        <Button
          type="submit"
          disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
          className="w-full gap-2 bg-gradient-to-r from-[#25D366] to-emerald-600 text-white hover:from-[#25D366]/90 hover:to-emerald-600/90 shadow-lg shadow-[#25D366]/30 hover:shadow-[#25D366]/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 py-3 rounded-xl font-semibold text-base"
        >
          {changingPassword ? (
            <>
              <Loader className="h-4 w-4 animate-spin" />
              {tPass('password.changing')}
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4" />
              {tPass('password.changeButton')}
            </>
          )}
        </Button>

        {/* Security notice */}
        <div className="rounded-xl border border-blue-200/50 bg-blue-50/80 backdrop-blur px-4 py-3 dark:border-blue-500/30 dark:bg-blue-500/10">
          <div className="flex gap-3">
            <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-blue-800 dark:text-blue-300">
              {tPass('password.securityNotice')}
            </p>
          </div>
        </div>
      </form>
    );
  }

  function LanguageSection() {
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-[#8696A0]">{t('language.description')}</p>

        <LanguageSwitcher variant="full" className="max-w-sm" />

        <div className={cn(
          'flex items-center gap-3 rounded-xl border p-4',
          'border-[#25D366]/30 bg-[#25D366]/8',
        )}>
          <CheckCircle2 className="h-5 w-5 text-[#25D366] shrink-0" />
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {language === 'ar' ? t('language.languages.ar') : t('language.languages.en')}
            </p>
            <p className="text-xs text-gray-500 mt-0.5 dark:text-[#8696A0]">
              {language === 'ar' ? t('language.direction.rtl') : t('language.direction.ltr')}
            </p>
          </div>
        </div>

        <p className="text-xs text-gray-500 dark:text-[#8696A0]">{t('language.restartNotice')}</p>
      </div>
    );
  }

  const sectionTitles: Record<Section, string> = {
    whatsapp:      t('whatsapp.title'),
    account:       t('account.title'),
    password:      t('password.title'),
    language:      t('language.title'),
  };

  const sectionDesc: Record<Section, string> = {
    whatsapp:      t('whatsapp.description'),
    account:       t('account.description'),
    password:      t('password.description'),
    language:      t('language.description'),
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* ── Header ── */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_8px_20px_rgba(0,0,0,0.2)] dark:border-white/10 dark:bg-[#111B21]">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#25D366]/30 bg-[#25D366]/10 px-3 py-1.5 text-xs font-medium text-[#25D366]">
          <Settings2 className="h-3.5 w-3.5" />
          {t('badge')}
        </div>
        <h1 className="mt-3 text-3xl font-semibold text-gray-900 dark:text-white">{t('title')}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500 dark:text-[#8696A0]">{t('subtitle')}</p>
      </section>

      {/* ── Mobile nav ── */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 md:hidden scrollbar-none">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all',
                active
                  ? 'border-[#25D366]/30 bg-[#25D366]/10 text-[#25D366]'
                  : 'border-gray-200 bg-gray-50 text-gray-500 hover:text-gray-900 dark:border-white/10 dark:bg-[#202C33] dark:text-[#8696A0] dark:hover:text-white',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {item.label}
            </button>
          );
        })}

        {/* Contact fields live on their own route, not as a section of this page. */}
        <Link
          href="/settings/custom-fields"
          className="flex shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 transition-all hover:text-gray-900 dark:border-white/10 dark:bg-[#202C33] dark:text-[#8696A0] dark:hover:text-white"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
          {t('customFields.title', { defaultValue: 'Contact fields' })}
        </Link>
      </div>

      {/* ── Main layout ── */}
      <div className="flex flex-col md:flex-row gap-4 md:gap-6 items-start">

        {/* ── Sidebar nav (desktop) ── */}
        <aside className="hidden md:flex w-52 shrink-0 flex-col gap-1 rounded-2xl border border-gray-200 bg-white p-2 dark:border-white/10 dark:bg-[#111B21]">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                  active
                    ? 'bg-[#25D366]/10 text-[#25D366]'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-[#8696A0] dark:hover:bg-white/5 dark:hover:text-white',
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0 transition-colors', active ? 'text-[#25D366]' : 'text-gray-500 group-hover:text-gray-900 dark:text-[#8696A0] dark:group-hover:text-white')} />
                <span className="flex-1 text-start">{item.label}</span>
                {active && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />}
              </button>
            );
          })}

          <Link
            href="/settings/custom-fields"
            className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-500 transition-all hover:bg-gray-50 hover:text-gray-900 dark:text-[#8696A0] dark:hover:bg-white/5 dark:hover:text-white"
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-gray-500 transition-colors group-hover:text-gray-900 dark:text-[#8696A0] dark:group-hover:text-white" />
            <span className="flex-1 text-start">{t('customFields.title', { defaultValue: 'Contact fields' })}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </Link>
        </aside>

        {/* ── Content panel ── */}
        <div className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-white/10 dark:bg-[#111B21]">
          {/* Section header */}
          <div className="mb-6 border-b border-gray-200 pb-5 dark:border-white/10">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{sectionTitles[activeSection]}</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-[#8696A0]">{sectionDesc[activeSection]}</p>
          </div>

          {/* Section content */}
          {activeSection === 'whatsapp'      && <WhatsAppSection />}
          {activeSection === 'account'       && <AccountSection />}
          {activeSection === 'password'      && <PasswordSection />}
          {activeSection === 'language'      && <LanguageSection />}
        </div>
      </div>
      {/* Mobile bottom-nav spacer */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />
    </div>
  );
}
