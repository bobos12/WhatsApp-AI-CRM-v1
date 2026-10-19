'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface DailyUsage { limit: number | null; used: number; remaining: number | null; scheduledSoon: number }

/**
 * Meta's rolling-24h limit on new conversations, shown where campaigns are made
 * so the team sees what's left before they plan a send — not after WhatsApp
 * refuses the excess.
 */
export default function DailyLimit({ refreshKey }: { refreshKey?: unknown }) {
  const { t, i18n } = useTranslation('broadcasts');
  const [daily, setDaily] = useState<DailyUsage | null>(null);
  const fmt = (n: number) => n.toLocaleString(i18n.language.startsWith('ar') ? 'ar-SA' : 'en-US');

  const load = useCallback(async () => {
    try {
      const health = await api.get<{ daily?: DailyUsage }>('/api/broadcasts/health');
      setDaily(health?.daily ?? null);
    } catch {
      /* the strip is advisory; a failed read just hides it */
    }
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);

  if (!daily) return null;
  if (daily.limit === null) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-ink-3">
        <Gauge className="h-4 w-4 shrink-0" aria-hidden="true" /> {t('dailyLimit.unknown')}
      </p>
    );
  }

  const { limit, used, scheduledSoon } = daily;
  const remaining = daily.remaining ?? 0;
  const pct = (n: number) => `${Math.min(100, (n / limit) * 100)}%`;
  const excess = scheduledSoon - remaining;
  const tight = remaining / limit < 0.15;

  return (
    <section className="rounded-xl border border-line bg-surface px-4 py-3.5" aria-label={t('dailyLimit.title')}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-ink-4" aria-hidden="true" />
          <p className="text-[13px] font-semibold text-ink">{t('dailyLimit.title')}</p>
          <span className="text-xs tabular-nums text-ink-3">
            {fmt(used)} {t('dailyLimit.of')} {fmt(limit)}
          </span>
        </div>
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
            <dt className="text-ink-3">{t('dailyLimit.used')}</dt>
            <dd className="font-semibold tabular-nums text-ink">{fmt(used)}</dd>
          </div>
          {scheduledSoon > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" />
              <dt className="text-ink-3">{t('dailyLimit.scheduled')}</dt>
              <dd className="font-semibold tabular-nums text-ink">{fmt(scheduledSoon)}</dd>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-raised ring-1 ring-inset ring-line" aria-hidden="true" />
            <dt className="text-ink-3">{t('dailyLimit.remaining')}</dt>
            <dd className={cn('font-semibold tabular-nums', tight ? 'text-rose-600 dark:text-rose-400' : 'text-ink')}>{fmt(remaining)}</dd>
          </div>
        </dl>
      </div>

      {/* Used, then what's queued for the next 24h, against the whole limit. */}
      <div
        className="mt-3 flex h-2 overflow-hidden rounded-full bg-raised ring-1 ring-inset ring-line"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
      >
        <span className="grow-x h-full bg-brand transition-[width] duration-500" style={{ width: pct(used) }} />
        {scheduledSoon > 0 && (
          <span className="grow-x h-full bg-amber-400/80 transition-[width] duration-500" style={{ width: pct(Math.min(scheduledSoon, remaining)) }} />
        )}
      </div>

      {excess > 0 ? (
        <p className="mt-2.5 flex items-start gap-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t('dailyLimit.over', { excess: fmt(excess) })}
        </p>
      ) : (
        <p className="mt-2 text-2xs leading-4 text-ink-3">{t('dailyLimit.hint', { limit: fmt(limit) })}</p>
      )}
    </section>
  );
}
