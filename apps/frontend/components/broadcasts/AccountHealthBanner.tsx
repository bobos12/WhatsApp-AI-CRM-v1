'use client';

/**
 * ─── Account health banner ───────────────────────────────────────────────────
 *
 * Sits above the campaign list so the state of the WhatsApp number is the first
 * thing a user sees when they come to send something — not a thing they discover
 * afterwards, from a support ticket.
 *
 * It stays quiet when the number is healthy (a single line), and expands into
 * the specific signals when it is not. Alarm fatigue is real: a banner that
 * shouts every day is a banner nobody reads on the day it matters.
 */

import { useState } from 'react';
import { Activity, ChevronDown, ShieldAlert, ShieldCheck, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { useAccountHealth } from '../../hooks/usePreflight';
import { formatCount, formatRatio, healthHeadline, HEALTH_STYLES } from '../../lib/preflight';

const SEVERITY_DOT = {
  info: 'bg-[#8696A0]',
  warn: 'bg-amber-400',
  danger: 'bg-red-400',
} as const;

export default function AccountHealthBanner() {
  const { t } = useTranslation('broadcasts');
  // Five minutes: health moves on the scale of campaigns, not seconds, and a
  // tighter poll would just add load for no new information.
  const { health, loading } = useAccountHealth(5 * 60_000);
  const [expanded, setExpanded] = useState(false);

  if (loading || !health) return null;

  const style = HEALTH_STYLES[health.grade];
  const healthy = health.score >= 70 && !health.blocked;
  const budgetUsed = health.budget.dailyLimit ? health.budget.usedToday / health.budget.dailyLimit : 0;

  return (
    <div
      className={cn(
        'rounded-2xl border transition-colors',
        health.blocked
          ? 'border-red-400/30 bg-red-500/[0.07]'
          : healthy
            ? 'border-gray-200 bg-white dark:border-white/10 dark:bg-[#111B21]'
            : 'border-amber-400/30 bg-amber-400/[0.06]',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-start sm:px-5"
      >
        <span
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
            style.bg,
            style.text,
          )}
        >
          {health.blocked ? <ShieldAlert className="h-5 w-5" /> : healthy ? <ShieldCheck className="h-5 w-5" /> : <Activity className="h-5 w-5" />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {t('health.title', { defaultValue: 'WhatsApp number health' })}
            </span>
            <span className={cn('text-sm font-bold', health.confidence === 'none' ? 'text-gray-500 dark:text-[#8696A0]' : style.text)}>
              {health.confidence === 'none'
                ? t('health.noHistory', { defaultValue: 'No campaign history yet' })
                : health.confidence === 'low'
                  ? t('health.gradeSoFar', {
                      defaultValue: '{{grade}} so far',
                      grade: t(`health.grade_${health.grade}`, { defaultValue: healthHeadline(health) }),
                    })
                  : t(`health.grade_${health.grade}`, { defaultValue: healthHeadline(health) })}
            </span>
            {/* The score is only shown once it stands for something. */}
            {health.confidence !== 'none' && (
              <span className="text-[11px] tabular-nums text-gray-500 dark:text-[#8696A0]">
                {health.score}/100
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-gray-500 dark:text-[#8696A0]">
            {health.blocked
              ? health.blockedReason
              : t('health.budgetLine', {
                  defaultValue: '{{used}} of {{limit}} campaign messages sent today · {{remaining}} left',
                  used: health.budget.usedToday.toLocaleString(),
                  limit: health.budget.dailyLimit.toLocaleString(),
                  remaining: health.budget.remainingToday.toLocaleString(),
                })}
          </span>
        </span>

        {/* Compact budget gauge, always visible — it is the number that decides
            whether the next campaign can go out today. */}
        <span className="hidden w-28 shrink-0 sm:block">
          <span className="block h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/8">
            <span
              className={cn(
                'block h-full rounded-full transition-all duration-500',
                budgetUsed > 0.9 ? 'bg-red-400' : budgetUsed > 0.7 ? 'bg-amber-400' : 'bg-[#25D366]',
              )}
              style={{ width: `${Math.min(100, budgetUsed * 100)}%` }}
            />
          </span>
        </span>

        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-gray-400 transition-transform dark:text-[#8696A0]',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className="border-t border-black/5 px-4 pb-4 pt-3 sm:px-5 dark:border-white/5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
            {/* Every one of these is a ratio or a count over campaign sends. With
                no sends they are 0/0 — shown as "—", because printing "0.0%"
                would read as a measurement of something that never happened. */}
            {[
              { label: t('health.replyRate', { defaultValue: 'Reply rate' }), value: formatRatio(health.metrics.replyRate, health.metrics.sent, 1) },
              { label: t('health.blocks', { defaultValue: 'Blocked by' }), value: formatCount(health.metrics.hardBlocks, health.metrics.sent) },
              { label: t('health.optOuts', { defaultValue: 'Unsubscribes' }), value: formatCount(health.metrics.optOuts, health.metrics.sent) },
              { label: t('health.coldRatio', { defaultValue: 'One-way traffic' }), value: formatRatio(health.metrics.coldRatio, health.metrics.sent) },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-2">
                <dt className="text-gray-500 dark:text-[#8696A0]">{row.label}</dt>
                <dd className="font-medium tabular-nums text-gray-900 dark:text-white">{row.value}</dd>
              </div>
            ))}
          </dl>

          {health.signals.length > 0 ? (
            <ul className="mt-3 space-y-2 border-t border-black/5 pt-3 dark:border-white/5">
              {health.signals.map((signal) => (
                <li key={signal.key} className="flex gap-2.5">
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', SEVERITY_DOT[signal.severity])} />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-gray-900 dark:text-white">{signal.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-gray-500 dark:text-[#8696A0]">
                      {signal.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 flex items-center gap-1.5 border-t border-black/5 pt-3 text-[11px] text-gray-500 dark:border-white/5 dark:text-[#8696A0]">
              <TrendingUp className="h-3 w-3 text-[#25D366]" />
              {t('health.allClear', {
                defaultValue: 'No warning signs in the last {{days}} days. Keep replies flowing and this stays green.',
                days: health.metrics.windowDays,
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
