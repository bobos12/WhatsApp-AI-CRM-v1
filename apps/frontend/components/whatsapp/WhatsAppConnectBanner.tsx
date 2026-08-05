'use client';

/**
 * WhatsAppConnectBanner — a quiet, app-wide nudge to connect a WhatsApp number.
 *
 * The CRM is inert without one, so this sits under the header on every dashboard
 * page while the session is disconnected or mid-connect. It used to be a
 * full-bleed green gradient bar with a pinging icon and a big white button —
 * unmissable, but it read as an incident on a screen that was otherwise calm,
 * and it shouted the same thing on every page for as long as the user took to
 * find their phone.
 *
 * It is now a notice: a light surface with a coloured status rail, the same
 * visual language as the dashboard's ConnectionStrip, so "not connected" reads
 * as a state rather than an error. Same information, a quarter of the volume.
 *
 * It hides on /settings and /dashboard, which already show the QR code itself —
 * a prompt to connect directly above the thing you connect with is just noise.
 *
 * Not permanently dismissable: the user can minimize it to a slim pill (state in
 * localStorage), and it re-expands on a fresh disconnect. It disappears on its
 * own the moment WhatsApp connects.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircle, QrCode, ChevronRight, ChevronDown } from 'lucide-react';
import { useSessionStatus } from '../../hooks/useSessionStatus';
import ConnectWhatsAppModal from './ConnectWhatsAppModal';
import { cn } from '../../lib/utils';

const MIN_KEY = 'wa_connect_banner_min';

/** Everything that changes with state, in one place. */
const TONES = {
  connecting: {
    rail: 'from-amber-400 via-amber-500 to-orange-500',
    glow: 'bg-amber-400/10',
    chip: 'border-amber-400/25 bg-amber-400/10 text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-500',
    ping: 'bg-amber-400',
  },
  disconnected: {
    rail: 'from-[#25D366] via-[#1FAA5C] to-[#128C7E]',
    glow: 'bg-[#25D366]/10',
    chip: 'border-[#25D366]/25 bg-[#25D366]/10 text-[#128C7E] dark:text-[#25D366]',
    dot: 'bg-[#16A34A] dark:bg-[#25D366]',
    ping: 'bg-[#25D366]',
  },
} as const;

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
  // pill can never hide a brand-new disconnect.
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

  if (!hydrated || isLoading) return null;
  if (tenantless) return null; // a pure operator has no WhatsApp of their own
  if (status !== 'disconnected' && status !== 'connecting') return null;
  // Both of these render the QR code in full. Prompting to connect immediately
  // above the code you connect with is noise, not guidance.
  if (pathname?.startsWith('/settings') || pathname?.startsWith('/dashboard')) return null;

  const connecting = status === 'connecting';
  const tone = connecting ? TONES.connecting : TONES.disconnected;
  const title = connecting ? t('waBanner.connectingTitle') : t('waBanner.disconnectedTitle');
  const body = connecting ? t('waBanner.connectingBody') : t('waBanner.disconnectedBody');
  const ctaLabel = connecting ? t('waBanner.scanQr') : t('waBanner.connect');

  // ── Minimized — a slim pill, still clearly present ─────────────────────────
  if (minimized) {
    return (
      <>
        <div className="px-4 pt-3 sm:px-6 sm:pt-4">
          <button
            type="button"
            onClick={() => toggleMin(false)}
            aria-label={t('waBanner.expandLabel')}
            className="group flex w-full items-center gap-2.5 rounded-xl border border-gray-200/80 bg-white/80 px-3.5 py-2 text-start shadow-[0_1px_8px_rgba(0,0,0,0.03)] backdrop-blur-xl transition-colors hover:bg-white dark:border-white/10 dark:bg-[#182229] dark:hover:bg-[#1d2a32]"
          >
            <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
              <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', tone.ping)} />
              <span className={cn('relative inline-flex h-2 w-2 rounded-full', tone.dot)} />
            </span>
            <span className="flex-1 truncate text-xs font-semibold text-gray-700 dark:text-white/80">
              {t('waBanner.expandLabel')}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 dark:text-[#8696A0]" aria-hidden="true" />
          </button>
        </div>
        <ConnectWhatsAppModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      </>
    );
  }

  // ── Notice ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="px-4 pt-3 sm:px-6 sm:pt-4">
        <div
          className={cn(
            'relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white/90 backdrop-blur-xl',
            'shadow-[0_2px_16px_rgba(0,0,0,0.04)]',
            'dark:border-white/10 dark:bg-[#182229] dark:shadow-[0_4px_24px_rgba(0,0,0,0.4)]',
          )}
        >
          {/* Status rail — the fastest read on the card, before any word is parsed */}
          <div aria-hidden="true" className={cn('pointer-events-none absolute inset-y-0 start-0 w-1 bg-gradient-to-b', tone.rail)} />
          <div aria-hidden="true" className={cn('pointer-events-none absolute -top-12 -end-12 h-40 w-40 rounded-full blur-3xl', tone.glow)} />

          <div className="relative flex items-center gap-3 py-3 pe-2.5 ps-4 sm:gap-4 sm:pe-3.5 sm:ps-5">
            <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl border', tone.chip)}>
              {connecting
                ? <QrCode className="h-[18px] w-[18px]" aria-hidden="true" />
                : <MessageCircle className="h-[18px] w-[18px]" aria-hidden="true" />}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-gray-900 sm:text-sm dark:text-white">{title}</p>
              {/* Secondary on a phone: the title already says what to do, and a
                  second line of small grey text is what makes a notice feel heavy. */}
              <p className="mt-0.5 hidden truncate text-xs text-gray-500 sm:block dark:text-[#8696A0]">{body}</p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setConnectOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#16A34A] px-3.5 py-2 text-xs font-bold text-white shadow-[0_2px_10px_rgba(22,163,74,0.25)] transition-all hover:bg-[#15803D] active:scale-95 dark:bg-[#25D366] dark:text-slate-950 dark:shadow-[0_2px_12px_rgba(37,211,102,0.25)] dark:hover:bg-[#22c55e]"
              >
                <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="whitespace-nowrap">{ctaLabel}</span>
              </button>
              <button
                type="button"
                onClick={() => toggleMin(true)}
                aria-label={t('waBanner.collapse')}
                title={t('waBanner.collapse')}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-[#8696A0] dark:hover:bg-white/10 dark:hover:text-white"
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConnectWhatsAppModal open={connectOpen} onClose={() => setConnectOpen(false)} />
    </>
  );
}
