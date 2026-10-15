'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import type { OverviewData, MessagePoint } from '@/stores/stats-store';

/** A 7-point line, drawn to fill its box. Purely a shape cue — no axes. */
function Sparkline({ points, className }: { points: number[]; className?: string }) {
  if (points.length < 2) return null;
  const max = Math.max(1, ...points);
  const W = 120, H = 36;
  const step = W / (points.length - 1);
  const coords = points.map((p, i) => [i * step, H - 3 - (p / max) * (H - 6)] as const);
  const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn('h-9 w-[120px] overflow-visible text-brand rtl:-scale-x-100', className)} aria-hidden="true">
      <defs>
        <linearGradient id="nx-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#nx-spark)" className="text-brand" />
      <path d={line} className="fill-none stroke-brand" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
        pathLength={1} style={{ strokeDasharray: 1, animation: 'nxDraw 1.1s var(--ease-out) both' }} />
      <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r={3} className="fill-surface stroke-brand" strokeWidth={1.75} />
    </svg>
  );
}

/**
 * Today's four numbers as an open band — no box around them. They are read
 * together, left to right, so they share one baseline and hairline dividers;
 * each is a door to the screen that acts on it.
 */
export default function PulseStrip({ data, series, locale }: { data: OverviewData; series: MessagePoint[] | null; locale: string }) {
  const { t } = useTranslation('dashboard');
  const fmt = (n: number) => formatNumber(n, locale);

  const delta = data.yesterdayMessages > 0
    ? Math.round(((data.todayMessages - data.yesterdayMessages) / data.yesterdayMessages) * 100)
    : null;

  const cells = [
    {
      key: 'open', href: '/conversations', label: t('today.pulse.open'), value: data.openConversations,
      sub: data.unansweredConversations > 0
        ? <span className="font-medium text-amber-700 dark:text-amber-400">{t('today.pulse.waiting', { count: data.unansweredConversations })}</span>
        : <span>{t('today.pulse.allAnswered')}</span>,
    },
    {
      key: 'messages', href: '/conversations', label: t('today.pulse.messages'), value: data.todayMessages,
      sub: delta === null ? <span>{t('kpi.noMessagesToday')}</span> : (
        <span className={cn('inline-flex items-center gap-0.5 font-medium', delta >= 0 ? 'text-brand' : 'text-ink-3')}>
          {delta >= 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden="true" /> : <ArrowDownRight className="h-3 w-3" aria-hidden="true" />}
          {t('kpi.vsYesterday', { percent: fmt(Math.abs(delta)), sign: delta >= 0 ? '+' : '−' })}
        </span>
      ),
      spark: series?.map((p) => p.incoming + p.outgoing) ?? [],
    },
    {
      key: 'hot', href: '/leads', label: t('today.pulse.hot'), value: data.hotLeads,
      sub: data.hotLeadsToday > 0
        ? <span className="font-medium text-brand">{t('today.pulse.hotToday', { count: data.hotLeadsToday })}</span>
        : <span>{t('today.pulse.noHotToday')}</span>,
    },
    {
      key: 'contacts', href: '/contacts', label: t('today.pulse.contacts'), value: data.totalContacts,
      sub: data.newContactsToday > 0
        ? <span>{t('today.pulse.newToday', { count: fmt(data.newContactsToday) })}</span>
        : <span>{t('today.pulse.noneToday')}</span>,
    },
  ];

  return (
    <section className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface lg:grid-cols-4" aria-label={t('crmOverview')}>
      {cells.map((c, i) => (
        <Link
          key={c.key}
          href={c.href}
          className={cn(
            'group relative flex min-w-0 flex-col gap-3 p-4 outline-none transition-colors duration-base sm:p-5',
            'hover:bg-raised/60 focus-visible:bg-raised/60 active:bg-raised',
            i % 2 === 1 && 'border-s border-line',
            i >= 2 && 'border-t border-line lg:border-t-0',
            i === 2 && 'lg:border-s',
          )}
        >
          {/* hover: a brand rule draws in along the cell's foot */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-center scale-x-0 bg-brand transition-transform duration-base ease-out group-hover:scale-x-100 group-focus-visible:scale-x-100" />
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-ink-2">{c.label}</span>
            <ArrowUpRight className="ms-auto h-4 w-4 shrink-0 translate-y-0.5 text-ink-3 opacity-0 transition-[opacity,transform] duration-base group-hover:translate-y-0 group-hover:opacity-100 icon-mirror" aria-hidden="true" />
          </div>
          <div className="flex items-end justify-between gap-3">
            <AnimatedNumber value={c.value} format={fmt} className="text-[30px] font-semibold leading-none tracking-[-0.03em] text-ink sm:text-[34px]" />
            {'spark' in c && c.spark && c.spark.length > 1 && c.spark.some((p) => p > 0) && <Sparkline points={c.spark} className="hidden xl:block" />}
          </div>
          <p className="truncate text-xs text-ink-3">{c.sub}</p>
        </Link>
      ))}
    </section>
  );
}
