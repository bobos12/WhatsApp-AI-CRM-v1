'use client';

import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../providers/I18nProvider';

interface DayDatum { date: string; incoming: number; outgoing: number }

// Solid fills for the three busiest days (dark → light), matching the reference
const SOLID = [
  'bg-gradient-to-t from-[#0c3a27] to-[#1f9255] dark:from-[#0b5e3a] dark:to-brand', // #1 darkest
  'bg-[#2E9E5B] dark:bg-[#1fa85a]',                                                      // #2 medium
  'bg-[#8ad3ab] dark:bg-[#3fae6a]',                                                      // #3 light
];

export default function AnalyticsBars({ data }: { data: DayDatum[] }) {
  const { t } = useTranslation('dashboard');
  const { language } = useLanguage();
  const locale = language === 'ar' ? 'ar-EG' : 'en-US';

  // Always build a fixed 7-day window ending today, filling missing days with 0
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().split('T')[0];
    const match = data.find((x) => x.date === key);
    return { date: key, total: (match?.incoming ?? 0) + (match?.outgoing ?? 0) };
  });

  const max = Math.max(1, ...days.map((d) => d.total));
  const weekTotal = days.reduce((s, d) => s + d.total, 0);

  // Rank days by volume → top 3 get solid greens, the peak gets a value bubble
  const rankByIdx = new Map<number, number>();
  [...days.keys()].sort((a, b) => days[b].total - days[a].total).forEach((idx, rank) => rankByIdx.set(idx, rank));
  const peakIdx = weekTotal > 0 ? days.reduce((best, d, i) => (d.total > days[best].total ? i : best), 0) : -1;

  return (
    <section className="flex h-full flex-col rounded-xl border border-gray-200/80 bg-white p-5 dark:border-white/8 dark:bg-surface">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[15px] font-bold text-ink">{t('analytics.title')}</h2>
        {weekTotal > 0 && (
          <span className="text-[11px] font-medium text-ink-4">
            {weekTotal.toLocaleString(locale)} {t('analytics.title').toLowerCase()}
          </span>
        )}
      </div>

      {weekTotal === 0 ? (
        /* Still render the 7 bars at min height so the chart structure is visible */
        <div className="mt-6 flex flex-1 items-end gap-2 sm:gap-3" style={{ minHeight: '160px' }}>
          {days.map((d) => {
            const weekday = new Date(d.date).toLocaleDateString(locale, { weekday: 'narrow' });
            return (
              <div key={d.date} className="flex flex-1 flex-col items-center gap-2.5">
                <div className="relative flex w-full flex-1 items-end justify-center">
                  <div className="dz-bar w-full max-w-[26px] rounded-full dz-hatch border border-brand/15 bg-transparent dark:border-brand/15" style={{ height: '14%' }} />
                </div>
                <span className="text-[11px] font-medium text-ink-4">{weekday}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-6 flex flex-1 items-end gap-2 sm:gap-3" style={{ minHeight: '160px' }}>
          {days.map((d, i) => {
            const rank = rankByIdx.get(i) ?? 99;
            const isSolid = rank < 3 && d.total > 0;
            const pct = Math.round((d.total / max) * 100);
            const height = `${Math.max(pct, 14)}%`;
            const isPeak = i === peakIdx && d.total > 0;
            const weekday = new Date(d.date).toLocaleDateString(locale, { weekday: 'narrow' });

            return (
              <div key={d.date} className="flex flex-1 flex-col items-center gap-2.5">
                <div className="relative flex w-full flex-1 items-end justify-center">
                  {isPeak && (
                    <span className="absolute top-0 z-10 -translate-y-1 whitespace-nowrap rounded-lg bg-brand-strong px-2 py-1 text-[10px] font-bold tabular-nums text-white shadow-md dark:bg-brand dark:text-brand-fg">
                      {d.total.toLocaleString(locale)}
                      <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-brand-strong dark:bg-brand" aria-hidden="true" />
                    </span>
                  )}
                  <div
                    className={`dz-bar w-full max-w-[26px] rounded-full ${
                      isSolid
                        ? SOLID[rank]
                        : 'dz-hatch border border-brand/20 bg-transparent dark:border-brand/20'
                    }`}
                    style={{ height }}
                    title={d.total.toLocaleString(locale)}
                  />
                </div>
                <span className="text-[11px] font-medium text-ink-4">{weekday}</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-[11px] text-ink-4">{t('analytics.subtitle')}</p>
    </section>
  );
}
