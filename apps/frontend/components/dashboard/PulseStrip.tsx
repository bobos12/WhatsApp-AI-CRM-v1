'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, ArrowDownRight, Inbox, MessageCircle, Flame, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import type { OverviewData, MessagePoint } from '@/stores/stats-store';

/** A 7-point line that fills its box. Purely a shape cue — no axes. */
function Sparkline({ points }: { points: number[] }) {
  const max = Math.max(1, ...points);
  const W = 100, H = 28;
  const step = W / (points.length - 1);
  const coords = points.map((p, i) => [i * step, H - 2 - (p / max) * (H - 4)] as const);
  const line = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-7 w-full overflow-visible text-sky-500 rtl:-scale-x-100 dark:text-sky-400" aria-hidden="true">
      <defs>
        <linearGradient id="nx-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#nx-spark)" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
        vectorEffect="non-scaling-stroke" pathLength={1} style={{ strokeDasharray: 1, animation: 'nxDraw 1.1s var(--ease-out) both' }} />
    </svg>
  );
}

/** Answered vs waiting, as one bar that grows in from the start edge. */
function SplitBar({ answered, waiting }: { answered: number; waiting: number }) {
  const total = answered + waiting;
  const pct = total ? (answered / total) * 100 : 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-amber-500/30" aria-hidden="true">
      <div
        className="h-full origin-left rounded-full bg-brand rtl:origin-right"
        style={{ width: `${pct}%`, animation: 'nxGrowX 0.9s var(--ease-out) both' }}
      />
    </div>
  );
}

const TONES = {
  brand:  'bg-brand/12 text-brand',
  sky:    'bg-sky-500/12 text-sky-600 dark:text-sky-400',
  orange: 'bg-orange-500/12 text-orange-600 dark:text-orange-400',
  violet: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
} as const;

type Cell = {
  key: string;
  href: string;
  label: string;
  value: number;
  icon: typeof Inbox;
  tone: keyof typeof TONES;
  badge?: React.ReactNode;
  viz?: React.ReactNode;
  sub: React.ReactNode;
};

/**
 * Today's four numbers. Each cell carries the visual its number needs — the
 * answered/waiting split for open chats, the week's shape for messages, today's
 * change for leads and contacts — and is a door to the screen that acts on it.
 */
export default function PulseStrip({ data, series, locale }: { data: OverviewData; series: MessagePoint[] | null; locale: string }) {
  const { t } = useTranslation('dashboard');
  const fmt = (n: number) => formatNumber(n, locale);

  const delta = data.yesterdayMessages > 0
    ? Math.round(((data.todayMessages - data.yesterdayMessages) / data.yesterdayMessages) * 100)
    : null;
  const spark = series?.map((p) => p.incoming + p.outgoing) ?? [];
  const hasSpark = spark.length > 1 && spark.some((p) => p > 0);
  const waiting = data.unansweredConversations;

  const cells: Cell[] = [
    {
      key: 'open', href: '/conversations', label: t('today.pulse.open'), value: data.openConversations, icon: Inbox, tone: 'brand',
      viz: data.openConversations > 0
        ? <SplitBar answered={Math.max(0, data.openConversations - waiting)} waiting={waiting} />
        : undefined,
      sub: waiting > 0
        ? <span className="font-medium text-amber-700 dark:text-amber-400">{t('today.pulse.waiting', { count: waiting })}</span>
        : <span>{t('today.pulse.allAnswered')}</span>,
    },
    {
      key: 'messages', href: '/conversations', label: t('today.pulse.messages'), value: data.todayMessages, icon: MessageCircle, tone: 'sky',
      badge: delta !== null && (
        <span className={cn(
          'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
          delta >= 0 ? 'bg-brand/12 text-brand' : 'bg-raised text-ink-3',
        )}>
          {delta >= 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden="true" /> : <ArrowDownRight className="h-3 w-3" aria-hidden="true" />}
          {fmt(Math.abs(delta))}%
        </span>
      ),
      viz: hasSpark ? <Sparkline points={spark} /> : undefined,
      sub: <span>{hasSpark ? t('today.pulse.last7') : t('kpi.noMessagesToday')}</span>,
    },
    {
      key: 'hot', href: '/leads', label: t('today.pulse.hot'), value: data.hotLeads, icon: Flame, tone: 'orange',
      badge: data.hotLeadsToday > 0 && (
        <span className="rounded-full bg-orange-500/12 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-orange-600 dark:text-orange-400">
          +{fmt(data.hotLeadsToday)}
        </span>
      ),
      sub: data.hotLeadsToday > 0
        ? <span>{t('today.pulse.hotToday', { count: data.hotLeadsToday })}</span>
        : <span>{t('today.pulse.noHotToday')}</span>,
    },
    {
      key: 'contacts', href: '/contacts', label: t('today.pulse.contacts'), value: data.totalContacts, icon: Users, tone: 'violet',
      badge: data.newContactsToday > 0 && (
        <span className="rounded-full bg-violet-500/12 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-violet-600 dark:text-violet-400">
          +{fmt(data.newContactsToday)}
        </span>
      ),
      sub: data.newContactsToday > 0
        ? <span>{t('today.pulse.newToday', { count: fmt(data.newContactsToday) })}</span>
        : <span>{t('today.pulse.noneToday')}</span>,
    },
  ];

  return (
    <>
    {/* ── Phones: a compact live list — one row per number, value at the end ── */}
    <section className="sm:hidden" aria-label={t('crmOverview')}>
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="eyebrow">{t('today.pulse.title')}</p>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-brand">
          <span className="live-dot" aria-hidden="true" />
          {t('today.pulse.live')}
        </span>
      </div>
      <ul className="overflow-hidden rounded-xl border border-line bg-surface">
        {cells.map((c, i) => (
          <li
            key={c.key}
            className={cn('relative', i > 0 && 'border-t border-line')}
            style={{ animation: `nxEnter 0.45s var(--ease-out) ${80 + i * 50}ms both` }}
          >
            <Link href={c.href} className="flex items-center gap-3 px-3.5 py-3 transition-colors active:bg-raised">
              <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', TONES[c.tone])}>
                <c.icon className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{c.label}</span>
                <span className="mt-0.5 block truncate text-xs text-ink-3">{c.sub}</span>
              </span>
              {c.key === 'messages' && hasSpark && <span className="w-12 shrink-0"><Sparkline points={spark} /></span>}
              <span className="flex shrink-0 items-center gap-1.5">
                {c.badge}
                <AnimatedNumber value={c.value} format={fmt} className="min-w-[1.5ch] text-end text-[22px] font-semibold leading-none tracking-[-0.02em] text-ink" />
              </span>
            </Link>
            {/* Open chats: the answered/waiting split runs along the row's foot */}
            {c.key === 'open' && data.openConversations > 0 && (
              <div className="absolute inset-x-0 bottom-0 [&>div]:h-0.5 [&>div]:rounded-none">{c.viz}</div>
            )}
          </li>
        ))}
      </ul>
    </section>

    <section className="hidden grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface sm:grid lg:grid-cols-4" aria-label={t('crmOverview')}>
      {cells.map((c, i) => (
        <Link
          key={c.key}
          href={c.href}
          className={cn(
            'group relative flex min-w-0 flex-col p-4 outline-none transition-colors duration-base sm:p-5',
            'hover:bg-raised/60 focus-visible:bg-raised/60 active:bg-raised',
            i % 2 === 1 && 'border-s border-line',
            i >= 2 && 'border-t border-line lg:border-t-0',
            i === 2 && 'lg:border-s',
          )}
        >
          {/* hover: a brand rule draws in along the cell's foot */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-center scale-x-0 bg-brand transition-transform duration-base ease-out group-hover:scale-x-100 group-focus-visible:scale-x-100" />

          <div className="flex items-center gap-2">
            <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-transform duration-base group-hover:scale-105', TONES[c.tone])}>
              <c.icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 truncate text-[13px] font-medium text-ink-2">{c.label}</span>
            <ArrowUpRight className="ms-auto hidden h-4 w-4 shrink-0 translate-y-0.5 text-ink-3 opacity-0 transition-[opacity,transform] duration-base group-hover:translate-y-0 group-hover:opacity-100 sm:block icon-mirror" aria-hidden="true" />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <AnimatedNumber value={c.value} format={fmt} className="text-[28px] font-semibold leading-none tracking-[-0.03em] text-ink sm:text-[32px]" />
            {c.badge}
          </div>

          {/* Fixed-height slot so all four cells keep one rhythm, with or without a chart. */}
          <div className="mt-3 flex h-7 items-end">{c.viz}</div>

          <p className="mt-2 truncate text-xs text-ink-3">{c.sub}</p>
        </Link>
      ))}
    </section>
    </>
  );
}
