'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import {
  Target, Search, MessageSquare, RefreshCw, Sparkles, ChevronDown,
  AlertTriangle, ShoppingCart, Flame, History, UserX,
} from 'lucide-react';
import { api } from '../../../lib/api';
import { useSocket } from '../../../hooks/useSocket';
import { useToast } from '../../../hooks/useToast';
import { cn } from '../../../lib/utils';
import { AnimatePresence, motion } from 'motion/react';
import { PageHeader, SearchField, EmptyState } from '../../../components/ui/page';
import { Skeleton } from '../../../components/ui/Skeleton';
import {
  type Lead, type LeadStatus, type LeadStatusEvent,
  StatusBadge, PriorityBadge, FlagChips, SignalChips,
  scoreColor, localizedText, LeadAvatar, STATUS_CFG,
} from '../../../components/leads/lead-ui';
import { peek, remember } from '@/lib/api-cache';
import { useLiveData } from '../../../hooks/useLiveData';

// Sidebar/tab views → underlying canonical statuses (reconciled 9-status set).
const TABS: Array<{ key: string; statuses: LeadStatus[] | null }> = [
  { key: 'all',       statuses: null },
  { key: 'newLeads',  statuses: ['NEW_LEAD'] },
  { key: 'hot',       statuses: ['HOT', 'QUALIFIED'] },
  { key: 'followUp',  statuses: ['WARM', 'COLD'] },
  { key: 'customers', statuses: ['CUSTOMER'] },
  { key: 'lost',      statuses: ['LOST', 'NOT_INTERESTED'] },
  { key: 'spam',      statuses: ['SPAM'] },
];

type Stats = { total: number; statusCounts: Record<string, number>; needsAttention: number; buyingIntent: number; noHandoff: number };

function timeAgo(iso: string | null, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!iso) return t('neverAnalyzed');
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return t('timeAgo.justNow');
  if (min < 60) return t('timeAgo.minutesAgo', { count: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('timeAgo.hoursAgo', { count: h });
  return t('timeAgo.daysAgo', { count: Math.floor(h / 24) });
}

export default function LeadsPage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const { t, i18n } = useTranslation('leads');
  const lang = i18n.language;

  // Last visit's data first, then refreshed — no skeleton on every return.
  const [leads, setLeads] = useState<Lead[]>(() => peek<Lead[]>('leads') ?? []);
  const [stats, setStats] = useState<Stats | null>(() => peek<Stats>('leads:stats') ?? null);
  const [loading, setLoading] = useState(() => peek('leads') === undefined);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable across renders: useToast/i18n return fresh fns each render, so we
  // deliberately exclude them from deps to avoid an infinite fetch loop.
  const fetchAll = useCallback(async () => {
    try {
      const [leadData, statData] = await Promise.all([
        api.get('/api/leads'),
        api.get('/api/leads/stats'),
      ]);
      const list = Array.isArray(leadData) ? leadData : [];
      setLeads(list);
      setStats(statData ?? null);
      remember('leads', list);
      if (statData) remember('leads:stats', statData);
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('toast.loadFailed'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLiveData(['leads', 'contacts', 'conversations'], fetchAll);

  // Run once on mount.
  useEffect(() => { fetchAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: re-qualification anywhere → debounced refresh.
  const onLeadUpdated = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(fetchAll, 1200);
  }, [fetchAll]);
  useSocket('lead:updated', onLeadUpdated);
  useEffect(() => () => { if (refetchTimer.current) clearTimeout(refetchTimer.current); }, []);

  const analyze = async (lead: Lead) => {
    setAnalyzingId(lead.contactId);
    try {
      await api.post(`/api/leads/${lead.contactId}/analyze`, {});
      success(t('toast.analyzed'));
      await fetchAll();
    } catch (err) {
      toastError(err instanceof Error ? err.message : t('toast.analyzeFailed'));
    } finally {
      setAnalyzingId(null);
    }
  };

  const openChat = (lead: Lead) => {
    if (lead.contact?.phone) router.push(`/conversations?phone=${encodeURIComponent(lead.contact.phone)}`);
  };

  const activeTab = TABS.find((x) => x.key === tab) ?? TABS[0];
  const term = search.trim().toLowerCase();
  const visible = leads.filter((l) => {
    if (activeTab.statuses && !activeTab.statuses.includes(l.status)) return false;
    if (term) {
      const hay = `${l.contact?.name ?? ''} ${l.contact?.phone ?? ''}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });

  const tabCount = (key: string): number => {
    if (!stats) return 0;
    const cfg = TABS.find((x) => x.key === key);
    if (!cfg) return 0;
    if (!cfg.statuses) return stats.total;
    return cfg.statuses.reduce((sum, s) => sum + (stats.statusCounts[s] ?? 0), 0);
  };

  const statItems = [
    { key: 'total', value: stats?.total ?? 0, label: t('stats.total') },
    { key: 'attention', value: stats?.needsAttention ?? 0, label: t('stats.needsAttention'), tone: (stats?.needsAttention ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : undefined },
    { key: 'intent', value: stats?.buyingIntent ?? 0, label: t('stats.buyingIntent'), tone: 'text-brand' },
    { key: 'hot', value: tabCount('hot'), label: t('stats.hot') },
    { key: 'handoff', value: stats?.noHandoff ?? 0, label: t('stats.noHandoff'), tone: (stats?.noHandoff ?? 0) > 0 ? 'text-amber-700 dark:text-amber-400' : undefined },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {/* ── Numbers, as a quiet strip ── */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-5 sm:grid-cols-5">
        {statItems.map((s) => (
          <div key={s.key} className="min-w-0">
            <p className="truncate text-2xs font-medium text-ink-3">{s.label}</p>
            <p className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-[-0.02em]', s.tone ?? 'text-ink')}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="panel overflow-hidden">
        {/* ── Tabs + search ── */}
        <div className="flex flex-col gap-2 border-b border-line ps-2 pe-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-0.5 overflow-x-auto scrollbar-none" role="tablist">
            {TABS.map((x) => {
              const active = tab === x.key;
              return (
                <button
                  key={x.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(x.key)}
                  className={cn('relative flex shrink-0 items-center gap-1.5 px-2.5 py-3 text-[13px] font-medium transition-colors', active ? 'text-ink' : 'text-ink-3 hover:text-ink')}
                >
                  {t(`tabs.${x.key}`)}
                  <span className="text-2xs tabular-nums text-ink-4">{tabCount(x.key)}</span>
                  {active && <motion.span layoutId="leads-tab" className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-brand" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
                </button>
              );
            })}
          </div>
          <SearchField value={search} onChange={setSearch} placeholder={t('search')} className="pb-2 lg:w-72 lg:pb-0" />
        </div>

        {/* ── List ── */}
        {loading ? (
          <div className="divide-y divide-line">{[0, 1, 2, 3].map((i) => <SkeletonRow key={i} />)}</div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Target}
            title={leads.length > 0 ? t('empty.filtered') : t('empty.title')}
            description={leads.length > 0 ? undefined : t('empty.subtitle')}
          />
        ) : (
          <ul className="stagger divide-y divide-line">
            {visible.map((lead) => (
              <LeadRow
                key={lead.id}
                lead={lead}
                lang={lang}
                analyzing={analyzingId === lead.contactId}
                onAnalyze={() => analyze(lead)}
                onOpenChat={() => openChat(lead)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Lead row (expandable) ─────────────────────────────────────────────────────
function LeadRow({
  lead, lang, analyzing, onAnalyze, onOpenChat,
}: {
  lead: Lead;
  lang: string;
  analyzing: boolean;
  onAnalyze: () => void;
  onOpenChat: () => void;
}) {
  const { t } = useTranslation('leads');
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<LeadStatusEvent[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const summary = localizedText(lead, 'summary', lang);
  const recommendation = localizedText(lead, 'recommendation', lang);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && history === null) {
      setLoadingHistory(true);
      try {
        const data = await api.get(`/api/leads/${lead.contactId}`);
        setHistory(Array.isArray(data?.history) ? data.history : []);
      } catch {
        setHistory([]);
      } finally {
        setLoadingHistory(false);
      }
    }
  };

  return (
    <li className={cn('relative transition-colors', expanded ? 'bg-raised/40' : 'hover:bg-raised/40')}>
      {lead.needsAttention && <span className="absolute inset-y-3 start-0 w-[3px] rounded-e-full bg-red-500" aria-hidden="true" />}
      <div className="flex items-start gap-3 px-4 py-3.5">
        <LeadAvatar lead={lead} className="h-10 w-10 text-sm" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-[14px] font-medium text-ink">
              {lead.contact?.name
                ? lead.contact.name
                : lead.contact?.phone
                  ? <span dir="ltr">{'‎'}{lead.contact.phone}</span>
                  : '—'}
            </p>
            <StatusBadge status={lead.status} />
            {lead.priority !== 'NORMAL' && <PriorityBadge priority={lead.priority} />}
            <FlagChips lead={lead} />
          </div>
          {summary && <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-ink-2"><bdi>{summary}</bdi></p>}
          <p className="mt-1.5 text-2xs text-ink-4">
            {lead.contact?.name && <span dir="ltr" className="me-2 tabular-nums">{'‎'}{lead.contact.phone}</span>}
            {t('lastAnalyzed', { time: timeAgo(lead.lastAnalyzedAt, t) })}
          </p>
        </div>

        {/* Score: the number for precision, the bar for a glance */}
        <div className="hidden w-20 shrink-0 flex-col items-end gap-1.5 sm:flex">
          <p className={cn('text-xl font-semibold leading-none tabular-nums', scoreColor(lead.score))}>{lead.score}</p>
          <span className="h-1 w-full overflow-hidden rounded-full bg-raised ring-1 ring-inset ring-line">
            <span className={cn('grow-x block h-full rounded-full', lead.score >= 75 ? 'bg-red-500' : lead.score >= 50 ? 'bg-amber-500' : 'bg-brand')} style={{ width: `${Math.max(4, Math.min(100, lead.score))}%` }} />
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onOpenChat} disabled={!lead.contact?.phone} className="btn btn-secondary btn-sm">
            <MessageSquare aria-hidden="true" />
            <span className="hidden md:inline">{t('openConversation')}</span>
          </button>
          <button type="button" onClick={onAnalyze} disabled={analyzing} className="btn btn-ghost btn-icon btn-sm" title={analyzing ? t('analyzing') : t('reanalyze')} aria-label={t('reanalyze')}>
            <RefreshCw className={cn(analyzing && 'animate-spin')} aria-hidden="true" />
          </button>
          <button type="button" onClick={toggle} aria-expanded={expanded} className="btn btn-ghost btn-icon btn-sm" title={t('history')} aria-label={t('history')}>
            <ChevronDown className={cn('transition-transform duration-base', expanded && 'rotate-180')} aria-hidden="true" />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="grid gap-5 px-4 pb-4 ps-[4.25rem] md:grid-cols-3">
              {recommendation && (
                <Detail label={t('recommendation')}>
                  <p className="rounded-lg border-s-[3px] border-brand bg-brand/[0.06] px-3 py-2 text-[13px] leading-5 text-ink-2"><bdi>{recommendation}</bdi></p>
                </Detail>
              )}
              <Detail label={t('signals')}>
                <SignalChips signals={lead.signals} />
              </Detail>
              <Detail label={t('history')}>
                {loadingHistory ? (
                  <Skeleton className="h-4 w-32 rounded" />
                ) : !history || history.length === 0 ? (
                  <p className="text-xs text-ink-3">{t('noHistory')}</p>
                ) : (
                  <ol className="space-y-1.5">
                    {history.map((h) => (
                      <li key={h.id} className="flex items-center gap-2 text-xs">
                        <History className="h-3.5 w-3.5 shrink-0 text-ink-4" />
                        <span className={cn('chip', STATUS_CFG[h.toStatus].badge)}>{t(`status.${h.toStatus}`)}</span>
                        {h.fromStatus && <span className="text-2xs text-ink-4">← {t(`status.${h.fromStatus}`)}</span>}
                        <span className="ms-auto text-2xs tabular-nums text-ink-4">{timeAgo(h.createdAt, t)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Detail>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-2">{label}</p>
      {children}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-4">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-1/3 rounded" />
        <Skeleton className="h-3 w-2/3 rounded" />
      </div>
      <Skeleton className="h-6 w-16 rounded" />
    </div>
  );
}
