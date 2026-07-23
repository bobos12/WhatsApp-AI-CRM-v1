'use client';

/**
 * WhatsAppConnectBanner — an app-wide, unmissable prompt to connect a WhatsApp
 * number. The whole CRM is inert without one, so this sits under the header on
 * every dashboard page whenever the session is disconnected or mid-connect.
 *
 * It is intentionally NOT permanently dismissable — the user can only minimize it
 * to a slim strip (state remembered in localStorage). It disappears on its own the
 * moment WhatsApp connects, and hides on the Settings page (where the QR lives).
 */

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircle, QrCode, ChevronRight, Minus, Wifi } from 'lucide-react';
import { useSessionStatus } from '../../hooks/useSessionStatus';
import QuickConnectModal from './QuickConnectModal';
import { cn } from '../../lib/utils';

const MIN_KEY = 'wa_connect_banner_min';

export default function WhatsAppConnectBanner() {
  const { t } = useTranslation('common');
  const pathname = usePathname();
  // `tenantless` is true for a platform operator with no business of their own —
  // WhatsApp is per client, so the connect prompt doesn't apply to them.
  const { status, isLoading, tenantless } = useSessionStatus() as { status?: string; isLoading: boolean; tenantless?: boolean };

  const [minimized, setMinimized] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  useEffect(() => {
    setHydrated(true);
    try { setMinimized(localStorage.getItem(MIN_KEY) === '1'); } catch { /* ignore */ }
  }, []);

  // Re-expand automatically whenever the connection drops again, so a minimized
  // strip can never hide a brand-new disconnect.
  useEffect(() => {
    if (status === 'disconnected') {
      setMinimized(false);
      try { localStorage.removeItem(MIN_KEY); } catch { /* ignore */ }
    }
  }, [status]);

  const toggleMin = (next: boolean) => {
    setMinimized(next);
    try {
      if (next) localStorage.setItem(MIN_KEY, '1');
      else localStorage.removeItem(MIN_KEY);
    } catch { /* ignore */ }
  };

  // Don't render until we know the status, when connected, or on the settings page.
  if (!hydrated || isLoading) return null;
  if (tenantless) return null; // a pure operator has no WhatsApp of their own
  if (status !== 'disconnected' && status !== 'connecting') return null;
  if (pathname?.startsWith('/settings')) return null;

  const connecting = status === 'connecting';
  const title = connecting ? t('waBanner.connectingTitle') : t('waBanner.disconnectedTitle');
  const body = connecting ? t('waBanner.connectingBody') : t('waBanner.disconnectedBody');
  const ctaLabel = connecting ? t('waBanner.scanQr') : t('waBanner.connect');

  // ── Minimized strip — slim, still clearly present ──────────────────────────
  if (minimized) {
    return (
      <div className="px-4 pt-3 sm:px-6 sm:pt-4">
        <button
          type="button"
          onClick={() => toggleMin(false)}
          aria-label={t('waBanner.expandLabel')}
          className={cn(
            'group flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2 text-start transition-colors',
            connecting
              ? 'border-amber-400/40 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/[0.08]'
              : 'border-[#25D366]/40 bg-[#25D366]/[0.08] dark:border-[#25D366]/25 dark:bg-[#25D366]/[0.08]',
          )}
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-70', connecting ? 'bg-amber-400' : 'bg-[#25D366]')} />
            <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', connecting ? 'bg-amber-500' : 'bg-[#25D366]')} />
          </span>
          <span className={cn('flex-1 truncate text-xs font-semibold', connecting ? 'text-amber-800 dark:text-amber-300' : 'text-[#0b6b3f] dark:text-[#25D366]')}>
            {t('waBanner.expandLabel')}
          </span>
          <ChevronRight className={cn('h-4 w-4 shrink-0 rtl:rotate-180', connecting ? 'text-amber-600 dark:text-amber-400' : 'text-[#128C7E] dark:text-[#25D366]')} aria-hidden="true" />
        </button>
      </div>
    );
  }

  // ── Full banner ────────────────────────────────────────────────────────────
  return (
    <>
    <div className="px-4 pt-3 sm:px-6 sm:pt-4">
      <div
        className={cn(
          'relative overflow-hidden rounded-2xl border shadow-sm',
          connecting
            ? 'border-amber-400/40 bg-gradient-to-r from-amber-500 to-orange-500'
            : 'border-[#128C7E]/30 bg-gradient-to-r from-[#128C7E] via-[#1aa06e] to-[#25D366]',
        )}
      >
        {/* Shimmer line + soft glow for depth */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/40" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-white/15 blur-2xl" />

        <div className="relative flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
          {/* Icon + copy */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/20 text-white ring-1 ring-white/25 backdrop-blur-sm">
              {connecting ? <QrCode className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
              <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
              </span>
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white sm:text-[15px]">{title}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-white/85 sm:text-[13px]">{body}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setConnectOpen(true)}
              className={cn(
                'inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-bold shadow-sm transition-all hover:shadow-md active:scale-95 sm:flex-none',
                connecting ? 'text-orange-700 hover:bg-orange-50' : 'text-[#075E54] hover:bg-emerald-50',
              )}
            >
              <Wifi className="h-4 w-4" aria-hidden="true" />
              {ctaLabel}
            </button>
            <button
              type="button"
              onClick={() => toggleMin(true)}
              aria-label={t('waBanner.collapse')}
              title={t('waBanner.collapse')}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white/80 transition-colors hover:bg-white/15 hover:text-white"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
    <QuickConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
    </>
  );
}
