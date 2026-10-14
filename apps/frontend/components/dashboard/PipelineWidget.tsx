'use client';

/**
 * Deal pipeline, by stage.
 *
 * Every number is from `/api/analytics/pipeline`, which the dashboard already
 * loads. The funnel is drawn as one bar split by stage — the share each stage
 * holds is the thing to read, and one bar makes the proportions obvious where
 * four separate meters made them hard to compare.
 *
 * Stage colours come from STAGE_TONE (lib/format), shared with the deals board,
 * so the two never disagree about what "Negotiating" looks like.
 */

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Target } from 'lucide-react';
import { useLanguage } from '../providers/I18nProvider';
import { cn } from '../../lib/utils';
import { localeFor, formatMoney, formatNumber, STAGE_TONE } from '../../lib/format';
import { Panel, EmptyState } from '../ui/page';

export type { PipelineStats } from '../../stores/stats-store';
import type { PipelineStats } from '../../stores/stats-store';

export default function PipelineWidget({ stats }: { stats: PipelineStats | null }) {
  const { t } = useTranslation('dashboard');
  const { t: tDeals } = useTranslation('deals');
  const { language } = useLanguage();
  const locale = localeFor(language);

  const total = Math.max(1, (stats?.stages ?? []).reduce((s, x) => s + x.count, 0));

  return (
    <Panel open
      title={t('today.pipeline.title')}
      description={t('today.pipeline.sub')}
      actions={<Link href="/deals" className="btn btn-ghost btn-sm">{t('today.pipeline.cta')}</Link>}
      className="h-full"
    >
      {!stats || stats.totalDeals === 0 ? (
        <EmptyState compact icon={Target} title={t('today.pipeline.empty')} description={t('today.pipeline.emptySub')} />
      ) : (
        <div className="p-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">{t('today.pipeline.openValue')}</p>
              <p className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-ink">{formatMoney(stats.openValue, locale, true)}</p>
            </div>
            <div className="text-end">
              <p className="eyebrow">{t('today.pipeline.winRate')}</p>
              <p className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-brand">{stats.conversionRate}%</p>
            </div>
          </div>

          {/* The funnel, as one bar. */}
          <div className="mt-4 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
            {stats.stages.map(({ stage, count }) => count > 0 && (
              <span
                key={stage}
                className={cn('grow-x h-full first:rounded-s-full last:rounded-e-full', STAGE_TONE[stage]?.bar ?? 'bg-gray-300')}
                style={{ width: `${(count / total) * 100}%` }}
              />
            ))}
          </div>

          <ul className="mt-4 space-y-2">
            {stats.stages.map(({ stage, count, value }) => (
              <li key={stage} className="flex items-center gap-2.5 text-xs">
                <span className={cn('h-2 w-2 shrink-0 rounded-sm', STAGE_TONE[stage]?.dot ?? 'bg-gray-300')} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-ink-2">{tDeals(`stages.${stage}`, { defaultValue: stage })}</span>
                <span className="w-8 text-end font-semibold tabular-nums text-ink">{formatNumber(count, locale)}</span>
                <span className="w-20 text-end tabular-nums text-ink-3">{formatMoney(value, locale, true)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
