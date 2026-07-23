'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Plus, Upload, MessageSquare, Send, Users, LayoutTemplate, TrendingUp, Tag, ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from 'next-auth/react';
import { cn } from '../../../lib/utils';
import { api } from '../../../lib/api';
import { useSocket } from '../../../hooks/useSocket';
import KpiCards from '../../../components/dashboard/donezo/KpiCards';
import ConnectionStrip from '../../../components/dashboard/ConnectionStrip';
import Reminders from '../../../components/dashboard/donezo/Reminders';
import AgentCollaboration from '../../../components/dashboard/donezo/AgentCollaboration';
import PipelineWidget, { type PipelineStats } from '../../../components/dashboard/PipelineWidget';
import RecentConversations from '../../../components/dashboard/RecentConversations';

const GLASS = 'rounded-[20px] bg-white/80 backdrop-blur-xl border border-gray-100 shadow-[0_2px_20px_rgba(0,0,0,0.05)] dark:bg-[#182229] dark:border-transparent dark:shadow-[0_4px_24px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]';

function ChartSkeleton() {
  return <div className="skeleton h-[340px] rounded-[20px]" aria-hidden="true" />;
}

// recharts is by far the heaviest dependency on this page — load it after the
// critical content so the dashboard shell + KPIs paint without waiting for it.
const MessagesChart = dynamic(() => import('../../../components/dashboard/MessagesChart'), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

interface OverviewData {
  totalContacts: number;
  openConversations: number;
  todayMessages: number;
  hotLeads: number;
}

interface AgentStat {
  agentId: string;
  name: string;
  email: string;
  openConversations: number;
  resolvedConversations: number;
  avgFirstResponseMin: number | null;
}

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD'];

const QUICK_NAV_ITEMS = [
  {
    href: '/leads',
    labelKey: 'quickNav.leads',
    subKey:   'quickNav.leadsSub',
    Icon: TrendingUp,
    iconClass:   'bg-gradient-to-br from-violet-500 to-purple-600',
    iconShadow:  'shadow-[0_4px_14px_rgba(124,58,237,0.5)]',
    glowClass:   'bg-violet-400',
    topLine:     'bg-violet-400',
    hoverShadow: 'group-hover:shadow-[0_12px_40px_rgba(124,58,237,0.2)] dark:group-hover:shadow-[0_12px_40px_rgba(139,92,246,0.25)]',
    accentText:  'text-violet-600 dark:text-violet-400',
    arrowColor:  'text-violet-500 dark:text-violet-400',
  },
  {
    href: '/templates',
    labelKey: 'quickNav.templates',
    subKey:   'quickNav.templatesSub',
    Icon: LayoutTemplate,
    iconClass:   'bg-gradient-to-br from-sky-500 to-blue-600',
    iconShadow:  'shadow-[0_4px_14px_rgba(14,165,233,0.5)]',
    glowClass:   'bg-sky-400',
    topLine:     'bg-sky-400',
    hoverShadow: 'group-hover:shadow-[0_12px_40px_rgba(14,165,233,0.2)] dark:group-hover:shadow-[0_12px_40px_rgba(56,189,248,0.25)]',
    accentText:  'text-sky-600 dark:text-sky-400',
    arrowColor:  'text-sky-500 dark:text-sky-400',
  },
  {
    href: '/tags',
    labelKey: 'quickNav.tags',
    subKey:   'quickNav.tagsSub',
    Icon: Tag,
    iconClass:   'bg-gradient-to-br from-amber-500 to-orange-500',
    iconShadow:  'shadow-[0_4px_14px_rgba(245,158,11,0.5)]',
    glowClass:   'bg-amber-400',
    topLine:     'bg-amber-400',
    hoverShadow: 'group-hover:shadow-[0_12px_40px_rgba(245,158,11,0.2)] dark:group-hover:shadow-[0_12px_40px_rgba(251,191,36,0.25)]',
    accentText:  'text-amber-600 dark:text-amber-500',
    arrowColor:  'text-amber-500 dark:text-amber-400',
  },
] as const;

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" role="status" aria-label="Loading stats">
      {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-[124px] rounded-[20px] sm:h-[150px]" />)}
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const { t: tCommon } = useTranslation('common');
  const { data: session } = useSession();

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [overviewLoaded, setOverviewLoaded] = useState(false);
  const [messagesData, setMessagesData] = useState<any[] | null>(null);
  const [agentStats, setAgentStats] = useState<AgentStat[] | null>(null);
  const [pipelineStats, setPipelineStats] = useState<PipelineStats | null>(null);
  // Separate from `pipelineStats` being non-null: an empty pipeline is a real
  // answer the widget renders, not a reason to keep showing a skeleton forever.
  const [pipelineLoaded, setPipelineLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = (session?.user as any)?.role ?? 'AGENT';
  const isAdmin = ADMIN_ROLES.includes(role);

  // Each section loads independently and reveals as soon as ITS data lands —
  // the page never blocks on the slowest endpoint. Note: /api/whatsapp/status
  // is NOT fetched here; ConnectionStrip owns that call.
  const fetchData = useCallback(() => {
    setError(null);
    void api.get('/api/analytics/overview')
      .then((data) => setOverview(data))
      .catch((err: any) => {
        console.error('Failed to fetch dashboard overview:', err);
        setError(err?.message || 'Failed to load dashboard data');
      })
      .finally(() => setOverviewLoaded(true));
    void api.get('/api/analytics/messages')
      .then((data) => setMessagesData(Array.isArray(data) ? data : []))
      .catch(() => setMessagesData([]));
    void api.get('/api/analytics/agents')
      .then((data) => setAgentStats(Array.isArray(data) ? data : []))
      .catch(() => setAgentStats([]));
    void api.get('/api/analytics/pipeline')
      .then((data) => setPipelineStats(data?.totalDeals !== undefined ? data : null))
      .catch(() => setPipelineStats(null))
      .finally(() => setPipelineLoaded(true));
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const onMessageNew = useCallback((data: { isNewContact?: boolean }) => {
    setOverview((prev) => prev ? {
      ...prev,
      todayMessages: prev.todayMessages + 1,
      ...(data.isNewContact ? { totalContacts: prev.totalContacts + 1 } : {}),
    } : prev);
  }, []);

  const onConversationUpdated = useCallback((data: { status?: string }) => {
    if (!data.status) return;
    setOverview((prev) => prev ? (
      data.status === 'OPEN'
        ? { ...prev, openConversations: prev.openConversations + 1 }
        : { ...prev, openConversations: Math.max(0, prev.openConversations - 1) }
    ) : prev);
  }, []);

  useSocket('message:new', onMessageNew);
  useSocket('conversation:updated', onConversationUpdated);

  const statsLoaded = agentStats !== null;

  return (
    <div className="relative space-y-4">
      {/* Ambient gradient blobs — visible through glass cards */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden select-none">
        <div className="absolute -top-20 right-0 h-80 w-80 rounded-full bg-emerald-200/30 blur-3xl dark:bg-[#25D366]/6" />
        <div className="absolute top-1/3 -left-16 h-64 w-64 rounded-full bg-sky-200/25 blur-3xl dark:bg-blue-500/4" />
        <div className="absolute bottom-20 right-1/3 h-52 w-52 rounded-full bg-violet-200/20 blur-3xl dark:bg-violet-500/3" />
      </div>

      {/* ── Hero card (hidden on mobile) ──────────────────────────────────── */}
      <div className="hidden sm:block relative overflow-hidden rounded-2xl bg-white border border-gray-100 shadow-[0_2px_20px_rgba(0,0,0,0.06)] p-5 sm:p-6 dark:bg-[#0d1a14] dark:border-white/[0.07] dark:shadow-[0_8px_40px_rgba(0,0,0,0.6)]">
        {/* Top shimmer line */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#25D366]/40 to-transparent dark:via-[#25D366]/55" />

        {/* Corner glows */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none">
          <div className="absolute -right-12 -top-12 h-52 w-52 rounded-full bg-[#25D366]/6 blur-3xl dark:bg-[#25D366]/12" />
          <div className="absolute -left-8 bottom-0 h-36 w-44 rounded-full bg-blue-400/5 blur-3xl dark:bg-blue-500/7" />
        </div>

        {/* Subtle dot-grid texture */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.018] dark:opacity-[0.025] hero-dot-grid" />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2.5 inline-flex items-center gap-1.5 rounded-full border border-[#16A34A]/20 bg-[#16A34A]/8 px-2.5 py-1 text-[11px] font-semibold text-[#16A34A] dark:border-[#25D366]/25 dark:bg-[#25D366]/10 dark:text-[#25D366]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A] animate-pulse dark:bg-[#25D366]" />
              {t('badge', { defaultValue: 'Live' })}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-white">{t('title')}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-white/40">{t('tagline')}</p>
          </div>

          <div className="flex gap-2 sm:shrink-0">
            <Link
              href="/broadcasts/new"
              className="flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl bg-[#16A34A] px-4 py-2.5 text-sm font-bold text-white shadow-[0_4px_14px_rgba(22,163,74,0.30)] transition-all hover:bg-[#15803D] hover:shadow-[0_6px_20px_rgba(22,163,74,0.40)] active:scale-95 dark:bg-[#25D366] dark:shadow-[0_4px_16px_rgba(37,211,102,0.35)] dark:hover:bg-[#22c55e] dark:hover:shadow-[0_6px_22px_rgba(37,211,102,0.45)]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('newBroadcast')}
            </Link>
            <Link
              href="/contacts"
              className="flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-600 transition-all hover:bg-gray-100 hover:text-gray-900 hover:border-gray-300 active:scale-95 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/70 dark:hover:bg-white/[0.09] dark:hover:text-white dark:hover:border-white/18"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              {t('importContacts')}
            </Link>
          </div>
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {error && !overview && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
          <p className="font-medium">{error}</p>
          <button type="button" onClick={() => fetchData()} className="mt-2 text-xs font-semibold underline underline-offset-2">
            {tCommon('retry')}
          </button>
        </div>
      )}

      {/* ── Which line are we sending from ───────────────────────────────── */}
      {/* Above the KPIs and outside the hero, because the hero is sm+ only and a
          phone is exactly where "am I still connected, and as whom?" gets asked. */}
      <ConnectionStrip />

      {/* ── Mobile Quick Actions (tablet only: sm → lg) ──────────────────── */}
      <div className="hidden sm:grid sm:grid-cols-4 gap-2 lg:hidden">
        {[
          { href: '/conversations', Icon: MessageSquare, label: 'Inbox' },
          { href: '/broadcasts/new', Icon: Send, label: 'Broadcast' },
          { href: '/contacts', Icon: Users, label: 'Contacts' },
          { href: '/templates', Icon: LayoutTemplate, label: 'Templates' },
        ].map(({ href, Icon, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(GLASS, 'flex flex-col items-center gap-2 p-3 transition-all active:scale-95 select-none')}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#16A34A]/10 dark:bg-[#25D366]/10">
              <Icon className="h-5 w-5 text-[#16A34A] dark:text-[#25D366]" aria-hidden="true" />
            </span>
            <span className="text-[11px] font-semibold text-gray-700 dark:text-white">{label}</span>
          </Link>
        ))}
      </div>

      {/* ── KPI row — first data on screen; skeleton keeps layout stable ── */}
      {overview
        ? <div className="section-reveal"><KpiCards data={overview} /></div>
        : !overviewLoaded && <KpiSkeleton />}

      {/* ── Quick Navigate (hidden on desktop) ───────────────────────────── */}
      <div className="lg:hidden">
        <p className="mb-2.5 ps-0.5 text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-white/30">
          {t('quickNav.title')}
        </p>
        <div className="grid grid-cols-3 gap-3">
          {QUICK_NAV_ITEMS.map(({ href, labelKey, subKey, Icon, iconClass, iconShadow, glowClass, topLine, hoverShadow, accentText, arrowColor }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                GLASS,
                'group relative flex flex-col gap-3 overflow-hidden p-3.5 sm:p-4',
                'transition-all duration-300 ease-out',
                '-translate-y-0 hover:-translate-y-[3px]',
                hoverShadow,
                'active:scale-[0.97] active:translate-y-0',
                'select-none',
              )}
            >
              {/* Top accent line — slides in on hover */}
              <div className={cn(
                'pointer-events-none absolute inset-x-0 top-0 h-[2px] origin-center scale-x-0 rounded-full opacity-70 transition-transform duration-300 group-hover:scale-x-100',
                topLine,
              )} />

              {/* Corner glow blob */}
              <div className={cn(
                'pointer-events-none absolute -end-5 -top-5 h-[72px] w-[72px] rounded-full blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-30 dark:group-hover:opacity-20',
                glowClass,
              )} />

              {/* Icon */}
              <div className={cn(
                'flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-[13px] transition-transform duration-300 group-hover:scale-110',
                iconClass,
                iconShadow,
              )}>
                <Icon className="h-4 w-4 sm:h-5 sm:w-5 text-white" aria-hidden="true" />
              </div>

              {/* Text */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] sm:text-[13px] font-bold leading-snug text-gray-900 dark:text-white">
                  {t(labelKey)}
                </p>
                <p className="mt-0.5 hidden sm:block text-[11px] leading-snug text-gray-400 dark:text-white/35 line-clamp-1">
                  {t(subKey)}
                </p>
              </div>

              {/* Open label + arrow */}
              <div className="flex items-center justify-between gap-1">
                <span className={cn('text-[10px] sm:text-[11px] font-semibold', accentText)}>
                  {t('quickNav.open')}
                </span>
                <ArrowUpRight className={cn(
                  'h-3 w-3 sm:h-3.5 sm:w-3.5 transition-transform duration-200',
                  'group-hover:translate-x-0.5 group-hover:-translate-y-0.5',
                  arrowColor,
                )} aria-hidden="true" />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Dashboard grid ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">

        {/* Row 1 — Message volume (primary) + what needs a reply */}
        <div className="md:col-span-12 lg:col-span-8">
          {messagesData !== null
            ? <div className="section-reveal"><MessagesChart data={messagesData} /></div>
            : <ChartSkeleton />}
        </div>
        <div className="md:col-span-12 lg:col-span-4">
          <Reminders openCount={overview?.openConversations ?? 0} />
        </div>

        {/* Row 2 — Three equal columns: money, people, conversations. Each is a
            different question an operator asks, so none of them nests. */}
        <div className="md:col-span-6 lg:col-span-4">
          {pipelineLoaded
            ? <div className="section-reveal h-full"><PipelineWidget stats={pipelineStats} /></div>
            : <div className="skeleton h-72 rounded-[20px]" aria-hidden="true" />}
        </div>
        <div className="md:col-span-6 lg:col-span-4">
          {statsLoaded
            ? <div className="section-reveal h-full"><AgentCollaboration agents={agentStats ?? []} isAdmin={isAdmin} /></div>
            : <div className="skeleton h-72 rounded-[20px]" aria-hidden="true" />}
        </div>
        <div className="md:col-span-12 lg:col-span-4">
          <RecentConversations />
        </div>

      </div>
      {/* Mobile bottom-nav spacer — real element in flow so content is never
          hidden behind the fixed nav. Height matches --bottom-nav-space
          (0 on sm+ where the nav is hidden). */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />
    </div>
  );
}
