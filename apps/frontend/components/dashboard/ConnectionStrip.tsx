'use client';

/**
 * The connected WhatsApp number, as a slim full-width strip — and, when there is
 * no connection, a plain invitation to set one up.
 *
 * Two very different jobs, so two very different renders:
 *
 *   connected     → which line am I sending from, and how much headroom is left
 *   not connected → one thing to do, said kindly, with nothing else on screen
 *
 * The not-connected state used to be the connected one with a red rail and a
 * form bolted underneath: an alarm-coloured DISCONNECTED label, a truncated
 * sentence, a "Manage" button leading somewhere else, a divider, two tabs, then
 * the form. Six things competing for attention when the user has exactly one
 * decision to make. Now it reads as setup rather than failure — the same green
 * as everything else, a headline, a sentence explaining what will happen, and
 * the field.
 *
 * Renders at every breakpoint: on a phone the dashboard hero is hidden, and that
 * is exactly where both questions get asked.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { MessageCircle, RotateCw, Check, Copy, ChevronRight, Flame, Zap, ShieldCheck } from 'lucide-react';
import { useSessionStatus } from '../../hooks/useSessionStatus';
import { useWhatsAppConnection } from '../whatsapp/WhatsAppConnectProvider';
import WhatsAppLinkPanel from '../whatsapp/WhatsAppLinkPanel';
import { formatPhone } from '../../lib/phone';
import { cn } from '../../lib/utils';

const SURFACE = cn(
  'relative overflow-hidden rounded-[20px] border border-gray-100 bg-white/80 backdrop-blur-xl',
  'shadow-[0_2px_20px_rgba(0,0,0,0.05)]',
  'dark:border-transparent dark:bg-[#182229] dark:shadow-[0_4px_24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]',
);

export default function ConnectionStrip() {
  const { t } = useTranslation('dashboard');
  const { status, connectedPhone, session, isLoading } = useSessionStatus() as any;
  // The shell's single pairing handshake — never a second one started from here.
  const { tenantless } = useWhatsAppConnection();
  const [copied, setCopied] = useState(false);

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

  const connected = status === 'connected';
  const connecting = status === 'connecting';

  // ── Setup — no number linked yet ──────────────────────────────────────────
  //
  // Deliberately not red. Nothing has broken; the account simply hasn't been set
  // up, and an alarm colour for a first-run state makes a new user think they
  // did something wrong before they have done anything at all.
  if (!connected && !tenantless) {
    return (
      <section className={cn(SURFACE, 'p-5 sm:p-6')} aria-label={t('connection.aria', { defaultValue: 'WhatsApp connection' })}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-0 w-1 bg-gradient-to-b from-[#25D366] via-[#1FAA5C] to-[#128C7E]" />
        <div aria-hidden="true" className="pointer-events-none absolute -top-16 -end-16 h-48 w-48 rounded-full bg-[#25D366]/10 blur-3xl" />

        <div className="relative mx-auto flex w-full max-w-sm flex-col items-center gap-5 text-center">
          <div className="flex flex-col items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-[#25D366]/25 bg-[#25D366]/10 text-[#128C7E] dark:text-[#25D366]">
              {connecting
                ? <RotateCw className="h-[22px] w-[22px] animate-spin" aria-hidden="true" />
                : <MessageCircle className="h-[22px] w-[22px]" aria-hidden="true" />}
            </span>
            <div>
              <h2 className="text-base font-bold text-gray-900 sm:text-lg dark:text-white">
                {t('connection.setupTitle', { defaultValue: 'Connect your WhatsApp' })}
              </h2>
              {/* No truncation. This sentence is the only explanation of what is
                  about to happen — cutting it off mid-word is worse than nothing. */}
              <p className="mt-1 text-sm leading-relaxed text-gray-500 dark:text-[#8696A0]">
                {t('connection.setupBody', {
                  defaultValue: "Enter your number and we'll give you a code to type into WhatsApp.",
                })}
              </p>
            </div>
          </div>

          <WhatsAppLinkPanel size="md" className="w-full" />

          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-[#8696A0]">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{t('common:sidebarConnect.secure')}</span>
            </div>
            <Link
              href="/settings?section=whatsapp"
              className="text-[11px] font-semibold text-gray-400 underline underline-offset-2 transition-colors hover:text-gray-600 dark:text-[#8696A0] dark:hover:text-white"
            >
              {t('connection.moreOptions', { defaultValue: 'More connection options' })}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // ── Connected (or a tenant-less operator, who simply sees the status) ──────
  const warmup = session?.warmup;

  return (
    <section
      className={cn(SURFACE, 'p-4 sm:px-5')}
      aria-label={t('connection.aria', { defaultValue: 'WhatsApp connection' })}
    >
      {/* Status rail — the fastest read on the card, before any word is parsed */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-0 w-1 bg-gradient-to-b from-[#25D366] via-[#1FAA5C] to-[#128C7E]" />
      <div aria-hidden="true" className="pointer-events-none absolute -top-10 -end-10 h-40 w-40 rounded-full bg-[#25D366]/12 blur-3xl dark:bg-[#25D366]/10" />

      <div className="relative flex flex-col gap-3 ps-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        {/* ── Identity: which line are we sending from ─────────────────────── */}
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#25D366]/25 bg-[#25D366]/12 text-[#128C7E] dark:text-[#25D366]">
            <MessageCircle className="h-5 w-5" aria-hidden="true" />
          </span>

          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#16A34A] dark:text-[#25D366]">
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#25D366] opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#25D366]" />
              </span>
              {t('connection.connected', { defaultValue: 'Connected' })}
            </p>

            {/* A phone number is always read left-to-right, Arabic included. */}
            {connectedPhone ? (
              <p
                dir="ltr"
                className="truncate text-lg font-bold tabular-nums tracking-tight text-gray-900 sm:text-xl dark:text-white"
              >
                {formatPhone(connectedPhone)}
              </p>
            ) : (
              <p className="truncate text-sm text-gray-500 dark:text-[#8696A0]">{t('session.loadingHint')}</p>
            )}
          </div>
        </div>

        {/* ── Capacity chip + the way out ──────────────────────────────────── */}
        <div className="flex shrink-0 items-center gap-2 ps-[3.5rem] sm:ps-0">
          {connectedPhone && (
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
          {warmup && (
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
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600 transition-all hover:bg-gray-100 hover:text-gray-900 active:scale-95 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
          >
            {t('connection.manage', { defaultValue: 'Manage' })}
            <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
