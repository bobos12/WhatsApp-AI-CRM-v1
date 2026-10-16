'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Upload, ChevronRight, CheckCircle2, Send, FileText } from 'lucide-react';
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
  const { t: tSidebar } = useTranslation('sidebar');
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

  // One line, one job: who needs an answer. Today's volumes and hot leads live
  // in the numbers band right below, so they aren't repeated here.
  const strong = <b className="font-semibold text-ink" />;
  const brief = queue ? (
    queue.waiting > 0 ? (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
          <span className="absolute inset-0 animate-ping rounded-full bg-amber-500 opacity-50 [animation-duration:2s]" />
          <span className="relative h-2 w-2 rounded-full bg-amber-500" />
        </span>
        <span>
          <Trans t={t} i18nKey="today.brief.waiting" count={queue.waiting} values={{ count: queue.waiting }} components={{ b: strong }} />
          {queue.oldest && <Trans t={t} i18nKey="today.brief.longest" values={{ time: formatAgo(queue.oldest) }} components={{ w: <b className="font-semibold text-amber-700 dark:text-amber-400" /> }} />}
        </span>
        <Link href="/conversations" className="inline-flex items-center gap-0.5 font-semibold text-brand hover:underline">
          {t('today.brief.replyNow')}
          <ChevronRight className="h-4 w-4 icon-mirror" aria-hidden="true" />
        </Link>
      </span>
    ) : (
      <span className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
        {t('today.brief.caughtUp')}
      </span>
    )
  ) : null;

  return (
    <div className="mx-auto max-w-[1280px] space-y-8 pb-4 sm:space-y-12 sm:pt-4">
      {/* ── Briefing ── */}
      <header className="enter flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
        <div className="w-full min-w-0 max-w-2xl sm:w-auto">
          {/* Phones: greeting and date share one line; larger screens stack the date above. */}
          <div className="flex items-baseline justify-between gap-3 sm:flex-col-reverse sm:items-start sm:gap-2">
            <h1 className="min-w-0 truncate text-xl font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[32px] sm:tracking-[-0.025em]">
              {now && firstName ? t(greetingKey(now.getHours()), { name: firstName }) : t('title')}
            </h1>
            <p className="shrink-0 text-xs font-medium text-ink-3">
              {now ? now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' }) : ' '}
            </p>
          </div>
          <div className="mt-2 min-h-6 text-sm leading-6 text-ink-2 sm:mt-3 sm:text-base">
            {brief ?? <span className="inline-block h-4 w-64 max-w-full animate-pulse rounded bg-raised align-middle" />}
          </div>
          {/* The phone app bar already shows the live connection dot. */}
          <div className="mt-4 hidden min-h-[20px] sm:block"><SendingFrom /></div>
        </div>
        <div className="hidden gap-2 sm:flex">
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
        ? (
          <div className="enter space-y-3" style={{ animationDelay: '60ms' }}>
            {/* Phones: campaigns and templates, one tap from home. */}
            <div className="grid grid-cols-2 gap-2 sm:hidden">
              <Link href="/broadcasts" className="btn btn-secondary h-11 justify-center active:scale-[0.98]">
                <Send className="h-4 w-4 text-brand icon-mirror" aria-hidden="true" />
                {tSidebar('nav.broadcasts')}
              </Link>
              <Link href="/templates" className="btn btn-secondary h-11 justify-center active:scale-[0.98]">
                <FileText className="h-4 w-4 text-brand" aria-hidden="true" />
                {tSidebar('nav.templates')}
              </Link>
            </div>
            <PulseStrip data={overview} series={series} locale={locale} />
          </div>
        )
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

    </div>
  );
}
