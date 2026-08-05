'use client';

/**
 * ─── Broadcast detail ────────────────────────────────────────────────────────
 *
 * Everything the list can only hint at: the exact message that goes out, the
 * attachment as the recipient will see it, when it fires and in whose clock,
 * how delivery is going right now, and who specifically it reached or missed.
 *
 * Two rules this page follows:
 *
 *   1. The schedule is displayed straight from `scheduledAtLocal` + `timezone`.
 *      It is never re-parsed into a `Date` for display, because that would
 *      reinterpret a wall clock as browser-local and shift it.
 *   2. The audience is paged from the server. A campaign can have tens of
 *      thousands of recipients; the page asks for twenty at a time and gets the
 *      status tallies as a separate aggregate.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import {
  ArrowLeft, ArrowRight, Clock, CalendarClock, Users, AlertCircle, Download,
  Search, X, FileText, Loader2, Megaphone, CheckCircle2, XCircle, CircleDashed,
  MessageSquare, Send, ExternalLink, ShieldCheck, MinusCircle, RefreshCw,
} from 'lucide-react';
import { api } from '../../../../lib/api';
import { useSocket } from '../../../../hooks/useSocket';
import { useToast } from '../../../../hooks/useToast';
import { useDirection } from '../../../../hooks/useDirection';
import { TablePagination } from '../../../../components/ui/TablePagination';
import FriendlyError from '../../../../components/ui/FriendlyError';
import { classifyError } from '../../../../lib/friendly-error';
import { formatSchedule, timeZoneLabel } from '../../../../lib/schedule';
import { cn } from '../../../../lib/utils';
import {
  BroadcastActions, MEDIA_ICONS, RiskBadge, StatusPill, SmartBatchProgress, deliveryStats, useCountdownLabel,
  type BroadcastDetail, type BroadcastRecipient,
} from '../../../../components/broadcasts/shared';
import CampaignMonitor from '../../../../components/broadcasts/CampaignMonitor';
import SafetyReport from '../../../../components/broadcasts/SafetyReport';
import ConfirmRiskDialog from '../../../../components/broadcasts/ConfirmRiskDialog';

interface RecipientPage {
  rows: BroadcastRecipient[];
  total: number;
  counts: { pending: number; sent: number; failed: number; skipped: number; total: number };
}

const RECIPIENT_STATUS_STYLES: Record<string, string> = {
  sent:    'text-[#25D366]',
  failed:  'text-red-400',
  pending: 'text-gray-400 dark:text-[#8696A0]',
  // Deliberately neutral, not red: an excluded recipient is the system working,
  // not a delivery that went wrong.
  skipped: 'text-amber-500 dark:text-amber-300/80',
};

const RECIPIENT_STATUS_ICONS: Record<string, typeof CheckCircle2> = {
  sent: CheckCircle2,
  failed: XCircle,
  pending: CircleDashed,
  skipped: MinusCircle,
};

/**
 * Plain-language fallbacks for the machine reasons the server records, so a
 * missing translation degrades to an English sentence rather than to
 * "COLD_REACHOUT_463".
 */
const SKIP_REASON_FALLBACK: Record<string, string> = {
  OPTED_OUT: 'Asked to stop receiving messages',
  SUPPRESSED: 'On the do-not-message list',
  COOLDOWN: 'Received another campaign too recently',
  INVALID_PHONE: 'Not a valid phone number',
  COLD_EXCLUDED: 'Has never messaged you — excluded by choice',
  ALREADY_RECEIVED: 'Already received this message',
  DUPLICATE: 'Listed more than once',
  QUOTA: "Beyond today's safe sending volume",
};

const ERROR_CODE_FALLBACK: Record<string, string> = {
  COLD_REACHOUT_463: 'WhatsApp blocked this as cold outreach (463)',
  BLOCKED_403: 'This person has blocked your number',
  NOT_ON_WHATSAPP: 'This number is not on WhatsApp',
  DISCONNECTED: 'WhatsApp was disconnected',
  QUOTA: 'Daily sending limit reached',
  RATE_LIMITED: 'Sending too quickly — WhatsApp throttled this',
  TIMEOUT: 'WhatsApp did not respond in time',
  INVALID_PHONE: 'Not a valid phone number',
  UNKNOWN: 'Delivery failed',
};

/** The message-type labels the composer already ships, reused for the badge. */
const MEDIA_LABEL_KEYS: Record<string, string> = {
  IMAGE: 'form.typeImage',
  VIDEO: 'form.typeVideo',
  DOCUMENT: 'form.typeDocument',
  AUDIO: 'form.typeVoice',
  VOICE: 'form.typeVoice',
};

/** A labelled fact. The whole page is built out of these. */
function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-[#8696A0]">{label}</p>
      <div className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{value}</div>
      {hint && <p className="mt-0.5 text-[11px] text-gray-500 dark:text-[#8696A0]">{hint}</p>}
    </div>
  );
}

function Card({ title, icon: Icon, children, action }: {
  title: string;
  icon: typeof Users;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#111B21]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 sm:px-5 dark:border-white/10">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <Icon className="h-4 w-4 text-[#25D366]" />
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/** The attachment, rendered the way the recipient will experience it. */
function MediaPreview({ broadcast }: { broadcast: BroadcastDetail }) {
  const { t } = useTranslation('broadcasts');
  if (!broadcast.mediaUrl) return null;

  const type = broadcast.mediaType ?? '';
  const Icon = MEDIA_ICONS[type] ?? FileText;

  if (type === 'IMAGE') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={broadcast.mediaUrl}
        alt={broadcast.mediaFilename ?? ''}
        className="max-h-72 w-full rounded-xl object-contain"
      />
    );
  }
  if (type === 'VIDEO') {
    return <video src={broadcast.mediaUrl} controls className="max-h-72 w-full rounded-xl bg-black" />;
  }
  if (type === 'AUDIO' || type === 'VOICE') {
    return (
      <div className="space-y-1.5">
        <audio src={broadcast.mediaUrl} controls className="w-full" />
        <p className="text-[11px] text-gray-500 dark:text-[#8696A0]">{t('form.voiceHint')}</p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center gap-3 p-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#25D366]/15 text-[#25D366]">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900 dark:text-white">
            {broadcast.mediaFilename ?? t('detail.attachment', { defaultValue: 'Attachment' })}
          </span>
          <span className="block truncate text-[11px] text-gray-500 dark:text-[#8696A0]">
            {broadcast.mediaMimeType ?? type}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-1 border-t border-gray-200 px-3 py-1.5 dark:border-white/10">
        <a
          href={broadcast.mediaUrl}
          download={broadcast.mediaFilename ?? true}
          className="flex flex-1 items-center justify-center gap-1.5 py-1 text-xs font-medium text-[#25D366] transition-colors hover:text-[#1FAA5C]"
        >
          <Download className="h-3.5 w-3.5" />
          {t('detail.downloadFile', { defaultValue: 'Download' })}
        </a>
        <div className="h-4 w-px bg-gray-200 dark:bg-white/10" />
        <a
          href={broadcast.mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-1 items-center justify-center gap-1.5 py-1 text-xs font-medium text-[#25D366] transition-colors hover:text-[#1FAA5C]"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('detail.openFile', { defaultValue: 'Open' })}
        </a>
      </div>
    </div>
  );
}

export default function BroadcastDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { t } = useTranslation('broadcasts');
  const { t: tErr } = useTranslation('errors');
  const { success, error: toastError } = useToast();
  const { isRTL } = useDirection();
  const BackIcon = isRTL ? ArrowRight : ArrowLeft;

  const explainToast = (err: unknown) => toastError(tErr(`friendly.${classifyError(err).code}.title`));

  const [broadcast, setBroadcast] = useState<BroadcastDetail | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  // ─── Row action state ─────────────────────────────────────────────────────
  const [sending, setSending] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  /** Non-null once the server has answered 428 for this campaign. */
  const [riskReason, setRiskReason] = useState<string | null>(null);

  // ─── Audience paging ──────────────────────────────────────────────────────
  const [recipients, setRecipients] = useState<RecipientPage | null>(null);
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'' | 'pending' | 'sent' | 'failed' | 'skipped'>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // ─── Load ─────────────────────────────────────────────────────────────────

  const fetchBroadcast = useCallback(async () => {
    if (!id) return;
    try {
      // `recipients=none` — the audience is paged separately, below.
      const data = await api.get<BroadcastDetail>(`/api/broadcasts/${id}?recipients=none`);
      setBroadcast(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchBroadcast(); }, [fetchBroadcast]);

  /**
   * Re-assess a campaign that hasn't finished sending.
   *
   * `broadcast.preflight` is the verdict frozen at the last save. A campaign
   * drafted on Monday for Friday carries Monday's account health, Monday's cold
   * ratio and Monday's suppression list — and would keep showing "LOW risk" on
   * Friday even if the number collected three 463s on Wednesday. Since the whole
   * point of the safety engine is that conditions change, showing a stale
   * verdict is worse than showing none.
   *
   * Only for campaigns that can still send: a SENT campaign's report is a
   * historical record and re-running it would rewrite history with today's data.
   */
  const [refreshingPreflight, setRefreshingPreflight] = useState(false);
  const [preflightAt, setPreflightAt] = useState<number | null>(null);
  const reassessable = broadcast
    ? ['DRAFT', 'SCHEDULED', 'FAILED', 'PAUSED'].includes(broadcast.status)
    : false;

  const refreshPreflight = useCallback(async () => {
    if (!id) return;
    setRefreshingPreflight(true);
    try {
      const data = await api.post<BroadcastDetail>(`/api/broadcasts/${id}/preflight`, {});
      setBroadcast((prev) => (prev ? { ...prev, ...data } : data));
      setPreflightAt(Date.now());
    } catch {
      /* keep the stored report — a failed re-assessment must not blank the card */
    } finally {
      setRefreshingPreflight(false);
    }
  }, [id]);

  // Re-assess once when the page opens on a still-sendable campaign.
  const reassessedRef = useRef(false);
  useEffect(() => {
    if (!reassessable || reassessedRef.current) return;
    reassessedRef.current = true;
    void refreshPreflight();
  }, [reassessable, refreshPreflight]);

  // Debounced so typing a phone number doesn't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchRecipients = useCallback(async () => {
    if (!id) return;
    setRecipientsLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (statusFilter) query.set('status', statusFilter);
      if (debouncedSearch.trim()) query.set('search', debouncedSearch.trim());
      setRecipients(await api.get<RecipientPage>(`/api/broadcasts/${id}/recipients?${query}`));
    } catch {
      setRecipients(null);
    } finally {
      setRecipientsLoading(false);
    }
  }, [id, page, pageSize, statusFilter, debouncedSearch]);

  useEffect(() => { fetchRecipients(); }, [fetchRecipients]);

  // ─── Live progress ────────────────────────────────────────────────────────

  const onProgress = useCallback(
    ({ broadcastId, sent, failed, nextBatchAt }: { broadcastId: string; sent: number; failed: number; nextBatchAt?: string }) => {
      if (broadcastId !== id) return;
      setBroadcast((prev) =>
        prev
          ? { ...prev, totalSent: sent, totalFailed: failed, status: 'SENDING', ...(nextBatchAt !== undefined ? { nextBatchAt } : {}) }
          : prev,
      );
    },
    [id],
  );

  const onComplete = useCallback(
    ({ broadcastId, sent, failed, status }: { broadcastId: string; sent: number; failed: number; status: string }) => {
      if (broadcastId !== id) return;
      setBroadcast((prev) => (prev ? { ...prev, totalSent: sent, totalFailed: failed, status } : prev));
      // Per-recipient rows just changed en masse — pull the page and tallies again.
      fetchRecipients();
    },
    [id, fetchRecipients],
  );

  useSocket('broadcast:progress', onProgress);
  useSocket('broadcast:complete', onComplete);

  // A one-minute clock, only while there is a countdown worth ticking.
  const [now, setNow] = useState(() => Date.now());
  const isScheduled = broadcast?.status === 'SCHEDULED';
  useEffect(() => {
    if (!isScheduled) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [isScheduled]);

  const countdown = useCountdownLabel(isScheduled ? (broadcast?.scheduledAt ?? null) : null, now);

  // ─── Actions ──────────────────────────────────────────────────────────────

  const act = async (run: () => Promise<unknown>, toast: string, flag: (v: boolean) => void) => {
    try {
      flag(true);
      await run();
      success(toast);
      await Promise.all([fetchBroadcast(), fetchRecipients()]);
    } catch (err) {
      explainToast(err);
    } finally {
      flag(false);
    }
  };

  /**
   * Send, honouring the server's 428 "this is critical, confirm it" answer.
   * The acknowledgement flag is only ever set after the user has seen the
   * dialog — sending it on the first attempt would make the gate decorative.
   */
  const sendBroadcast = async (acknowledged: boolean) => {
    try {
      setSending(true);
      await api.post(`/api/broadcasts/${id}/send`, acknowledged ? { acknowledged: true } : {});
      success('Broadcast started sending.');
      setRiskReason(null);
      await Promise.all([fetchBroadcast(), fetchRecipients()]);
    } catch (err) {
      if ((err as { status?: number })?.status === 428) {
        setRiskReason(err instanceof Error ? err.message : '');
        return;
      }
      explainToast(err);
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async () => {
    try {
      setBusy(true);
      await api.delete(`/api/broadcasts/${id}`);
      success('Broadcast deleted.');
      router.push('/broadcasts');
    } catch (err) {
      explainToast(err);
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  const handleDuplicate = async () => {
    try {
      setBusy(true);
      const copy = await api.post<{ id: string }>(`/api/broadcasts/${id}/duplicate`, {});
      success(t('toasts.duplicated'));
      router.push(`/broadcasts/${copy.id}`);
    } catch (err) {
      explainToast(err);
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    try {
      setBusy(true);
      await api.post(`/api/broadcasts/${id}/cancel`, {});
      success(t('toasts.cancelled', { defaultValue: 'Campaign stopped. No more messages will be sent.' }));
      setConfirmingCancel(false);
      await Promise.all([fetchBroadcast(), fetchRecipients()]);
    } catch (err) {
      explainToast(err);
    } finally {
      setBusy(false);
    }
  };

  /**
   * The failed numbers, as a file. A campaign that misses 300 recipients is
   * useless as a list on screen — this is the artifact you feed back into an
   * import or hand to whoever cleans the data.
   */
  const exportFailed = async () => {
    if (!id) return;
    try {
      setBusy(true);
      const all = await api.get<RecipientPage>(`/api/broadcasts/${id}/recipients?status=failed&pageSize=200&page=1`);
      const rows = [...all.rows];
      // `pageSize` is capped server-side, so walk the remaining pages.
      for (let p = 2; rows.length < all.total; p++) {
        const next = await api.get<RecipientPage>(`/api/broadcasts/${id}/recipients?status=failed&pageSize=200&page=${p}`);
        if (!next.rows.length) break;
        rows.push(...next.rows);
      }

      // The leading BOM is what makes Excel open a UTF-8 CSV without mangling it.
      const csv = ['phone,status', ...rows.map((r) => `${r.phone},${r.status}`)].join('\r\n');
      const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${broadcast?.name ?? 'broadcast'}-failed.csv`.replace(/[^\w.-]+/g, '_');
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      explainToast(err);
    } finally {
      setBusy(false);
    }
  };

  // ─── Derived ──────────────────────────────────────────────────────────────

  const stats = useMemo(() => (broadcast ? deliveryStats(broadcast) : null), [broadcast]);
  const counts = recipients?.counts;
  const totalRecipients = counts?.total ?? broadcast?.recipientCount ?? 0;

  const statusTabs: Array<{ key: '' | 'pending' | 'sent' | 'failed' | 'skipped'; label: string; count?: number }> = [
    { key: '',        label: t('detail.allRecipients', { defaultValue: 'All' }), count: counts?.total },
    { key: 'sent',    label: t('recipientStatus.sent', { defaultValue: 'Sent' }), count: counts?.sent },
    { key: 'failed',  label: t('recipientStatus.failed', { defaultValue: 'Failed' }), count: counts?.failed },
    { key: 'pending', label: t('recipientStatus.pending', { defaultValue: 'Pending' }), count: counts?.pending },
    // Only offered when there is something to see. An "Excluded (0)" tab on
    // every clean campaign is noise; on a campaign that filtered 200 opt-outs it
    // is the answer to the first question the user will ask.
    ...(counts?.skipped
      ? [{ key: 'skipped' as const, label: t('recipientStatus.skipped', { defaultValue: 'Excluded' }), count: counts.skipped }]
      : []),
  ];

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white py-24 dark:border-white/10 dark:bg-[#111B21]">
        <Loader2 className="h-6 w-6 animate-spin text-[#25D366]" />
      </div>
    );
  }

  if (loadError || !broadcast) {
    return (
      <div className="space-y-4">
        <Link href="/broadcasts" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:text-[#8696A0] dark:hover:text-white">
          <BackIcon className="h-4 w-4" /> {t('back')}
        </Link>
        <FriendlyError error={loadError ?? new Error('Broadcast not found')} onRetry={fetchBroadcast} />
      </div>
    );
  }

  const MediaIcon = broadcast.mediaType ? MEDIA_ICONS[broadcast.mediaType] : null;
  const tagFilter = broadcast.description?.startsWith('Tag: ') ? broadcast.description.slice(5) : null;

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <section className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-white/10 dark:bg-[#111B21]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(37,211,102,0.08),transparent_40%)]" />
        <div className="relative space-y-4">
          <Link
            href="/broadcasts"
            className="inline-flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-900 dark:text-[#8696A0] dark:hover:text-white"
          >
            <BackIcon className="h-4 w-4" /> {t('back')}
          </Link>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl dark:text-white">{broadcast.name}</h1>
                <StatusPill status={broadcast.status} size="md" />
                <RiskBadge level={broadcast.riskLevel} score={broadcast.riskScore} size="md" />
                {MediaIcon && broadcast.mediaType && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#25D366]/12 px-2 py-1 text-[11px] font-medium text-[#25D366]">
                    <MediaIcon className="h-3 w-3" />
                    {t(MEDIA_LABEL_KEYS[broadcast.mediaType] ?? '', { defaultValue: broadcast.mediaType })}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-sm text-gray-500 dark:text-[#8696A0]">
                {t('detail.createdOn', {
                  date: new Date(broadcast.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
                  defaultValue: 'Created {{date}}',
                })}
              </p>
            </div>

            <div className="shrink-0">
              <BroadcastActions
                broadcast={broadcast}
                align="start"
                busy={busy}
                sending={sending}
                pausing={pausing}
                confirming={confirmingDelete}
                confirmingCancel={confirmingCancel}
                onSend={() => void sendBroadcast(false)}
                onPause={() => act(() => api.post(`/api/broadcasts/${id}/pause`, {}), 'Broadcast paused.', setPausing)}
                onResume={() => act(() => api.post(`/api/broadcasts/${id}/resume`, {}), 'Broadcast resumed.', setPausing)}
                onEdit={() => router.push(`/broadcasts/${id}/edit`)}
                onDuplicate={handleDuplicate}
                onUnschedule={() => act(() => api.post(`/api/broadcasts/${id}/unschedule`, {}), t('toasts.unscheduled'), setBusy)}
                onAskDelete={() => setConfirmingDelete(true)}
                onConfirmDelete={handleDelete}
                onCancelDelete={() => setConfirmingDelete(false)}
                onAskCancel={() => setConfirmingCancel(true)}
                onConfirmCancel={handleCancel}
                onKeepRunning={() => setConfirmingCancel(false)}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── Live monitor ──
          Renders only while the campaign is SENDING or PAUSED, and carries the
          auto-pause explanation, so a machine-stopped run can never look like an
          unexplained one. */}
      <CampaignMonitor broadcastId={id} status={broadcast.status} onResumed={fetchBroadcast} />

      {/* ── Why it failed ── */}
      {broadcast.lastError && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-300/60 bg-red-50 p-4 dark:border-red-500/25 dark:bg-red-500/[0.07]">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500 dark:text-red-400" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-900 dark:text-red-200">
              {t('detail.lastError', { defaultValue: 'Last error' })}
            </p>
            <p className="mt-0.5 break-words text-[13px] text-red-800/90 dark:text-red-300/80">{broadcast.lastError}</p>
          </div>
        </div>
      )}

      {/* ── Delivery at a glance ── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label={t('table.audience', { defaultValue: 'Audience' })} value={totalRecipients} />
        <StatCard label={t('recipientStatus.sent', { defaultValue: 'Sent' })} value={broadcast.totalSent} tone="success" />
        <StatCard label={t('recipientStatus.failed', { defaultValue: 'Failed' })} value={broadcast.totalFailed} tone={broadcast.totalFailed > 0 ? 'error' : undefined} />
        <StatCard
          label={t('recipientStatus.pending', { defaultValue: 'Pending' })}
          value={counts?.pending ?? stats?.pending ?? 0}
          pulse={broadcast.status === 'SENDING'}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">

        {/* ── Left: message + audience ── */}
        <div className="space-y-5 lg:col-span-3">

          <Card title={t('form.messageSection')} icon={MessageSquare}>
            <div className="space-y-3 p-4 sm:p-5">
              <MediaPreview broadcast={broadcast} />
              {broadcast.message.trim() ? (
                <div className="rounded-xl rounded-ss-sm bg-[#DCF8C6] p-3 text-sm text-slate-900 dark:bg-[#005C4B] dark:text-white">
                  <p className="whitespace-pre-wrap break-words">{broadcast.message}</p>
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-[#8696A0]">
                  {t('detail.noMessageBody', { defaultValue: 'No text — the attachment is sent on its own.' })}
                </p>
              )}
              {/\{\{\s*\w+\s*\}\}/.test(broadcast.message) && (
                <p className="text-[11px] text-gray-500 dark:text-[#8696A0]">{t('form.variablesHint')}</p>
              )}
              {broadcast.interactiveContent?.kind ? (
                <p className="inline-flex items-center gap-1.5 rounded-lg bg-blue-400/10 px-2 py-1 text-[11px] font-medium text-blue-500 dark:text-blue-300">
                  <Send className="h-3 w-3" />
                  {t('detail.interactive', { defaultValue: 'Interactive message' })} · {String(broadcast.interactiveContent.kind)}
                </p>
              ) : null}
            </div>
          </Card>

          <Card
            title={t('table.recipients')}
            icon={Users}
            action={
              (counts?.failed ?? 0) > 0 ? (
                <button
                  type="button"
                  onClick={exportFailed}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-[#8696A0] dark:hover:bg-white/10"
                >
                  <Download className="h-3.5 w-3.5" />
                  {t('detail.exportFailed', { defaultValue: 'Export failed' })}
                </button>
              ) : undefined
            }
          >
            {/* filters */}
            <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 dark:border-white/10">
              <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
                {statusTabs.map((tab) => (
                  <button
                    key={tab.key || 'all'}
                    type="button"
                    onClick={() => { setStatusFilter(tab.key); setPage(1); }}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                      statusFilter === tab.key
                        ? 'bg-[#25D366]/15 text-[#25D366]'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-[#8696A0] dark:hover:bg-white/5 dark:hover:text-white',
                    )}
                  >
                    {tab.label}
                    {typeof tab.count === 'number' && (
                      <span className="tabular-nums opacity-70">{tab.count.toLocaleString()}</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="relative sm:w-52">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-[#8696A0]" />
                <input
                  type="text"
                  inputMode="tel"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('detail.searchPhone', { defaultValue: 'Search phone…' })}
                  className="h-9 w-full rounded-xl border border-gray-200 bg-gray-50 ps-9 pe-8 text-sm text-gray-900 outline-none transition-colors focus:border-[#25D366]/50 dark:border-white/10 dark:bg-[#202C33] dark:text-white dark:placeholder:text-[#8696A0]"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label={t('clearFilters')}
                    className="absolute end-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* rows — a two-column list, not a table: there is nothing to sort */}
            {recipientsLoading ? (
              <div className="divide-y divide-gray-100 dark:divide-white/5">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex animate-pulse items-center justify-between px-4 py-3 sm:px-5">
                    <div className="h-4 w-32 rounded bg-gray-100 dark:bg-white/8" />
                    <div className="h-4 w-16 rounded bg-gray-50 dark:bg-white/5" />
                  </div>
                ))}
              </div>
            ) : !recipients?.rows.length ? (
              <div className="px-4 py-12 text-center">
                <Users className="mx-auto mb-3 h-8 w-8 text-gray-400 dark:text-[#8696A0]/30" />
                <p className="text-sm text-gray-500 dark:text-[#8696A0]">
                  {t('detail.noRecipientsMatch', { defaultValue: 'No recipients match this filter.' })}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-white/5">
                {recipients.rows.map((recipient) => {
                  const Icon = RECIPIENT_STATUS_ICONS[recipient.status] ?? CircleDashed;
                  return (
                    <li key={recipient.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-sm text-gray-900 dark:text-white" dir="ltr">
                          {recipient.phone}
                        </span>
                        {/* Why this one did not go out, in plain words. A phone
                            number next to "Excluded" with no reason is the kind
                            of gap that gets a safety feature reported as a bug. */}
                        {(recipient.skipReason || recipient.errorCode) && (
                          <span className="mt-0.5 block truncate text-[11px] text-gray-500 dark:text-[#8696A0]">
                            {recipient.skipReason
                              ? t(`skipReason.${recipient.skipReason}`, { defaultValue: SKIP_REASON_FALLBACK[recipient.skipReason] ?? recipient.skipReason })
                              : t(`errorCode.${recipient.errorCode}`, { defaultValue: ERROR_CODE_FALLBACK[recipient.errorCode!] ?? recipient.errorCode! })}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {recipient.repliedAt && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#25D366]/12 px-2 py-0.5 text-[10px] font-medium text-[#25D366]">
                            <MessageSquare className="h-2.5 w-2.5" />
                            {t('detail.replied', { defaultValue: 'Replied' })}
                          </span>
                        )}
                        <span className={cn(
                          'inline-flex items-center gap-1.5 text-xs font-medium',
                          RECIPIENT_STATUS_STYLES[recipient.status] ?? RECIPIENT_STATUS_STYLES.pending,
                        )}>
                          <Icon className="h-3.5 w-3.5" />
                          {t(`recipientStatus.${recipient.status}`, { defaultValue: recipient.status })}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <TablePagination
              page={page}
              pageSize={pageSize}
              total={recipients?.total ?? 0}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            />
          </Card>
        </div>

        {/* ── Right: safety + schedule + delivery + audience source ── */}
        <div className="space-y-5 lg:col-span-2">

          {/* Read-only here: the fixes belong in the composer, where the fields
              they change actually live. But the verdict itself is re-run against
              today's account whenever the campaign can still send — see
              `refreshPreflight` above for why a frozen one is misleading. */}
          {broadcast.preflight && (
            <Card
              title={
                reassessable
                  ? t('safety.sectionLive', { defaultValue: 'Safety check · re-assessed now' })
                  : t('safety.sectionAtSend', { defaultValue: 'Safety check · as sent' })
              }
              icon={ShieldCheck}
            >
              <div className="p-4 sm:p-5">
                {reassessable && (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-gray-500 dark:text-[#8696A0]">
                      {refreshingPreflight
                        ? t('safety.reassessing', { defaultValue: 'Checking against your account right now…' })
                        : preflightAt
                          ? t('safety.assessedAt', {
                              defaultValue: 'Checked {{time}}',
                              time: new Date(preflightAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            })
                          : t('safety.assessedAtSave', { defaultValue: 'From the last save' })}
                    </p>
                    <button
                      type="button"
                      onClick={() => void refreshPreflight()}
                      disabled={refreshingPreflight}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-100 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:bg-white/10"
                    >
                      <RefreshCw className={cn('h-3 w-3', refreshingPreflight && 'animate-spin')} />
                      {t('safety.recheck', { defaultValue: 'Re-check' })}
                    </button>
                  </div>
                )}
                <SafetyReport report={broadcast.preflight} compact />
              </div>
            </Card>
          )}

          <Card title={t('form.deliverySection')} icon={CalendarClock}>
            <div className="space-y-4 p-4 sm:p-5">
              {broadcast.scheduledAtLocal ? (
                <>
                  <Fact
                    label={t('form.scheduleTime')}
                    value={
                      <span className="inline-flex items-center gap-1.5 text-blue-500 dark:text-blue-300">
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        {formatSchedule(broadcast.scheduledAtLocal, broadcast.timezone)}
                      </span>
                    }
                    hint={countdown?.label}
                  />
                  <Fact
                    label={t('form.timezone')}
                    value={broadcast.timezone}
                    hint={timeZoneLabel(broadcast.timezone)}
                  />
                </>
              ) : (
                <Fact
                  label={t('form.scheduleTime')}
                  value={t('form.sendNowOption')}
                  hint={t('form.sendNowDesc')}
                />
              )}

              {broadcast.sentAt && (
                <Fact
                  label={t('table.sentAt')}
                  value={new Date(broadcast.sentAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                />
              )}
            </div>
          </Card>

          <Card title={t('table.delivery', { defaultValue: 'Delivery' })} icon={Megaphone}>
            <div className="space-y-3 p-4 sm:p-5">
              {/* Smart Sending: batch counter + next-batch countdown while active. */}
              {broadcast.smartSending && (broadcast.status === 'SENDING' || broadcast.status === 'PAUSED') && (
                <SmartBatchProgress broadcast={broadcast} now={now} />
              )}
              {!stats?.total ? (
                <p className="text-sm text-gray-500 dark:text-[#8696A0]">
                  {t('detail.nothingToDeliver', { defaultValue: 'No recipients yet.' })}
                </p>
              ) : (
                <>
                  <div
                    className="flex h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-white/10"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={stats.total}
                    aria-valuenow={stats.attempted}
                  >
                    <div className="h-full bg-[#25D366] transition-all" style={{ width: `${stats.sentPct}%` }} />
                    <div className="h-full bg-red-400 transition-all" style={{ width: `${stats.failedPct}%` }} />
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 text-xs tabular-nums text-gray-500 dark:text-[#8696A0]">
                    <span>
                      <span className="font-semibold text-gray-900 dark:text-white">{stats.attempted.toLocaleString()}</span>
                      {' / '}{stats.total.toLocaleString()}
                    </span>
                    {stats.successRate !== null && (
                      <span>{t('stats.deliveryRate')}: <span className="font-semibold text-[#25D366]">{stats.successRate}%</span></span>
                    )}
                  </div>
                </>
              )}

              {tagFilter && (
                <div className="border-t border-gray-200 pt-3 dark:border-white/10">
                  <Fact label={t('form.tagFilterLabel')} value={tagFilter} />
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <ConfirmRiskDialog
        open={riskReason !== null}
        reason={riskReason || null}
        busy={sending}
        onConfirm={() => void sendBroadcast(true)}
        onCancel={() => setRiskReason(null)}
      />

      {/* Mobile bottom-nav spacer */}
      <div aria-hidden="true" className="h-[var(--bottom-nav-space)] sm:hidden" />
    </div>
  );
}

function StatCard({ label, value, tone, pulse }: {
  label: string;
  value: number;
  tone?: 'success' | 'error';
  pulse?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 sm:p-4 dark:border-white/10 dark:bg-[#111B21]">
      <p className="truncate text-[10px] uppercase tracking-[0.18em] text-gray-500 sm:text-xs dark:text-[#8696A0]">{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <p className={cn(
          'text-2xl font-semibold tabular-nums sm:text-3xl',
          tone === 'success' ? 'text-[#25D366]' : tone === 'error' ? 'text-red-400' : 'text-gray-900 dark:text-white',
        )}>
          {value.toLocaleString()}
        </p>
        {pulse && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
          </span>
        )}
      </div>
    </div>
  );
}
