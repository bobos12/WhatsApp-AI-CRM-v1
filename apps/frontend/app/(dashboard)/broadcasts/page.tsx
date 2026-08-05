'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, Megaphone, Trash2, Clock, AlertCircle,
  SlidersHorizontal, ArrowUpDown, ArrowUp, ArrowDown, X, Info,
  Search, Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { useSocket } from '../../../hooks/useSocket';
import { useToast } from '../../../hooks/useToast';
import { useSessionStatus } from '../../../hooks/useSessionStatus';
import { TablePagination } from '../../../components/ui/TablePagination';
import FriendlyError from '../../../components/ui/FriendlyError';
import { classifyError } from '../../../lib/friendly-error';
import { formatSchedule } from '../../../lib/schedule';
import { cn } from '../../../lib/utils';
import {
  ALL_STATUSES, BroadcastActions, MEDIA_ICONS, STATUS_DOTS, STATUS_STYLES,
  RiskBadge, deliveryStats, useCountdownLabel, type BroadcastSummary as Broadcast,
} from '../../../components/broadcasts/shared';
import AccountHealthBanner from '../../../components/broadcasts/AccountHealthBanner';
import ConfirmRiskDialog from '../../../components/broadcasts/ConfirmRiskDialog';

type BroadcastSortKey = 'name' | 'status' | 'recipientCount' | 'totalSent' | 'progress' | 'createdAt';

/**
 * A scheduled broadcast shows when it will fire, plus how long until then; anything
 * else shows when it was created. The absolute time is printed straight from the
 * stored wall clock and its zone, so the list shows exactly what the user typed and
 * exactly what the scheduler will act on.
 */
function WhenCell({ broadcast, now }: { broadcast: Broadcast; now: number }) {
  const scheduled = broadcast.status === 'SCHEDULED' && broadcast.scheduledAtLocal;
  const countdown = useCountdownLabel(scheduled ? broadcast.scheduledAt : null, now);

  if (!scheduled) {
    return (
      <span>{new Date(broadcast.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
    );
  }

  return (
    <div className="min-w-0">
      <span
        className="inline-flex items-center gap-1 text-blue-500 dark:text-blue-300"
        title={`${broadcast.scheduledAtLocal} · ${broadcast.timezone}`}
      >
        <Clock className="h-3 w-3 shrink-0" />
        <span className="truncate">{formatSchedule(broadcast.scheduledAtLocal, broadcast.timezone)}</span>
      </span>
      {countdown && (
        <p className={cn('mt-0.5 text-[11px]', countdown.overdue ? 'text-amber-500' : 'text-gray-400 dark:text-[#8696A0]/70')}>
          {countdown.label}
        </p>
      )}
    </div>
  );
}

function DeliveryCell({ broadcast }: { broadcast: Broadcast }) {
  const { t } = useTranslation('broadcasts');
  const { total, attempted, sentPct, failedPct, successRate } = deliveryStats(broadcast);

  if (!total) return <span className="text-sm text-gray-400 dark:text-[#8696A0]/60">—</span>;

  // Nothing has been attempted yet: show the size of the audience, not a 0% bar
  // that reads like a failure.
  if (broadcast.status === 'DRAFT' || broadcast.status === 'SCHEDULED') {
    return (
      <span className="text-sm text-gray-500 dark:text-[#8696A0]">
        {t('delivery.queued', { count: total, defaultValue: '{{count}} queued' })}
      </span>
    );
  }

  return (
    <div className="min-w-[9rem]">
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-white/10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={attempted}
      >
        <div className="h-full bg-[#25D366] transition-all" style={{ width: `${sentPct}%` }} />
        <div className="h-full bg-red-400 transition-all" style={{ width: `${failedPct}%` }} />
      </div>
      <p className="mt-1 text-[11px] tabular-nums text-gray-500 dark:text-[#8696A0]">
        <span className="font-medium text-gray-900 dark:text-white">{broadcast.totalSent.toLocaleString()}</span>
        {' / '}{total.toLocaleString()}
        {broadcast.totalFailed > 0 && (
          <span className="text-red-400">
            {' · '}{t('delivery.failedCount', { count: broadcast.totalFailed, defaultValue: '{{count}} failed' })}
          </span>
        )}
        {successRate !== null && attempted === total && (
          <span className="text-gray-400 dark:text-[#8696A0]/70"> · {successRate}%</span>
        )}
      </p>
    </div>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return dir === 'asc'
    ? <ArrowUp className="h-3 w-3 text-[#25D366]" />
    : <ArrowDown className="h-3 w-3 text-[#25D366]" />;
}

export default function BroadcastsPage() {
  const router = useRouter();
  const { t } = useTranslation('broadcasts');
  const { t: tErr } = useTranslation('errors');
  const { success, error: toastError } = useToast();
  const { status: waStatus } = useSessionStatus() as { status?: string };

  // Turn a raw send/pause/delete error into a short, friendly toast headline.
  const explainToast = (err: unknown) => toastError(tErr(`friendly.${classifyError(err).code}.title`));

  // ─── data ─────────────────────────────────────────────────────────────────
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading]       = useState(true);

  // ─── row actions ──────────────────────────────────────────────────────────
  const [sendingId, setSendingId]             = useState<string | null>(null);
  /** Set when the server answered 428 — the campaign and the reason to show. */
  const [riskConfirm, setRiskConfirm]         = useState<{ id: string; reason: string | null } | null>(null);
  const [deletingId, setDeletingId]           = useState<string | null>(null);
  const [pausingId, setPausingId]             = useState<string | null>(null);
  const [busyId, setBusyId]                   = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // ─── search & advanced filters ────────────────────────────────────────────
  const [search, setSearch]             = useState('');
  const [showFilters, setShowFilters]   = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [dateFrom, setDateFrom]         = useState('');
  const [dateTo, setDateTo]             = useState('');

  // ─── sort ─────────────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<BroadcastSortKey | null>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // ─── pagination ───────────────────────────────────────────────────────────
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // ─── selection ────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds]         = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting]       = useState(false);

  // ─── Load ─────────────────────────────────────────────────────────────────

  const fetchBroadcasts = useCallback(async () => {
    try {
      const data = await api.get('/api/broadcasts');
      setBroadcasts(Array.isArray(data) ? data : []);
    } catch {
      setBroadcasts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBroadcasts(); }, [fetchBroadcasts]);

  const onBroadcastProgress = useCallback(
    ({ broadcastId, sent, failed }: { broadcastId: string; sent: number; failed: number; total: number }) => {
      setBroadcasts((prev) =>
        prev.map((b) =>
          b.id === broadcastId ? { ...b, totalSent: sent, totalFailed: failed, status: 'SENDING' } : b,
        ),
      );
    },
    [],
  );

  const onBroadcastComplete = useCallback(
    ({ broadcastId, sent, failed, status }: { broadcastId: string; sent: number; failed: number; total: number; status: string }) => {
      setBroadcasts((prev) =>
        prev.map((b) =>
          b.id === broadcastId ? { ...b, totalSent: sent, totalFailed: failed, status } : b,
        ),
      );
    },
    [],
  );

  useSocket('broadcast:progress', onBroadcastProgress);
  useSocket('broadcast:complete', onBroadcastComplete);

  // A single clock for every countdown on the page. Ticking once a minute keeps
  // "in 2h 15m" honest without re-rendering the table every second.
  const [now, setNow] = useState(() => Date.now());
  const hasScheduled = broadcasts.some((b) => b.status === 'SCHEDULED');
  useEffect(() => {
    if (!hasScheduled) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [hasScheduled]);

  // ─── Derived data ─────────────────────────────────────────────────────────

  const processedBroadcasts = useMemo(() => {
    let data = [...broadcasts];

    const query = search.trim().toLowerCase();
    if (query) data = data.filter((b) => b.name.toLowerCase().includes(query));

    if (filterStatus) data = data.filter((b) => b.status === filterStatus);
    if (dateFrom) data = data.filter((b) => new Date(b.createdAt) >= new Date(dateFrom));
    if (dateTo)   data = data.filter((b) => new Date(b.createdAt) <= new Date(dateTo + 'T23:59:59'));
    if (sortKey) {
      data.sort((a, b) => {
        let cmp = 0;
        if (sortKey === 'totalSent' || sortKey === 'recipientCount') {
          cmp = a[sortKey] - b[sortKey];
        } else if (sortKey === 'progress') {
          cmp = deliveryStats(a).attemptedPct - deliveryStats(b).attemptedPct;
        } else if (sortKey === 'createdAt') {
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        } else {
          cmp = String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''));
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return data;
  }, [broadcasts, search, filterStatus, dateFrom, dateTo, sortKey, sortDir]);

  const totalCount = processedBroadcasts.length;

  const paginatedBroadcasts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return processedBroadcasts.slice(start, start + pageSize);
  }, [processedBroadcasts, page, pageSize]);

  // ─── Stats ────────────────────────────────────────────────────────────────

  const totals = broadcasts.reduce(
    (acc, b) => {
      acc.total += 1;
      acc.sent  += b.totalSent;
      acc.failed += b.totalFailed;
      if (b.status === 'SCHEDULED') acc.scheduled += 1;
      if (b.status === 'SENDING')   acc.sending   += 1;
      if (b.status === 'DRAFT')     acc.drafts    += 1;
      return acc;
    },
    { total: 0, sent: 0, failed: 0, scheduled: 0, sending: 0, drafts: 0 },
  );

  // ─── Sort ─────────────────────────────────────────────────────────────────

  const handleSort = (key: BroadcastSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  };

  const SortTh = ({ k, label, className }: { k: BroadcastSortKey; label: string; className?: string }) => (
    <th
      scope="col"
      aria-label={label}
      onClick={() => handleSort(k)}
      className={cn(
        'cursor-pointer select-none px-3 py-4 text-start text-xs font-semibold uppercase tracking-wider transition-colors lg:px-5 xl:px-6',
        sortKey === k ? 'text-[#25D366]' : 'text-gray-500 dark:text-[#8696A0] hover:text-gray-900 dark:hover:text-white',
        className,
      )}
    >
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        {label}
        <SortIcon active={sortKey === k} dir={sortDir} />
      </span>
    </th>
  );

  // ─── Selection ────────────────────────────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const pageIds = paginatedBroadcasts.map((b) => b.id);
    const allSel = pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSel) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const allPageSelected =
    paginatedBroadcasts.length > 0 && paginatedBroadcasts.every((b) => selectedIds.has(b.id));
  const somePageSelected =
    !allPageSelected && paginatedBroadcasts.some((b) => selectedIds.has(b.id));

  // ─── Row actions ──────────────────────────────────────────────────────────

  /**
   * 428 means the server rated this campaign critical risk and wants an explicit
   * acknowledgement. Anything else is a real failure. Sending `acknowledged`
   * blindly on the first attempt would defeat the check entirely, so the retry
   * only ever happens after the user has seen the dialog.
   */
  const handleSendBroadcast = async (id: string, acknowledged = false) => {
    try {
      setSendingId(id);
      await api.post(`/api/broadcasts/${id}/send`, acknowledged ? { acknowledged: true } : {});
      success('Broadcast started sending.');
      setRiskConfirm(null);
      await fetchBroadcasts();
    } catch (err) {
      if ((err as { status?: number })?.status === 428) {
        setRiskConfirm({ id, reason: err instanceof Error ? err.message : null });
        return;
      }
      explainToast(err);
    } finally {
      setSendingId(null);
    }
  };

  const handlePauseBroadcast = async (id: string) => {
    try {
      setPausingId(id);
      await api.post(`/api/broadcasts/${id}/pause`, {});
      success('Broadcast paused.');
      await fetchBroadcasts();
    } catch (err) {
      explainToast(err);
    } finally {
      setPausingId(null);
    }
  };

  const handleResumeBroadcast = async (id: string) => {
    try {
      setPausingId(id);
      await api.post(`/api/broadcasts/${id}/resume`, {});
      success('Broadcast resumed.');
      await fetchBroadcasts();
    } catch (err) {
      explainToast(err);
    } finally {
      setPausingId(null);
    }
  };

  /** Copy a campaign, audience and attachment included. The copy lands as a draft. */
  const handleDuplicate = async (id: string) => {
    try {
      setBusyId(id);
      const copy = await api.post<Broadcast>(`/api/broadcasts/${id}/duplicate`, {});
      setBroadcasts((prev) => [copy, ...prev]);
      success(t('toasts.duplicated', { defaultValue: 'Broadcast duplicated as a draft.' }));
    } catch (err) {
      explainToast(err);
    } finally {
      setBusyId(null);
    }
  };

  /** Cancel a schedule without sending — the broadcast returns to draft. */
  const handleUnschedule = async (id: string) => {
    try {
      setBusyId(id);
      await api.post(`/api/broadcasts/${id}/unschedule`, {});
      success(t('toasts.unscheduled', { defaultValue: 'Schedule cancelled. The broadcast is back in drafts.' }));
      await fetchBroadcasts();
    } catch (err) {
      explainToast(err);
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteBroadcast = async (id: string) => {
    const snapshot = broadcasts;
    // Deleting a campaign that is mid-flight stops the send too — report that,
    // so the user knows the remaining recipients were spared and isn't left
    // wondering whether messages are still going out behind a vanished row.
    const status = broadcasts.find((b) => b.id === id)?.status;
    const wasLive = status === 'SENDING' || status === 'PAUSED';
    setBroadcasts((prev) => prev.filter((b) => b.id !== id));
    setConfirmDeleteId(null);
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setDeletingId(id);
    try {
      await api.delete(`/api/broadcasts/${id}`);
      success(wasLive ? 'Broadcast stopped and deleted.' : 'Broadcast deleted.');
      router.refresh();
    } catch (err) {
      setBroadcasts(snapshot);
      explainToast(err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    const snapshot = broadcasts;
    setBroadcasts((prev) => prev.filter((b) => !selectedIds.has(b.id)));
    try {
      await Promise.allSettled(ids.map((id) => api.delete(`/api/broadcasts/${id}`)));
      success(`${ids.length} broadcast${ids.length !== 1 ? 's' : ''} deleted.`);
    } catch {
      setBroadcasts(snapshot);
      toastError('Some broadcasts could not be deleted.');
    } finally {
      setSelectedIds(new Set());
      setShowBulkConfirm(false);
      setBulkDeleting(false);
    }
  };

  // ─── Derived helpers ──────────────────────────────────────────────────────

  const advancedFilterCount = (filterStatus ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);
  const hasAnyFilter = advancedFilterCount > 0 || search.trim().length > 0;

  const clearAdvancedFilters = () => {
    setFilterStatus('');
    setDateFrom('');
    setDateTo('');
    setSearch('');
    setPage(1);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <section className="relative overflow-hidden rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#111B21] p-4 sm:p-6 shadow-[0_8px_20px_rgba(0,0,0,0.2)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,211,102,0.08),transparent_40%)]" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#25D366]/30 bg-[#25D366]/10 px-3 py-1.5 text-xs font-medium text-[#25D366]">
              <Megaphone className="h-3.5 w-3.5" />
              {t('badge')}
            </div>
            <h1 className="mt-3 text-2xl sm:text-3xl font-semibold text-gray-900 dark:text-white">{t('title')}</h1>
            <p className="mt-1.5 text-sm text-gray-500 dark:text-[#8696A0]">
              {t('subtitle')}
            </p>
          </div>
          <Link
            href="/broadcasts/new"
            className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-[#25D366]/90 transition-colors self-start lg:self-auto"
          >
            <Plus className="h-4 w-4" />
            {t('newBroadcast')}
          </Link>
        </div>
      </section>

      {/* ── Account health ──
          Above the stats on purpose: what the number can safely send today is
          more decision-relevant than how many campaigns have ever been created. */}
      <AccountHealthBanner />

      {/* ── Stats cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label={t('stats.totalBroadcasts')} value={totals.total}    sub={t('stats.allCampaigns')} />
        <StatCard label={t('stats.messagesSent')}    value={totals.sent}     sub={t('stats.cumulativeDeliveries')} highlight />
        <StatCard label={t('stats.failed')}          value={totals.failed}   sub={t('stats.sendFailures')} error={totals.failed > 0} />
        <StatCard
          label={t('stats.inFlight')}
          value={totals.scheduled + totals.sending + totals.drafts}
          sub={t('stats.inFlightSub')}
          pulse={totals.sending > 0}
        />
      </div>

      {/* ── Why did messages fail? — friendly, actionable explanation ── */}
      {totals.failed > 0 && (
        waStatus === 'disconnected' ? (
          <FriendlyError classified={{ code: 'whatsappDisconnected', severity: 'error', values: {}, raw: '' }} />
        ) : (
          <div className="rounded-2xl border border-amber-300/60 bg-amber-50 p-4 dark:border-amber-500/25 dark:bg-amber-500/[0.07]">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                <Info className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  {t('failureInsight.title', { count: totals.failed })}
                </p>
                <p className="mt-0.5 text-[13px] text-amber-800/90 dark:text-amber-300/80">
                  {t('failureInsight.intro')}
                </p>
                <ul className="mt-2 space-y-1 text-[13px] text-amber-800/90 dark:text-amber-300/80">
                  {['reasonNotOnWhatsapp', 'reasonWarmup', 'reasonDisconnected', 'reasonInvalid'].map((k) => (
                    <li key={k} className="flex gap-2">
                      <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                      <span>{t(`failureInsight.${k}`)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 text-[13px] font-medium text-amber-900 dark:text-amber-200">
                  {t('failureInsight.tip')}
                </p>
              </div>
            </div>
          </div>
        )
      )}

      {/* ── Table ── */}
      <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#111B21] overflow-hidden">

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-white/10">
          <div className="flex items-center gap-3">
            {/* Select-all for the card list, which has no header row of its own */}
            <label className="flex cursor-pointer items-center gap-2 md:hidden">
              <input
                type="checkbox"
                checked={allPageSelected}
                ref={(el) => { if (el) el.indeterminate = somePageSelected; }}
                onChange={toggleAll}
                className="h-4 w-4 cursor-pointer rounded border-gray-300 dark:border-white/20 accent-[#25D366]"
              />
            </label>
            <p className="text-xs text-gray-500 dark:text-[#8696A0]">
              {totalCount} {totalCount === 1 ? t('table.name').toLowerCase() : t('title').toLowerCase()}
              {selectedIds.size > 0 && (
                <span className="ms-2 font-medium text-[#25D366]">· {selectedIds.size}</span>
              )}
            </p>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-gray-500 dark:text-[#8696A0] hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                {t('common:actions.deselectAll')}
              </button>
            )}
          </div>

          <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
            <div className="relative flex-1 sm:w-56 sm:flex-none">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-[#8696A0]" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder={t('searchPlaceholder')}
                className="h-9 w-full rounded-xl border border-gray-200 bg-gray-50 ps-9 pe-8 text-sm text-gray-900 outline-none transition-colors focus:border-[#25D366]/50 dark:border-white/10 dark:bg-[#202C33] dark:text-white dark:placeholder:text-[#8696A0]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setPage(1); }}
                  aria-label={t('clearFilters')}
                  className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowFilters((f) => !f)}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm transition-colors',
                showFilters || advancedFilterCount > 0
                  ? 'border-[#25D366]/40 bg-[#25D366]/10 text-[#25D366]'
                  : 'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-500 dark:text-[#8696A0] hover:bg-gray-100 dark:hover:bg-white/10',
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="hidden sm:inline">{t('common:actions.filter')}</span>
              {advancedFilterCount > 0 && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#25D366] px-1 text-[10px] font-bold text-slate-950">
                  {advancedFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Advanced filter panel */}
        {showFilters && (
          <div className="border-b border-gray-200 dark:border-white/10 bg-gray-100 dark:bg-[#0B141A] px-4 sm:px-6 py-4">
            <div className="flex flex-wrap items-end gap-3 sm:gap-4">
              <div className="w-full sm:w-auto">
                <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-[#8696A0]">{t('common:labels.status')}</p>
                <select
                  value={filterStatus}
                  onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
                  className="h-9 w-full sm:w-auto rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#16A34A]/50 dark:border-white/10 dark:bg-[#202C33] dark:text-white dark:focus:border-[#25D366]/50"
                >
                  <option value="">{t('allStatuses')}</option>
                  {ALL_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                </select>
              </div>
              <div className="w-full sm:w-auto">
                <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-[#8696A0]">{t('createdFrom')}</p>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                  className="h-9 w-full sm:w-auto rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#16A34A]/50 dark:border-white/10 dark:bg-[#202C33] dark:text-white dark:focus:border-[#25D366]/50"
                />
              </div>
              <div className="w-full sm:w-auto">
                <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-[#8696A0]">{t('createdTo')}</p>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                  className="h-9 w-full sm:w-auto rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-[#16A34A]/50 dark:border-white/10 dark:bg-[#202C33] dark:text-white dark:focus:border-[#25D366]/50"
                />
              </div>
              {advancedFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearAdvancedFilters}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 dark:border-white/10 px-3 text-sm text-gray-500 dark:text-[#8696A0] hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                >
                  <X className="h-3.5 w-3.5" /> {t('clearFilters')}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Card list — phones and small tablets, where a 7-column table can't fit ── */}
        <div className="divide-y divide-gray-100 md:hidden dark:divide-white/5">
          {loading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse px-4 py-4 space-y-2">
                <div className="h-4 w-2/3 rounded bg-gray-100 dark:bg-white/8" />
                <div className="h-5 w-20 rounded-full bg-gray-100 dark:bg-white/8" />
                <div className="flex gap-4">
                  <div className="h-3 w-14 rounded bg-gray-50 dark:bg-white/5" />
                  <div className="h-3 w-14 rounded bg-gray-50 dark:bg-white/5" />
                </div>
              </div>
            ))
          ) : paginatedBroadcasts.length === 0 ? (
            <div className="px-4 py-16 text-center">
              <Megaphone className="mx-auto mb-3 h-8 w-8 text-gray-400 dark:text-[#8696A0]/30" />
              <p className="text-sm text-gray-500 dark:text-[#8696A0]">
                {hasAnyFilter ? t('noResults') : t('noBroadcasts')}
              </p>
              {hasAnyFilter ? (
                <button type="button" onClick={clearAdvancedFilters} className="mt-2 text-xs text-[#25D366] hover:underline">{t('clearFilters')}</button>
              ) : (
                <Link href="/broadcasts/new" className="mt-2 inline-flex items-center gap-1 text-xs text-[#25D366] hover:underline">
                  <Plus className="h-3 w-3" /> {t('noBroadcastsSubtitle')}
                </Link>
              )}
            </div>
          ) : (
            paginatedBroadcasts.map((broadcast) => (
              <div
                key={broadcast.id}
                className={cn(
                  'px-4 py-3 transition-colors',
                  selectedIds.has(broadcast.id) && 'bg-[#25D366]/8',
                )}
              >
                {/* top row: checkbox + name + status */}
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(broadcast.id)}
                    onChange={() => toggleSelect(broadcast.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 dark:border-white/20 accent-[#25D366]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/broadcasts/${broadcast.id}`}
                        className="truncate text-sm font-semibold text-gray-900 hover:text-[#25D366] dark:text-white dark:hover:text-[#25D366]"
                      >
                        {broadcast.name}
                      </Link>
                      {broadcast.mediaType && MEDIA_ICONS[broadcast.mediaType] && (
                        <span className="inline-flex items-center rounded-full bg-[#25D366]/12 p-1 text-[#25D366]">
                          {(() => { const Icon = MEDIA_ICONS[broadcast.mediaType!]; return <Icon className="h-2.5 w-2.5" />; })()}
                        </span>
                      )}
                      <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_STYLES[broadcast.status] ?? STATUS_STYLES.DRAFT)}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOTS[broadcast.status] ?? 'bg-gray-400')} />
                        {t(`status.${broadcast.status}`, { defaultValue: broadcast.status })}
                      </span>
                      <RiskBadge level={broadcast.riskLevel} score={broadcast.riskScore} />
                    </div>

                    {/* meta row */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-[#8696A0]">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> {broadcast.recipientCount.toLocaleString()}
                      </span>
                      <WhenCell broadcast={broadcast} now={now} />
                    </div>

                    <div className="mt-2 max-w-[16rem]">
                      <DeliveryCell broadcast={broadcast} />
                    </div>

                    {broadcast.lastError && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-red-400">
                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                        {broadcast.lastError}
                      </p>
                    )}

                    {/* action row */}
                    <div className="mt-2.5">
                      <BroadcastActions
                        broadcast={broadcast}
                        align="start"
                        busy={busyId === broadcast.id || deletingId === broadcast.id}
                        sending={sendingId === broadcast.id}
                        pausing={pausingId === broadcast.id}
                        confirming={confirmDeleteId === broadcast.id}
                        onView={() => router.push(`/broadcasts/${broadcast.id}`)}
                        onSend={() => handleSendBroadcast(broadcast.id)}
                        onPause={() => handlePauseBroadcast(broadcast.id)}
                        onResume={() => handleResumeBroadcast(broadcast.id)}
                        onEdit={() => router.push(`/broadcasts/${broadcast.id}/edit`)}
                        onDuplicate={() => handleDuplicate(broadcast.id)}
                        onUnschedule={() => handleUnschedule(broadcast.id)}
                        onAskDelete={() => setConfirmDeleteId(broadcast.id)}
                        onConfirmDelete={() => handleDeleteBroadcast(broadcast.id)}
                        onCancelDelete={() => setConfirmDeleteId(null)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/*
          ── Table — tablets and up ──
          Columns drop out as the viewport narrows, most-dispensable first:
          "Audience" below xl (its number is already inside the delivery cell) and
          "When" below lg. `overflow-x-auto` is the last resort, not the plan.
        */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#202C33]">
                <th scope="col" className="w-10 px-3 py-4 lg:px-5 xl:px-6">
                  <span className="sr-only">Select</span>
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    ref={(el) => { if (el) el.indeterminate = somePageSelected; }}
                    onChange={toggleAll}
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 dark:border-white/20 accent-[#25D366]"
                  />
                </th>
                <SortTh k="name"           label={t('table.campaign', { defaultValue: 'Campaign' })} />
                <SortTh k="status"         label={t('table.status')} />
                <SortTh k="recipientCount" label={t('table.audience', { defaultValue: 'Audience' })} className="hidden xl:table-cell" />
                <SortTh k="progress"       label={t('table.delivery', { defaultValue: 'Delivery' })} />
                <SortTh k="createdAt"      label={t('table.when', { defaultValue: 'When' })} className="hidden lg:table-cell" />
                <th scope="col" className="px-3 py-4 text-end text-xs font-semibold uppercase tracking-wider text-gray-500 lg:px-5 xl:px-6 dark:text-[#8696A0]">
                  {t('table.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
              {loading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-3 py-4 lg:px-5 xl:px-6"><div className="h-4 w-4 rounded bg-gray-100 dark:bg-white/8" /></td>
                    <td className="px-3 py-4 lg:px-5 xl:px-6"><div className="h-4 w-40 rounded bg-gray-100 dark:bg-white/8" /></td>
                    <td className="px-3 py-4 lg:px-5 xl:px-6"><div className="h-5 w-20 rounded-full bg-gray-100 dark:bg-white/8" /></td>
                    <td className="hidden px-3 py-4 lg:px-5 xl:table-cell xl:px-6"><div className="h-3 w-8 rounded bg-gray-50 dark:bg-white/5" /></td>
                    <td className="px-3 py-4 lg:px-5 xl:px-6"><div className="h-3 w-8 rounded bg-gray-50 dark:bg-white/5" /></td>
                    <td className="hidden px-3 py-4 lg:table-cell lg:px-5 xl:px-6"><div className="h-3 w-20 rounded bg-gray-50 dark:bg-white/5" /></td>
                    <td className="px-3 py-4 lg:px-5 xl:px-6"><div className="h-7 w-24 rounded bg-gray-50 dark:bg-white/5" /></td>
                  </tr>
                ))
              ) : paginatedBroadcasts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <Megaphone className="mx-auto mb-3 h-8 w-8 text-gray-400 dark:text-[#8696A0]/30" />
                    <p className="text-sm text-gray-500 dark:text-[#8696A0]">
                      {hasAnyFilter ? t('noResults') : t('noBroadcasts')}
                    </p>
                    {hasAnyFilter ? (
                      <button
                        type="button"
                        onClick={clearAdvancedFilters}
                        className="mt-2 text-xs text-[#25D366] hover:underline"
                      >
                        {t('clearFilters')}
                      </button>
                    ) : (
                      <Link
                        href="/broadcasts/new"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-[#25D366] hover:underline"
                      >
                        <Plus className="h-3 w-3" /> {t('noBroadcastsSubtitle')}
                      </Link>
                    )}
                  </td>
                </tr>
              ) : (
                paginatedBroadcasts.map((broadcast) => {
                  const MediaIcon = broadcast.mediaType ? MEDIA_ICONS[broadcast.mediaType] : null;
                  return (
                  <tr
                    key={broadcast.id}
                    className={cn(
                      'transition-colors hover:bg-gray-50 dark:hover:bg-white/3',
                      selectedIds.has(broadcast.id) && 'bg-[#25D366]/8',
                    )}
                  >
                    <td className="px-3 py-3 lg:px-5 xl:px-6">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(broadcast.id)}
                        onChange={() => toggleSelect(broadcast.id)}
                        className="h-4 w-4 cursor-pointer rounded border-gray-300 dark:border-white/20 accent-[#25D366]"
                      />
                    </td>
                    <td className="max-w-[12rem] px-3 py-3 lg:px-5 xl:max-w-none xl:px-6">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/broadcasts/${broadcast.id}`}
                          className="truncate text-sm font-medium text-gray-900 hover:text-[#25D366] dark:text-white dark:hover:text-[#25D366]"
                        >
                          {broadcast.name}
                        </Link>
                        {MediaIcon && (
                          <span
                            title={broadcast.mediaType ?? undefined}
                            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#25D366]/12 px-1.5 py-0.5 text-[10px] font-medium text-[#25D366]"
                          >
                            <MediaIcon className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>
                      {broadcast.lastError && (
                        <span className="mt-0.5 flex items-start gap-1 text-[11px] font-normal text-red-400">
                          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="line-clamp-2">{broadcast.lastError}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 lg:px-5 xl:px-6">
                      <div className="flex flex-col items-start gap-1">
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', STATUS_STYLES[broadcast.status] ?? STATUS_STYLES.DRAFT)}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOTS[broadcast.status] ?? 'bg-gray-400')} />
                          {t(`status.${broadcast.status}`, { defaultValue: broadcast.status })}
                        </span>
                        <RiskBadge level={broadcast.riskLevel} score={broadcast.riskScore} />
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 lg:px-5 xl:table-cell xl:px-6">
                      <span className="inline-flex items-center gap-1.5 text-sm tabular-nums text-gray-500 dark:text-[#8696A0]">
                        <Users className="h-3.5 w-3.5 shrink-0 opacity-60" />
                        {broadcast.recipientCount.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-3 py-3 lg:px-5 xl:px-6">
                      <DeliveryCell broadcast={broadcast} />
                    </td>
                    <td className="hidden px-3 py-3 text-sm text-gray-500 lg:table-cell lg:px-5 xl:px-6 dark:text-[#8696A0]">
                      <WhenCell broadcast={broadcast} now={now} />
                    </td>
                    <td className="px-3 py-3 lg:px-5 xl:px-6">
                      <BroadcastActions
                        broadcast={broadcast}
                        align="end"
                        compact
                        busy={busyId === broadcast.id || deletingId === broadcast.id}
                        sending={sendingId === broadcast.id}
                        pausing={pausingId === broadcast.id}
                        confirming={confirmDeleteId === broadcast.id}
                        onView={() => router.push(`/broadcasts/${broadcast.id}`)}
                        onSend={() => handleSendBroadcast(broadcast.id)}
                        onPause={() => handlePauseBroadcast(broadcast.id)}
                        onResume={() => handleResumeBroadcast(broadcast.id)}
                        onEdit={() => router.push(`/broadcasts/${broadcast.id}/edit`)}
                        onDuplicate={() => handleDuplicate(broadcast.id)}
                        onUnschedule={() => handleUnschedule(broadcast.id)}
                        onAskDelete={() => setConfirmDeleteId(broadcast.id)}
                        onConfirmDelete={() => handleDeleteBroadcast(broadcast.id)}
                        onCancelDelete={() => setConfirmDeleteId(null)}
                      />
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          page={page}
          pageSize={pageSize}
          total={totalCount}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        />
      </div>

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-[var(--bottom-nav-space)] sm:bottom-6 left-1/2 z-40 -translate-x-1/2 flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#202C33] px-5 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {t('selectedCount', { count: selectedIds.size })}
          </span>
          <div className="h-5 w-px bg-gray-200 dark:bg-white/15" />
          {showBulkConfirm ? (
            <>
              <span className="text-xs text-red-300">{t('deleteConfirm.title')} {selectedIds.size}?</span>
              <button type="button" onClick={handleBulkDelete} disabled={bulkDeleting} className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50 transition-colors">
                {bulkDeleting ? t('status.SENDING') : t('deleteConfirm.confirm')}
              </button>
              <button type="button" onClick={() => setShowBulkConfirm(false)} className="rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 py-1.5 text-xs text-gray-500 dark:text-[#8696A0] hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                {t('deleteConfirm.cancel')}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setShowBulkConfirm(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 transition-colors">
                <Trash2 className="h-3.5 w-3.5" /> {t('common:actions.bulkDelete')}
              </button>
              <button type="button" onClick={() => setSelectedIds(new Set())} className="rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 py-1.5 text-xs text-gray-500 dark:text-[#8696A0] hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                {t('common:actions.deselectAll')}
              </button>
            </>
          )}
        </div>
      )}

      <ConfirmRiskDialog
        open={riskConfirm !== null}
        reason={riskConfirm?.reason ?? null}
        busy={sendingId === riskConfirm?.id}
        onConfirm={() => riskConfirm && handleSendBroadcast(riskConfirm.id, true)}
        onCancel={() => {
          const target = riskConfirm?.id;
          setRiskConfirm(null);
          if (target) router.push(`/broadcasts/${target}`);
        }}
      />

      {/* Mobile bottom-nav spacer */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />
    </div>
  );
}

function StatCard({
  label, value, sub, highlight, error, pulse,
}: {
  label: string; value: number; sub: string;
  highlight?: boolean; error?: boolean; pulse?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#111B21] p-3 sm:p-5">
      <p className="text-[10px] sm:text-xs uppercase tracking-[0.18em] sm:tracking-[0.22em] text-gray-500 dark:text-[#8696A0] truncate">{label}</p>
      <div className="mt-1.5 sm:mt-2 flex items-center gap-2">
        <p className={cn('text-2xl sm:text-3xl font-semibold', highlight ? 'text-[#25D366]' : error ? 'text-red-400' : 'text-gray-900 dark:text-white')}>
          {value}
        </p>
        {pulse && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
          </span>
        )}
      </div>
      <p className="mt-1 text-[10px] sm:text-xs text-gray-500 dark:text-[#8696A0] truncate">{sub}</p>
    </div>
  );
}
