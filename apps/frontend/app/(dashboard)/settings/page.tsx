'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '@/components/ui/page';
import { useSearchParams } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';
import WhatsAppLinkPanel from '../../../components/whatsapp/WhatsAppLinkPanel';
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
    return <WhatsAppLinkPanel />;
  }

  function AccountSection() {
    const name  = session?.user?.name;
    const email = session?.user?.email;
    const role  = (session?.user as any)?.role ?? 'AGENT';

    return (
      <div className="space-y-5">
        {/* Profile card */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 flex items-center gap-4 dark:border-white/10 dark:bg-raised">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand text-lg font-bold text-white shadow-[0_4px_12px_rgba(37,211,102,0.3)]">
            {initials(name, email)}
          </div>
          <div className="min-w-0 flex-1">
            {name && <p className="truncate text-base font-semibold text-ink">{name}</p>}
            <p className="truncate text-sm text-ink-3">{email}</p>
            <span className={cn('mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', SIMPLE_ROLE_BADGE[toSimpleRole(role)])}>
              {t(`team.roles.${toSimpleRole(role)}`, { defaultValue: SIMPLE_ROLE_LABEL[toSimpleRole(role)] })}
            </span>
          </div>
        </div>

        {/* Sign out */}
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <p className="mb-3 text-sm font-medium text-ink">{t('account.signOutConfirm.title')}</p>
          <p className="mb-4 text-xs text-ink-3">{t('account.signOutConfirm.message')}</p>
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
            <label htmlFor="current-password" className="block text-sm font-semibold text-ink mb-2.5 flex items-center gap-2">
              <Lock className="h-4 w-4 text-brand" />
              {tPass('password.currentPassword')}
            </label>
            <div className="relative group">
              <input
                id="current-password"
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={changingPassword}
                className="field w-full pr-12 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
            <label htmlFor="new-password" className="block text-sm font-semibold text-ink mb-2.5 flex items-center gap-2">
              <Lock className="h-4 w-4 text-brand" />
              {tPass('password.newPassword')}
            </label>
            <div className="relative group">
              <input
                id="new-password"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={changingPassword}
                className="field w-full pr-12 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
            <label htmlFor="confirm-password" className="block text-sm font-semibold text-ink mb-2.5 flex items-center gap-2">
              <Lock className="h-4 w-4 text-brand" />
              {tPass('password.confirmPassword')}
            </label>
            <div className="relative group">
              <input
                id="confirm-password"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={changingPassword}
                className="field w-full pr-12 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
          <div className="animate-in fade-in slide-in-from-top-2 rounded-xl border border-brand/30 bg-brand/10 backdrop-blur px-4 py-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-brand flex-shrink-0" />
              <p className="text-sm font-medium text-brand">{tPass('password.successMessage')}</p>
            </div>
          </div>
        )}

        {/* Submit button */}
        <Button
          type="submit"
          disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
          className="w-full gap-2 bg-gradient-to-r from-brand to-emerald-600 text-white hover:from-brand/90 hover:to-emerald-600/90 shadow-lg shadow-brand/30 hover:shadow-brand/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 py-3 rounded-xl font-semibold text-base"
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
        <p className="text-sm text-ink-3">{t('language.description')}</p>

        <LanguageSwitcher variant="full" className="max-w-sm" />

        <div className={cn(
          'flex items-center gap-3 rounded-xl border p-4',
          'border-brand/30 bg-brand/8',
        )}>
          <CheckCircle2 className="h-5 w-5 text-brand shrink-0" />
          <div>
            <p className="text-sm font-medium text-ink">
              {language === 'ar' ? t('language.languages.ar') : t('language.languages.en')}
            </p>
            <p className="text-xs text-gray-500 mt-0.5 dark:text-ink-3">
              {language === 'ar' ? t('language.direction.rtl') : t('language.direction.ltr')}
            </p>
          </div>
        </div>

        <p className="text-xs text-ink-3">{t('language.restartNotice')}</p>
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
      <PageHeader className="mb-0" title={t('title')} description={t('subtitle')} />

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
                  ? 'border-brand/30 bg-brand/10 text-brand'
                  : 'border-gray-200 bg-gray-50 text-gray-500 hover:text-gray-900 dark:border-white/10 dark:bg-raised dark:text-ink-3 dark:hover:text-white',
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
          className="flex shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 transition-all hover:text-gray-900 dark:border-white/10 dark:bg-raised dark:text-ink-3 dark:hover:text-white"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
          {t('customFields.title', { defaultValue: 'Contact fields' })}
        </Link>
      </div>

      {/* ── Main layout ── */}
      <div className="flex flex-col md:flex-row gap-4 md:gap-6 items-start">

        {/* ── Sidebar nav (desktop) ── */}
        <aside className="hidden md:flex w-52 shrink-0 flex-col gap-1 rounded-xl border border-gray-200 bg-white p-2 dark:border-white/10 dark:bg-surface">
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
                    ? 'bg-brand/10 text-brand'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-ink-3 dark:hover:bg-white/5 dark:hover:text-white',
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0 transition-colors', active ? 'text-brand' : 'text-gray-500 group-hover:text-ink-3 dark:group-hover:text-white')} />
                <span className="flex-1 text-start">{item.label}</span>
                {active && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />}
              </button>
            );
          })}

          <Link
            href="/settings/custom-fields"
            className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-500 transition-all hover:bg-gray-50 hover:text-ink-3 dark:hover:bg-white/5 dark:hover:text-white"
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-gray-500 transition-colors group-hover:text-ink-3 dark:group-hover:text-white" />
            <span className="flex-1 text-start">{t('customFields.title', { defaultValue: 'Contact fields' })}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </Link>
        </aside>

        {/* ── Content panel ── */}
        <div className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-white/10 dark:bg-surface">
          {/* Section header */}
          <div className="mb-6 border-b border-gray-200 pb-5 dark:border-white/10">
            <h2 className="text-lg font-semibold text-ink">{sectionTitles[activeSection]}</h2>
            <p className="mt-1 text-sm text-ink-3">{sectionDesc[activeSection]}</p>
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
