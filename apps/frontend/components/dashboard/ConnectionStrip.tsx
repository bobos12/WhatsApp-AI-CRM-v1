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
import { MessageCircle, Copy, Check, Flame, Zap } from 'lucide-react';
import { useSessionStatus } from '../../hooks/useSessionStatus';
import { useWhatsAppConnection } from '../whatsapp/WhatsAppConnectProvider';
import { useSession } from 'next-auth/react';
import { isManager } from '../../lib/roles';
import { formatPhone } from '../../lib/phone';

/**
 * Shown on the dashboard when a connected number has stopped working. First-time
 * setup happens before the dashboard is reachable (SetupGate), so this only ever
 * reports a broken connection — and where it gets fixed.
 */
export default function ConnectionStrip() {
  const { t } = useTranslation('whatsapp');
  const { data: session } = useSession();
  const canManage = isManager((session?.user as { role?: string } | undefined)?.role);
  const { status, configured, loaded, tenantless } = useWhatsAppConnection();

  if (!loaded || tenantless || !configured || status !== 'disconnected') return null;

  return (
    <section role="status" className="panel enter flex flex-col gap-3 border-red-500/25 p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-500/10 text-red-500">
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-ink">{t('banner.brokenTitle')}</h2>
        <p className="mt-0.5 text-[13px] text-ink-3">{canManage ? t('banner.brokenBody') : t('banner.askManager')}</p>
      </div>
      {canManage && (
        <Link href="/settings?section=whatsapp" className="btn btn-primary btn-sm self-start sm:self-auto">
          {t('banner.fix')}
        </Link>
      )}
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
