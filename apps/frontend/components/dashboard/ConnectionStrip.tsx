'use client';

/**
 * The connected WhatsApp number, as a slim full-width strip.
 *
 * This replaces the old `SessionStatusWidget`, which spent a whole grid column
 * on progress bars nobody acted on. The number itself is the part an operator
 * actually checks — "which line am I sending from right now?" — so it gets the
 * space, and everything else collapses to one chip.
 *
 * Unlike the hero card above it, this renders at every breakpoint: on a phone
 * the hero is hidden, and that is exactly where knowing the sending line matters
 * most.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { MessageCircle, WifiOff, RotateCw, Check, Copy, ChevronRight, Flame, Zap } from 'lucide-react';
import { useSessionStatus } from '../../hooks/useSessionStatus';
import { formatPhone } from '../../lib/phone';
import { cn } from '../../lib/utils';

/** Everything that changes with connection state, in one place. */
const TONES = {
  connected: {
    rail: 'from-[#25D366] via-[#1FAA5C] to-[#128C7E]',
    glow: 'bg-[#25D366]/12 dark:bg-[#25D366]/10',
    iconWrap: 'bg-[#25D366]/12 border-[#25D366]/25 text-[#128C7E] dark:text-[#25D366]',
    label: 'text-[#16A34A] dark:text-[#25D366]',
  },
  connecting: {
    rail: 'from-amber-400 via-amber-500 to-orange-500',
    glow: 'bg-amber-400/12 dark:bg-amber-400/10',
    iconWrap: 'bg-amber-400/12 border-amber-400/25 text-amber-600 dark:text-amber-400',
    label: 'text-amber-600 dark:text-amber-400',
  },
  disconnected: {
    rail: 'from-red-500 via-rose-500 to-red-600',
    glow: 'bg-red-400/12 dark:bg-red-400/10',
    iconWrap: 'bg-red-400/12 border-red-400/25 text-red-600 dark:text-red-400',
    label: 'text-red-600 dark:text-red-400',
  },
} as const;

export default function ConnectionStrip() {
  const { t } = useTranslation('dashboard');
  const { status, connectedPhone, session, isLoading } = useSessionStatus() as any;
  const [copied, setCopied] = useState(false);

  const state: keyof typeof TONES =
    status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected';
  const tone = TONES[state];
  const connected = state === 'connected';

  const copyNumber = async () => {
    if (!connectedPhone) return;
    try {
      await navigator.clipboard.writeText(`+${connectedPhone.replace(/[^\d]/g, '')}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard is permission-gated and can simply say no. The number is on
      // screen either way, so a failed copy is not worth interrupting anyone for.
    }
  };

  if (isLoading) {
    return <div className="skeleton h-[84px] rounded-[20px] sm:h-[76px]" aria-hidden="true" />;
  }

  const warmup = session?.warmup;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-[20px] border border-gray-100 bg-white/80 p-4 backdrop-blur-xl sm:px-5',
        'shadow-[0_2px_20px_rgba(0,0,0,0.05)]',
        'dark:border-transparent dark:bg-[#182229] dark:shadow-[0_4px_24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]',
      )}
      aria-label={t('connection.aria', { defaultValue: 'WhatsApp connection' })}
    >
      {/* Status rail — the fastest read on the card, before any word is parsed */}
      <div className={cn('pointer-events-none absolute inset-y-0 start-0 w-1 bg-gradient-to-b', tone.rail)} />
      <div className={cn('pointer-events-none absolute -top-10 -end-10 h-40 w-40 rounded-full blur-3xl', tone.glow)} />

      <div className="relative flex flex-col gap-3 ps-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        {/* ── Identity: which line are we sending from ─────────────────────── */}
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl border', tone.iconWrap)}>
            {state === 'connecting'
              ? <RotateCw className="h-5 w-5 animate-spin" aria-hidden="true" />
              : connected
                ? <MessageCircle className="h-5 w-5" aria-hidden="true" />
                : <WifiOff className="h-5 w-5" aria-hidden="true" />}
          </span>

          <div className="min-w-0">
            <p className={cn('flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest', tone.label)}>
              {connected && (
                <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#25D366] opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#25D366]" />
                </span>
              )}
              {connected
                ? t('connection.connected', { defaultValue: 'Connected' })
                : state === 'connecting'
                  ? t('session.connecting')
                  : t('session.disconnected')}
            </p>

            {/* A phone number is always read left-to-right, Arabic included. */}
            {connected && connectedPhone ? (
              <p
                dir="ltr"
                className="truncate text-lg font-bold tabular-nums tracking-tight text-gray-900 sm:text-xl dark:text-white"
              >
                {formatPhone(connectedPhone)}
              </p>
            ) : (
              <p className="truncate text-sm text-gray-500 dark:text-[#8696A0]">
                {connected
                  ? t('session.loadingHint')
                  : state === 'connecting'
                    ? t('session.connectingHint')
                    : t('session.disconnectedHint')}
              </p>
            )}
          </div>
        </div>

        {/* ── Capacity chip + the way out ──────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-2 ps-[3.5rem] sm:ps-0">
          {connected && connectedPhone && (
            <button
              type="button"
              onClick={copyNumber}
              title={t('connection.copy', { defaultValue: 'Copy number' })}
              aria-label={t('connection.copy', { defaultValue: 'Copy number' })}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-[#8696A0] dark:hover:bg-white/10 dark:hover:text-white"
            >
              {copied
                ? <Check className="h-4 w-4 text-[#16A34A] dark:text-[#25D366]" aria-hidden="true" />
                : <Copy className="h-4 w-4" aria-hidden="true" />}
            </button>
          )}

          {/* Warm-up is the one number from the old widget worth keeping: it caps
              how much you can send today, so it changes what you do next.
              Only when it is actually switched ON — `warmup.active` alone is
              derived from session age and was showing a ramp for numbers whose
              warm-up the operator had turned off. */}
          {connected && warmup && (
            session?.warmupEnabled && warmup.active ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                <Flame className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="tabular-nums">
                  {t('session.dayOf', { day: session.dayNumber })}
                  {warmup.dailyLimit ? ` · ${warmup.dailySent}/${warmup.dailyLimit}` : ''}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#25D366]/25 bg-[#25D366]/10 px-3 py-2 text-[11px] font-semibold text-[#128C7E] dark:text-[#25D366]">
                <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t('session.fullCapacity')}
              </span>
            )
          )}

          <Link
            href="/settings?section=whatsapp"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-all active:scale-95',
              connected
                ? 'border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white'
                : 'bg-[#16A34A] text-white shadow-[0_4px_14px_rgba(22,163,74,0.30)] hover:bg-[#15803D] dark:bg-[#25D366] dark:text-slate-950 dark:hover:bg-[#22c55e]',
            )}
          >
            {connected
              ? t('connection.manage', { defaultValue: 'Manage' })
              : state === 'connecting'
                ? t('common:waBanner.scanQr')
                : t('common:waBanner.connect')}
            <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
