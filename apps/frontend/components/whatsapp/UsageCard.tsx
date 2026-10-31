'use client';

/**
 * WhatsApp-only spend, from Meta's pricing analytics. No ads, card or business
 * info — safe to show a manager who shouldn't see the rest of Meta billing.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, WalletCards } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Usage {
  days: number;
  currency: string | null;
  totalCost: number;
  totalVolume: number;
  categories: { category: string; volume: number; cost: number }[];
}

const RANGES = [7, 30, 90] as const;

export default function UsageCard() {
  const { t, i18n } = useTranslation('whatsapp');
  const [days, setDays] = useState<number>(30);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setFailed(false);
    try {
      setUsage(await api.get<Usage>(`/api/channel/usage?days=${d}`));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(days); }, [load, days]);

  const money = (n: number, currency: string | null) => {
    try {
      return new Intl.NumberFormat(i18n.language, { style: 'currency', currency: currency || 'USD' }).format(n);
    } catch {
      return `${n.toFixed(2)} ${currency ?? ''}`.trim();
    }
  };
  const num = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const label = (c: string) => t(`usage.cat.${c}`, { defaultValue: c.replace(/_/g, ' ').toLowerCase() });
  const max = Math.max(1, ...(usage?.categories.map((c) => c.cost) ?? [0]));

  return (
    <section className="panel overflow-hidden" aria-labelledby="usage-title">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
        <WalletCards className="h-4 w-4 text-ink-4" aria-hidden="true" />
        <h2 id="usage-title" className="flex-1 text-[14px] font-semibold text-ink">{t('usage.title')}</h2>
        <div className="flex gap-1" role="group" aria-label={t('usage.range')}>
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={cn('btn btn-sm', days === d ? 'btn-secondary' : 'btn-ghost')}
            >
              {t('usage.days', { n: d })}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {loading && !usage ? (
          <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-ink-4" /></div>
        ) : failed || !usage ? (
          <p className="text-[13px] text-ink-3">{t('usage.error')}</p>
        ) : (
          <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')}>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-2xs text-ink-3">{t('usage.total')}</p>
                <p className="text-2xl font-semibold tabular-nums text-ink">{money(usage.totalCost, usage.currency)}</p>
              </div>
              <p className="text-xs tabular-nums text-ink-3">{t('usage.messages', { n: num(usage.totalVolume) })}</p>
            </div>

            {usage.categories.length === 0 ? (
              <p className="text-[13px] text-ink-3">{t('usage.empty')}</p>
            ) : (
              <ul className="space-y-2.5">
                {usage.categories.map((c) => (
                  <li key={c.category}>
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="text-ink-2">{label(c.category)}</span>
                      <span className="tabular-nums text-ink">
                        {money(c.cost, usage.currency)}
                        <span className="ms-2 text-xs text-ink-3">{num(c.volume)}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-raised">
                      <div className="h-full origin-left rounded-full bg-brand transition-transform duration-500" style={{ transform: `scaleX(${c.cost / max})`, width: '100%' }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <p className="border-t border-line pt-3 text-xs leading-5 text-ink-3">{t('usage.note')}</p>
          </div>
        )}
      </div>
    </section>
  );
}
