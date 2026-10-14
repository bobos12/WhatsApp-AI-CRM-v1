'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Upload, MessageSquare } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { useSession } from 'next-auth/react';
import { useLiveStats } from '../../../hooks/useLiveStats';
import { useStatsStore, type StatsSection } from '../../../stores/stats-store';
import { useLanguage } from '../../../components/providers/I18nProvider';
import { localeFor, formatAgo, formatNumber } from '../../../lib/format';
import { isManager } from '../../../lib/roles';
import PulseStrip from '../../../components/dashboard/PulseStrip';
import ConnectionStrip, { SendingFrom } from '../../../components/dashboard/ConnectionStrip';
import AttentionQueue from '../../../components/dashboard/AttentionQueue';
import HotLeads from '../../../components/dashboard/HotLeads';
import PipelineWidget from '../../../components/dashboard/PipelineWidget';
import TeamTable from '../../../components/dashboard/TeamTable';
import { Skeleton } from '../../../components/ui/Skeleton';

function ChartSkeleton() {
  return <Skeleton className="h-[340px] rounded-xl" />;
}

// recharts is by far the heaviest dependency on this page — load it after the
// critical content so the shell, the numbers and the queue paint without it.
const MessagesChart = dynamic(() => import('../../../components/dashboard/MessagesChart'), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

/** Everything this page renders. `overview` overlaps the shell's own hook — the
 *  store coalesces that into a single request. */
const PAGE_SECTIONS: StatsSection[] = ['overview', 'series', 'agents', 'pipeline'];

function greetingKey(h: number) {
  return h < 12 ? 'today.morning' : h < 18 ? 'today.afternoon' : 'today.evening';
}

/** A quiet label that opens each band of the page. */
function Band({ label, children, delay = 0 }: { label: string; children: React.ReactNode; delay?: number }) {
  return (
    <section className="enter" style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-4 flex items-center gap-3">
        <p className="eyebrow shrink-0">{label}</p>
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
      </div>
      {children}
    </section>
  );
}

/**
 * Home. Organised around one question — "what is happening, and what should I
 * do next?" — and written as much as drawn: the top of the page is a sentence
 * that says who is waiting and what changed, because a sentence is read in one
 * pass where four tiles are scanned four times. Below it the page runs from
 * urgent to slow: who to answer, who is about to buy, then the week and the team.
 */
export default function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const { t: tCommon } = useTranslation('common');
  const { data: session } = useSession();
  const { language } = useLanguage();
  const locale = localeFor(language);

  // Every figure here comes from the shared store, kept current by realtime
  // invalidation rather than client-side arithmetic (see hooks/useLiveStats.ts).
  useLiveStats(PAGE_SECTIONS);

  const overview      = useStatsStore((s) => s.overview);
  const series        = useStatsStore((s) => s.series);
  const agentStats    = useStatsStore((s) => s.agents);
  const pipelineStats = useStatsStore((s) => s.pipeline);
  const loaded        = useStatsStore((s) => s.loaded);
  const error         = useStatsStore((s) => s.error);
  const refresh       = useStatsStore((s) => s.refresh);

  const user = session?.user as { name?: string | null; role?: string } | undefined;
  const firstName = (user?.name || '').split(/\s+/)[0];
  const admin = isManager(user?.role);

  // Clock-dependent text renders after mount so server and client agree.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const [queue, setQueue] = useState<{ waiting: number; oldest: string | null } | null>(null);
  const onSummary = useCallback((s: { waiting: number; oldest: string | null }) => setQueue(s), []);

  const strong = <b className="font-semibold text-ink" />;
  const brief = overview && queue ? (
    <>
      {queue.waiting > 0 ? (
        <>
          <Trans t={t} i18nKey="today.brief.waiting" count={queue.waiting} values={{ count: queue.waiting }} components={{ b: strong }} />
          {queue.oldest && <Trans t={t} i18nKey="today.brief.longest" values={{ time: formatAgo(queue.oldest) }} components={{ w: <b className="font-semibold text-amber-700 dark:text-amber-400" /> }} />}
          .{' '}
        </>
      ) : (
        <>{t('today.brief.none')}. </>
      )}
      {overview.hotLeadsToday > 0
        ? <Trans t={t} i18nKey="today.brief.hot" count={overview.hotLeadsToday} values={{ count: overview.hotLeadsToday }} components={{ b: strong }} />
        : t('today.brief.noHot')}
      {', '}{t('today.brief.and')}{' '}
      <Trans t={t} i18nKey="today.brief.volume" values={{ count: formatNumber(overview.todayMessages, locale) }} components={{ b: strong }} />.
    </>
  ) : null;

  return (
    <div className="mx-auto max-w-[1280px] space-y-12 pb-4 sm:pt-4">
      {/* ── Briefing ── */}
      <header className="enter flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
        <div className="min-w-0 max-w-2xl">
          <p className="text-xs font-medium text-ink-3">
            {now ? now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }) : ' '}
          </p>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[32px]">
            {now && firstName ? t(greetingKey(now.getHours()), { name: firstName }) : t('title')}
          </h1>
          <p className="mt-3 min-h-[3.25rem] text-[15px] leading-relaxed text-ink-2 sm:text-base">
            {brief ?? <span className="inline-block h-4 w-80 max-w-full animate-pulse rounded bg-raised align-middle" />}
          </p>
          <div className="mt-4 min-h-[20px]"><SendingFrom /></div>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Link href="/contacts?import=1" className="btn btn-secondary btn-lg flex-1 sm:flex-none">
            <Upload aria-hidden="true" />
            {t('importContacts')}
          </Link>
          <Link href="/broadcasts/new" className="btn btn-primary btn-lg flex-1 sm:flex-none">
            <Plus aria-hidden="true" />
            {t('newBroadcast')}
          </Link>
        </div>
      </header>

      {error && !overview && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300">
          <p className="font-medium">{error}</p>
          <button type="button" onClick={() => void refresh(PAGE_SECTIONS, { force: true })} className="btn btn-sm btn-secondary">
            {tCommon('retry')}
          </button>
        </div>
      )}

      {/* Setup takes over the top of the page until a number is linked. */}
      <ConnectionStrip />

      {/* ── Today's numbers, as an open band ── */}
      {overview
        ? <div className="enter" style={{ animationDelay: '60ms' }}><PulseStrip data={overview} series={series} locale={locale} /></div>
        : !loaded.overview && <Skeleton className="h-[150px] rounded-xl" />}

      {/* ── Act ── */}
      <Band label={t('today.brief.sections.act')} delay={120}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7 xl:col-span-8"><AttentionQueue onSummary={onSummary} /></div>
          <div className="lg:col-span-5 xl:col-span-4"><HotLeads /></div>
        </div>
      </Band>

      {/* ── Understand ── */}
      <Band label={t('today.brief.sections.understand')} delay={180}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7 xl:col-span-8">
            {series !== null ? <MessagesChart data={series} /> : <ChartSkeleton />}
          </div>
          <div className="lg:col-span-5 xl:col-span-4">
            {loaded.pipeline ? <PipelineWidget stats={pipelineStats} /> : <Skeleton className="h-[340px] rounded-xl" />}
          </div>
        </div>
      </Band>

      {/* ── Team ── */}
      <Band label={t('today.brief.sections.team')} delay={240}>
        {agentStats !== null
          ? <TeamTable agents={agentStats} isAdmin={admin} locale={locale} />
          : <Skeleton className="h-56 rounded-xl" />}
      </Band>

      {/* Phones reach the inbox from the tab bar; this keeps it one tap away here too. */}
      <Link href="/conversations" className="btn btn-secondary btn-lg w-full sm:hidden">
        <MessageSquare aria-hidden="true" />
        {t('today.openInbox')}
      </Link>
    </div>
  );
}
