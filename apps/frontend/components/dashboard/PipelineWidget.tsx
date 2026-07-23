'use client';

/**
 * Deal pipeline, by stage.
 *
 * The dashboard was already fetching `/api/analytics/pipeline` on every load and
 * throwing almost all of it away — the whole response was reduced to a single
 * percentage for a decorative gauge. Every number here is from that same request,
 * so this widget costs nothing new and shows the part that changes what an
 * operator does next: where the money is stuck.
 *
 * Stage colours match the deals board (`/deals`) so the two never disagree about
 * what "Negotiating" looks like.
 */

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Target, ArrowUpRight, TrendingUp } from 'lucide-react';
import { useLanguage } from '../providers/I18nProvider';
import { cn } from '../../lib/utils';

export interface PipelineStats {
  stages: { stage: string; count: number; value: number }[];
  totalDeals: number;
  totalValue: number;
  closedDeals: number;
  conversionRate: number;
}

const STAGE_BAR: Record<string, string> = {
  NEW:         'bg-gradient-to-r from-blue-500 to-blue-400',
  INTERESTED:  'bg-gradient-to-r from-violet-500 to-violet-400',
  NEGOTIATION: 'bg-gradient-to-r from-amber-500 to-amber-400',
  CLOSED:      'bg-gradient-to-r from-[#25D366] to-[#1FAA5C]',
};

const STAGE_DOT: Record<string, string> = {
  NEW:         'bg-blue-500',
  INTERESTED:  'bg-violet-500',
  NEGOTIATION: 'bg-amber-500',
  CLOSED:      'bg-[#25D366]',
};

const CARD =
  'relative flex h-full flex-col overflow-hidden rounded-[20px] border border-gray-100 bg-white/80 backdrop-blur-xl shadow-[0_2px_20px_rgba(0,0,0,0.05)] dark:border-transparent dark:bg-[#182229] dark:shadow-[0_4px_24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]';

export default function PipelineWidget({ stats }: { stats: PipelineStats | null }) {
  const { t } = useTranslation('dashboard');
  const { t: tDeals } = useTranslation('deals');
  const { language } = useLanguage();
  const locale = language === 'ar' ? 'ar-EG' : 'en-US';

  const money = (n: number) => `$${n.toLocaleString(locale)}`;

  // Bars are scaled against the biggest stage, not the total. With a funnel the
  // total always dwarfs each stage, which would flatten every bar to a sliver.
  const peak = Math.max(1, ...(stats?.stages ?? []).map((s) => s.count));

  return (
    <section className={CARD} aria-label={t('pipelineAnalytics')}>
      <div className="pointer-events-none absolute -top-12 -end-12 h-40 w-40 rounded-full bg-violet-400/10 blur-3xl dark:bg-violet-400/8" />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="relative flex items-start justify-between gap-3 px-5 pt-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-violet-200/60 bg-violet-50 text-violet-600 dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-400">
            <Target className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-white">
              {t('pipelineAnalytics')}
            </h3>
            <p className="truncate text-xs text-gray-500 dark:text-[#8696A0]">{t('pipelineSub')}</p>
          </div>
        </div>
        <Link
          href="/deals"
          aria-label={t('pipelineAnalytics')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-400 transition-all hover:scale-110 hover:text-gray-900 dark:border-white/10 dark:text-[#8696A0] dark:hover:text-white"
        >
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      {!stats || stats.totalDeals === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center">
          <p className="text-sm font-medium text-gray-500 dark:text-[#8696A0]">
            {t('pipelineEmpty', { defaultValue: 'No deals yet' })}
          </p>
          <Link
            href="/deals"
            className="text-xs font-semibold text-[#16A34A] underline underline-offset-4 dark:text-[#25D366]"
          >
            {t('pipelineEmptyCta', { defaultValue: 'Open the deals board' })}
          </Link>
        </div>
      ) : (
        <>
          {/* ── Headline pair ────────────────────────────────────────────── */}
          <div className="relative mx-5 mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#8696A0]">
                {t('totalValue')}
              </p>
              <p className="mt-1 truncate text-xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-white">
                {money(stats.totalValue)}
              </p>
            </div>
            <div className="rounded-2xl border border-[#25D366]/20 bg-[#25D366]/[0.07] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#128C7E] dark:text-[#25D366]">
                {t('conversion')}
              </p>
              <p className="mt-1 flex items-baseline gap-1 text-xl font-bold tabular-nums tracking-tight text-gray-900 dark:text-white">
                {stats.conversionRate}%
                <TrendingUp className="h-3.5 w-3.5 text-[#16A34A] dark:text-[#25D366]" aria-hidden="true" />
              </p>
            </div>
          </div>

          {/* ── Stage bars ───────────────────────────────────────────────── */}
          <div className="relative mt-4 flex-1 space-y-3 px-5 pb-5">
            {stats.stages.map(({ stage, count, value }) => (
              <div key={stage}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-gray-700 dark:text-white/80">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', STAGE_DOT[stage] ?? 'bg-gray-400')} aria-hidden="true" />
                    <span className="truncate">{tDeals(`stages.${stage}`, { defaultValue: stage })}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-[#8696A0]">
                    <span className="font-semibold text-gray-900 dark:text-white">{count.toLocaleString(locale)}</span>
                    {value > 0 && <span className="ms-1.5">{money(value)}</span>}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/8">
                  <div
                    className={cn('h-full rounded-full transition-all duration-700', STAGE_BAR[stage] ?? 'bg-gray-400')}
                    style={{ width: `${(count / peak) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
