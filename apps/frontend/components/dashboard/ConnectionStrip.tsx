'use client';

/**
 * WhatsApp connection on the dashboard. Two very different jobs, two renders:
 *
 *   not connected → setup, front and centre. Nothing else on the dashboard
 *                   matters until a number is linked, so this is the one place
 *                   the QR / pairing code lives at full size.
 *   connected     → nothing here. The sidebar footer already shows the live
 *                   status on every page; the dashboard header carries a quiet
 *                   one-line "sending from" (SendingFrom, below) with warm-up.
 *
 * Deliberately not red when unconnected: a first-run account hasn't broken
 * anything, and an alarm colour makes a new user think they did something wrong.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { MessageCircle, RotateCw, ShieldCheck, Copy, Check, Flame, Zap } from 'lucide-react';
import { useSessionStatus } from '../../hooks/useSessionStatus';
import { useWhatsAppConnection } from '../whatsapp/WhatsAppConnectProvider';
import WhatsAppLinkPanel from '../whatsapp/WhatsAppLinkPanel';
import { formatPhone } from '../../lib/phone';

export default function ConnectionStrip() {
  const { t } = useTranslation('dashboard');
  const { status, isLoading } = useSessionStatus() as { status?: string; isLoading: boolean };
  const { tenantless } = useWhatsAppConnection();

  if (isLoading || status === 'connected' || tenantless) return null;
  const connecting = status === 'connecting';

  return (
    <section className="panel enter overflow-hidden" aria-label={t('connection.aria', { defaultValue: 'WhatsApp connection' })}>
      <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[1fr_auto] md:items-center">
        <div className="max-w-md">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
            {connecting
              ? <RotateCw className="h-5 w-5 animate-spin" aria-hidden="true" />
              : <MessageCircle className="h-5 w-5" aria-hidden="true" />}
          </span>
          <h2 className="mt-4 text-lg font-semibold tracking-[-0.01em] text-ink">
            {t('connection.setupTitle', { defaultValue: 'Connect your WhatsApp' })}
          </h2>
          <p className="mt-1.5 text-[13px] leading-6 text-ink-3">
            {t('connection.setupBody', { defaultValue: 'Connect your WhatsApp Business number to start sending and receiving.' })}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-brand" aria-hidden="true" />
              {t('common:sidebarConnect.secure')}
            </span>
            <Link href="/settings?section=whatsapp" className="font-medium text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
              {t('connection.moreOptions', { defaultValue: 'More connection options' })}
            </Link>
          </div>
        </div>
        <div className="flex justify-center md:justify-end">
          <WhatsAppLinkPanel size="md" />
        </div>
      </div>
    </section>
  );
}

/** "Sending from +966 …" with warm-up capacity — the dashboard header's meta line. */
export function SendingFrom() {
  const { t } = useTranslation('dashboard');
  const { status, connectedPhone, session } = useSessionStatus() as {
    status?: string; connectedPhone?: string | null;
    session?: { warmupEnabled?: boolean; dayNumber?: number; warmup?: { active?: boolean; dailyLimit?: number | null; dailySent?: number } } | null;
  };
  const [copied, setCopied] = useState(false);
  if (status !== 'connected' || !connectedPhone) return null;

  const warm = session?.warmupEnabled && session.warmup?.active;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`+${connectedPhone.replace(/[^\d]/g, '')}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard can refuse; the number is on screen anyway */ }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
      <span className="live-dot" aria-hidden="true" />
      <span>{t('today.sendingFrom')}</span>
      <button type="button" onClick={copy} dir="ltr" className="inline-flex items-center gap-1 font-medium tabular-nums text-ink-2 hover:text-ink" title={t('connection.copy', { defaultValue: 'Copy number' })}>
        {formatPhone(connectedPhone)}
        {copied ? <Check className="h-3 w-3 text-brand" aria-hidden="true" /> : <Copy className="h-3 w-3 opacity-50" aria-hidden="true" />}
      </button>
      {session?.warmup && (
        warm ? (
          <span className="chip chip-warn">
            <Flame className="h-3 w-3" aria-hidden="true" />
            {t('today.warmup', { day: session.dayNumber })}
            {session.warmup.dailyLimit ? ` · ${session.warmup.dailySent}/${session.warmup.dailyLimit}` : ''}
          </span>
        ) : (
          <span className="chip chip-brand"><Zap className="h-3 w-3" aria-hidden="true" />{t('today.fullCapacity')}</span>
        )
      )}
    </span>
  );
}
