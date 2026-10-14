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
import { QrCode, ChevronRight, ChevronDown } from 'lucide-react';
import { useSessionStatus } from '../../hooks/useSessionStatus';
import ConnectWhatsAppModal from './ConnectWhatsAppModal';
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
  const title = connecting ? t('waBanner.connectingTitle') : t('waBanner.disconnectedTitle');
  const body = connecting ? t('waBanner.connectingBody') : t('waBanner.disconnectedBody');
  const ctaLabel = connecting ? t('waBanner.scanQr') : t('waBanner.connect');
  const dot = (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
      <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-50', connecting ? 'bg-amber-400' : 'bg-red-400')} />
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', connecting ? 'bg-amber-500' : 'bg-red-500')} />
    </span>
  );

  // A system strip across the top of the workspace — part of the frame, not a
  // card in the content, so it never shifts the page's own layout around.
  return (
    <>
      {minimized ? (
        <button
          type="button"
          onClick={() => toggleMin(false)}
          aria-label={t('waBanner.expandLabel')}
          className="group flex h-8 w-full shrink-0 items-center gap-2.5 border-b border-line bg-surface px-4 text-start transition-colors hover:bg-raised sm:px-6"
        >
          {dot}
          <span className="flex-1 truncate text-xs font-medium text-ink-2">{t('waBanner.expandLabel')}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-4 icon-mirror" aria-hidden="true" />
        </button>
      ) : (
        <div className="enter flex shrink-0 items-center gap-3 border-b border-line bg-surface px-4 py-2 sm:px-6">
          {dot}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-ink">
              {title}
              {/* Secondary on a phone: the title already says what to do. */}
              <span className="ms-2 hidden font-normal text-ink-3 md:inline">{body}</span>
            </p>
          </div>
          <button type="button" onClick={() => setConnectOpen(true)} className="btn btn-primary btn-sm">
            <QrCode aria-hidden="true" />
            {ctaLabel}
          </button>
          <button
            type="button"
            onClick={() => toggleMin(true)}
            aria-label={t('waBanner.collapse')}
            title={t('waBanner.collapse')}
            className="btn btn-ghost btn-icon btn-sm"
          >
            <ChevronDown aria-hidden="true" />
          </button>
        </div>
      )}
      <ConnectWhatsAppModal open={connectOpen} onClose={() => setConnectOpen(false)} />
    </>
  );
}
