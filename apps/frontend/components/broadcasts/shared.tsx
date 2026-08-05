'use client';

/**
 * Pieces shared by the broadcast list and the broadcast detail view.
 *
 * Both surfaces show the same status, the same delivery arithmetic, and offer
 * the same actions — they differ only in density. Keeping one copy means a new
 * status or a new action lands in both places at once, and the two can never
 * disagree about what "83% delivered" means.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pause, Play, Send, Trash2, Copy, Pencil, CalendarX, Loader2, Eye, CircleStop,
  Image as ImageIcon, Video, FileText, Mic, Layers, Timer, Check, ShieldAlert,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { batchProgress } from '../../lib/smart-sending';
import { RISK_STYLES, riskLabel, type PreflightReport, type RiskLevel } from '../../lib/preflight';

// ─── Types ───────────────────────────────────────────────────────────────────

/** What the list needs. Every field here is returned by `GET /api/broadcasts`. */
export interface BroadcastSummary {
  id: string;
  name: string;
  status: string;
  totalSent: number;
  totalFailed: number;
  createdAt: string;
  /** Size of the audience, so progress has a denominator. */
  recipientCount: number;
  /** Exactly the wall clock the user picked — displayed, never reinterpreted. */
  scheduledAtLocal: string | null;
  /** The absolute instant. Read *only* to compute a zone-free countdown. */
  scheduledAt: string | null;
  timezone: string;
  mediaType?: string | null;
  lastError?: string | null;
  /** Smart Sending: the audience is delivered in batches with a wait between. */
  smartSending?: boolean;
  batchSize?: number | null;
  batchIntervalMinutes?: number | null;
  /** When the next batch is due (ISO). Drives the "Next batch in…" countdown. */
  nextBatchAt?: string | null;
  // ── Deliverability ─────────────────────────────────────────────────────────
  /** 0–100 pre-flight risk. Higher is riskier. Null on campaigns saved before it existed. */
  riskScore?: number | null;
  riskLevel?: RiskLevel | null;
  pacingProfile?: string | null;
  /** Set when the circuit breaker paused the run rather than a person. */
  healthPausedAt?: string | null;
  healthPauseReason?: string | null;
  pilotSize?: number | null;
  pilotCompletedAt?: string | null;
}

/** What the detail view needs, on top of the summary. */
export interface BroadcastDetail extends BroadcastSummary {
  message: string;
  description: string | null;
  type: string;
  mediaUrl?: string | null;
  mediaFilename?: string | null;
  mediaMimeType?: string | null;
  interactiveContent?: Record<string, unknown> | null;
  sentAt: string | null;
  queuedAt: string | null;
  updatedAt: string;
  /** The stored safety report from the last save. */
  preflight?: PreflightReport | null;
  quietHoursEnabled?: boolean;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  reviewedAt?: string | null;
}

/**
 * `skipped` is a fourth outcome, distinct from `failed` on purpose: a recipient
 * who opted out was not a delivery that went wrong, and counting them together
 * would make a well-behaved campaign look broken.
 */
export type RecipientStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface BroadcastRecipient {
  id: string;
  phone: string;
  status: string;
  tier?: string | null;
  skipReason?: string | null;
  errorCode?: string | null;
  lastError?: string | null;
  sentAt?: string | null;
  repliedAt?: string | null;
}

// ─── Status vocabulary ───────────────────────────────────────────────────────

export const MEDIA_ICONS: Record<string, typeof ImageIcon> = {
  IMAGE: ImageIcon,
  VIDEO: Video,
  DOCUMENT: FileText,
  AUDIO: Mic,
  VOICE: Mic,
};

export const STATUS_STYLES: Record<string, string> = {
  DRAFT:     'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-[#8696A0]',
  SCHEDULED: 'bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300',
  SENDING:   'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  PAUSED:    'bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300',
  SENT:      'bg-green-100 text-green-700 dark:bg-[#25D366]/15 dark:text-[#25D366]',
  FAILED:    'bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-300',
  CANCELLED: 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-[#8696A0]/80',
};

export const STATUS_DOTS: Record<string, string> = {
  DRAFT:     'bg-gray-400',
  SCHEDULED: 'bg-blue-400',
  SENDING:   'bg-amber-400 animate-pulse',
  PAUSED:    'bg-orange-400',
  SENT:      'bg-[#25D366]',
  FAILED:    'bg-red-400',
  CANCELLED: 'bg-gray-400',
};

export const ALL_STATUSES = ['DRAFT', 'SCHEDULED', 'SENDING', 'PAUSED', 'SENT', 'FAILED', 'CANCELLED'];

/** Statuses whose content may still be edited — mirrors the server's rule. */
export const EDITABLE_STATUSES = ['DRAFT', 'SCHEDULED', 'FAILED'];

export function StatusPill({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) {
  const { t } = useTranslation('broadcasts');
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium',
        size === 'md' ? 'px-3 py-1 text-sm' : 'px-2.5 py-1 text-xs',
        STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOTS[status] ?? 'bg-gray-400')} />
      {t(`status.${status}`, { defaultValue: status })}
    </span>
  );
}

/**
 * Risk at a glance, for list rows.
 *
 * Renders nothing for LOW risk and for campaigns saved before the safety engine
 * existed. A badge on every row would be wallpaper; a badge on the two rows that
 * deserve attention is a signal.
 */
export function RiskBadge({ level, score, size = 'sm' }: { level?: RiskLevel | null; score?: number | null; size?: 'sm' | 'md' }) {
  const { t } = useTranslation('broadcasts');
  if (!level || level === 'LOW') return null;

  const style = RISK_STYLES[level];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border font-medium',
        size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[10px]',
        style.ring,
        style.bg,
        style.text,
      )}
      title={typeof score === 'number' ? `Risk score ${score}/100` : undefined}
    >
      <ShieldAlert className={size === 'md' ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5'} />
      {t(`risk.${level}`, { defaultValue: riskLabel(level) })}
    </span>
  );
}

// ─── Delivery arithmetic ─────────────────────────────────────────────────────

/** Fraction of the audience that has been attempted, and how much of it landed. */
export function deliveryStats(broadcast: BroadcastSummary) {
  const total = broadcast.recipientCount || 0;
  const attempted = broadcast.totalSent + broadcast.totalFailed;
  return {
    total,
    attempted,
    pending: Math.max(0, total - attempted),
    sentPct: total ? (broadcast.totalSent / total) * 100 : 0,
    failedPct: total ? (broadcast.totalFailed / total) * 100 : 0,
    attemptedPct: total ? (attempted / total) * 100 : 0,
    // Success out of what was actually tried — not out of the whole audience,
    // which would read as a failure mid-send.
    successRate: attempted ? Math.round((broadcast.totalSent / attempted) * 100) : null,
  };
}

// ─── Countdown ───────────────────────────────────────────────────────────────

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  overdue: boolean;
  /** Less than a minute away — no number is worth printing. */
  imminent: boolean;
}

/**
 * How far away the fire time is, as raw numbers.
 *
 * This is the one place the *instant* (`scheduledAt`) is read rather than the
 * wall clock. A duration is zone-free — "in 2 hours" means the same thing
 * everywhere — so no offset can leak in. The absolute time is still rendered
 * from `scheduledAtLocal`, never from this.
 *
 * Numbers, not a formatted string: the caller supplies the units and the phrase
 * from the active locale, so Arabic never ends up reading "خلال 2h 15m".
 */
export function countdownParts(scheduledAt: string | null, now: number): Countdown | null {
  if (!scheduledAt) return null;
  const target = new Date(scheduledAt).getTime();
  if (Number.isNaN(target)) return null;

  const deltaMs = target - now;
  const overdue = deltaMs < 0;
  const totalMinutes = Math.round(Math.abs(deltaMs) / 60_000);

  if (totalMinutes < 1) return { days: 0, hours: 0, minutes: 0, overdue, imminent: true };
  if (totalMinutes < 60) return { days: 0, hours: 0, minutes: totalMinutes, overdue, imminent: false };

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    return { days: 0, hours: totalHours, minutes: totalMinutes % 60, overdue, imminent: false };
  }

  return { days: Math.round(totalHours / 24), hours: 0, minutes: 0, overdue, imminent: false };
}

/**
 * "in 2h 15m" / "خلال 2س 15د". Returns null when there is nothing to count down to.
 * A hook rather than a function because the phrasing and the unit suffixes both
 * come from the active locale.
 */
export function useCountdownLabel(scheduledAt: string | null, now: number): { label: string; overdue: boolean } | null {
  const { t } = useTranslation('broadcasts');
  const countdown = countdownParts(scheduledAt, now);
  if (!countdown) return null;

  const unit = (value: number, key: 'd' | 'h' | 'm') =>
    `${value}${t(`countdown.units.${key}`, { defaultValue: key })}`;

  const span = countdown.days
    ? unit(countdown.days, 'd')
    : countdown.hours
      ? (countdown.minutes ? `${unit(countdown.hours, 'h')} ${unit(countdown.minutes, 'm')}` : unit(countdown.hours, 'h'))
      : unit(countdown.minutes, 'm');

  if (countdown.imminent) {
    return {
      overdue: countdown.overdue,
      label: countdown.overdue
        ? t('countdown.dueNow', { defaultValue: 'Due now' })
        : t('countdown.underAMinute', { defaultValue: 'In under a minute' }),
    };
  }

  return {
    overdue: countdown.overdue,
    label: countdown.overdue
      ? t('countdown.overdue', { span, defaultValue: 'Overdue by {{span}}' })
      : t('countdown.in', { span, defaultValue: 'in {{span}}' }),
  };
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

/**
 * A square icon button. `title` and `aria-label` carry the same translated text,
 * so the action reads the same to a pointer, a screen reader, and a keyboard.
 */
export function IconButton({
  icon: Icon, label, onClick, disabled, danger,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        danger
          ? 'border-red-400/20 bg-red-400/8 text-red-500 hover:bg-red-400/15 dark:text-red-400'
          : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-[#8696A0] dark:hover:bg-white/10 dark:hover:text-white',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

export interface BroadcastActionHandlers {
  onView?: () => void;
  onSend: () => void;
  onPause: () => void;
  onResume: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onUnschedule: () => void;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  /** Stop a running/paused campaign. Only rendered when all three are provided. */
  onAskCancel?: () => void;
  onConfirmCancel?: () => void;
  onKeepRunning?: () => void;
}

/**
 * The actions a broadcast offers, laid out flat.
 *
 * They used to live in a dropdown, which could never work in a table row: the
 * card is `overflow-hidden` and the scroller is `overflow-x-auto`, so an
 * absolutely positioned panel was clipped on both axes and the last row's menu
 * opened straight through the bottom border. A broadcast only ever offers a
 * handful of actions, so they simply sit in place — nothing to open, nothing to
 * clip, nothing to mis-place, and every control is reachable by touch.
 *
 * Alignment uses `justify-end` / `justify-start`, which follow the writing
 * direction, so the bar mirrors itself in Arabic with no second rule.
 */
export function BroadcastActions({
  broadcast, busy, sending, pausing, confirming, confirmingCancel = false, align = 'end', compact = false,
  onView, onSend, onPause, onResume, onEdit, onDuplicate, onUnschedule,
  onAskDelete, onConfirmDelete, onCancelDelete,
  onAskCancel, onConfirmCancel, onKeepRunning,
}: BroadcastActionHandlers & {
  broadcast: BroadcastSummary;
  busy: boolean;
  sending: boolean;
  pausing: boolean;
  confirming: boolean;
  /** Inline "stop this campaign?" confirmation is showing. */
  confirmingCancel?: boolean;
  align?: 'start' | 'end';
  /** Collapse the primary button to an icon on narrow viewports (the wide table). */
  compact?: boolean;
}) {
  const { t } = useTranslation('broadcasts');
  const justify = align === 'end' ? 'justify-end' : 'justify-start';
  // The table's actions column is narrow until the widest breakpoint; a card or a
  // page header always has room for the word. `title`/`aria-label` carry the
  // meaning either way.
  const labelCls = compact ? 'hidden xl:inline' : 'inline';

  // Stopping a live campaign is weightier than deleting a draft, so it gets its
  // own confirmation copy rather than sharing the delete prompt.
  if (confirmingCancel) {
    return (
      <div className={cn('flex flex-wrap items-center gap-2', justify)}>
        <span className="text-xs text-orange-600 dark:text-orange-300">{t('cancelConfirm.title')}</span>
        <button
          type="button"
          onClick={onConfirmCancel}
          className="rounded-lg bg-orange-500 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-orange-600"
        >
          {t('cancelConfirm.confirm')}
        </button>
        <button
          type="button"
          onClick={onKeepRunning}
          className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
        >
          {t('cancelConfirm.cancel')}
        </button>
      </div>
    );
  }

  // Deleting a campaign that is mid-flight also stops it. Say so — "Delete
  // Broadcast" alone reads as if the send would carry on without its record.
  const live = broadcast.status === 'SENDING' || broadcast.status === 'PAUSED';

  if (confirming) {
    return (
      <div className={cn('flex flex-wrap items-center gap-2', justify)}>
        <span className="text-xs text-red-500 dark:text-red-300">
          {live
            ? t('deleteConfirm.liveTitle', { defaultValue: 'Stop sending and delete?' })
            : t('deleteConfirm.title')}
        </span>
        <button
          type="button"
          onClick={onConfirmDelete}
          className="rounded-lg bg-red-500 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-red-600"
        >
          {live ? t('deleteConfirm.liveConfirm', { defaultValue: 'Stop & delete' }) : t('common:yes')}
        </button>
        <button
          type="button"
          onClick={onCancelDelete}
          className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
        >
          {t('common:no')}
        </button>
      </div>
    );
  }

  const editable = EDITABLE_STATUSES.includes(broadcast.status);
  const cancellable = live && Boolean(onAskCancel);

  // The one thing this broadcast is asking for right now, spelled out in words.
  let primary: ReactNode = null;
  if (broadcast.status === 'SENDING') {
    primary = (
      <button
        type="button"
        onClick={onPause}
        disabled={pausing}
        title={t('actions.pause', { defaultValue: 'Pause' })}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-orange-500 px-2.5 text-xs font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
      >
        <Pause className="h-3.5 w-3.5 shrink-0" />
        <span className={labelCls}>{t('actions.pause', { defaultValue: 'Pause' })}</span>
      </button>
    );
  } else if (broadcast.status === 'PAUSED') {
    primary = (
      <button
        type="button"
        onClick={onResume}
        disabled={pausing}
        title={t('actions.resume', { defaultValue: 'Resume' })}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-blue-500 px-2.5 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
      >
        <Play className="h-3.5 w-3.5 shrink-0" />
        <span className={labelCls}>{t('actions.resume', { defaultValue: 'Resume' })}</span>
      </button>
    );
  } else if (editable) {
    const label = broadcast.status === 'SCHEDULED'
      ? t('actions.sendNow', { defaultValue: 'Send now' })
      : t('common:actions.send');
    primary = (
      <button
        type="button"
        onClick={onSend}
        disabled={sending}
        title={label}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[#25D366] px-2.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-[#25D366]/90 disabled:opacity-50"
      >
        {sending ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Send className="h-3.5 w-3.5 shrink-0" />}
        <span className={labelCls}>{label}</span>
      </button>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', justify)}>
      {primary}
      {onView && (
        <IconButton icon={Eye} label={t('actions.view', { defaultValue: 'View' })} onClick={onView} />
      )}
      {editable && (
        <IconButton icon={Pencil} label={t('common:actions.edit')} onClick={onEdit} disabled={busy} />
      )}
      <IconButton
        icon={Copy}
        label={t('actions.duplicate', { defaultValue: 'Duplicate' })}
        onClick={onDuplicate}
        disabled={busy}
      />
      {broadcast.status === 'SCHEDULED' && (
        <IconButton
          icon={CalendarX}
          label={t('actions.unschedule', { defaultValue: 'Unschedule' })}
          onClick={onUnschedule}
          disabled={busy}
        />
      )}
      {cancellable && (
        <IconButton
          icon={CircleStop}
          label={t('actions.cancel', { defaultValue: 'Cancel campaign' })}
          onClick={onAskCancel!}
          disabled={busy}
          danger
        />
      )}
      {/* Always offered. On a live campaign it stops the send as well — Cancel
          keeps the record and its per-recipient outcomes, Delete does not. */}
      <IconButton
        icon={Trash2}
        label={live
          ? t('actions.stopAndDelete', { defaultValue: 'Stop sending and delete' })
          : t('common:actions.delete')}
        onClick={onAskDelete}
        disabled={busy}
        danger
      />
    </div>
  );
}

// ─── Smart-sending progress ──────────────────────────────────────────────────

/**
 * The live state of a batched campaign: which batch it is on, how many there are,
 * and — when it is between batches — the countdown to the next one.
 *
 * Only meaningful for a smart send that is SENDING or PAUSED; the caller decides
 * whether to render it. `nextBatchAt` is read as an instant for a zone-free
 * countdown, the same rule the schedule countdown follows.
 */
export function SmartBatchProgress({ broadcast, now }: { broadcast: BroadcastSummary; now: number }) {
  const { t } = useTranslation('broadcasts');
  const nextBatch = useCountdownLabel(
    broadcast.status === 'SENDING' ? (broadcast.nextBatchAt ?? null) : null,
    now,
  );

  if (!broadcast.smartSending || !broadcast.batchSize) return null;

  const attempted = broadcast.totalSent + broadcast.totalFailed;
  const { numBatches, current } = batchProgress(attempted, broadcast.recipientCount, broadcast.batchSize);
  // "Waiting" only if the next batch is genuinely in the future. A `nextBatchAt`
  // that has already passed means the batch is due or being sent right now — the
  // claim clears it server-side, but a stale value can linger between socket
  // frames, and it must not read as "overdue".
  const nextBatchMs = broadcast.nextBatchAt ? new Date(broadcast.nextBatchAt).getTime() : NaN;
  const waiting = broadcast.status === 'SENDING' && Number.isFinite(nextBatchMs) && nextBatchMs > now;

  return (
    <div className="rounded-xl border border-blue-400/20 bg-blue-400/[0.06] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-300">
          <Layers className="h-3.5 w-3.5" />
          {t('smart.currentBatch', { current, total: numBatches, defaultValue: 'Batch {{current}} of {{total}}' })}
        </span>
        {broadcast.status === 'PAUSED' ? (
          <span className="text-[11px] font-medium text-orange-500 dark:text-orange-300">{t('status.PAUSED')}</span>
        ) : waiting && nextBatch ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-300">
            <Timer className="h-3 w-3" />
            {t('smart.nextBatch', { when: nextBatch.label, defaultValue: 'Next batch {{when}}' })}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-500 dark:text-amber-300">
            <Send className="h-3 w-3" />
            {t('smart.sendingBatch', { defaultValue: 'Sending…' })}
          </span>
        )}
      </div>

      {/* Batch pips — a compact, legible read on progress for a handful of batches;
          collapses to a slim bar once there are too many to show individually.
          A batch counts as done once the cursor has moved past it. */}
      {numBatches > 0 && numBatches <= 24 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {Array.from({ length: numBatches }, (_, i) => {
            const n = i + 1;
            const isDone = n < current;
            const isCurrent = n === current && broadcast.status === 'SENDING' && !waiting;
            return (
              <span
                key={n}
                title={`${t('smart.batch', { defaultValue: 'Batch' })} ${n}`}
                className={cn(
                  'flex h-5 min-w-[1.25rem] items-center justify-center rounded text-[10px] font-semibold tabular-nums',
                  isDone
                    ? 'bg-[#25D366]/20 text-[#25D366]'
                    : isCurrent
                      ? 'bg-amber-400/20 text-amber-500 dark:text-amber-300'
                      : 'bg-gray-200 text-gray-400 dark:bg-white/8 dark:text-[#8696A0]/70',
                )}
              >
                {isDone ? <Check className="h-3 w-3" /> : n}
              </span>
            );
          })}
        </div>
      ) : (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
          <div
            className="h-full rounded-full bg-[#25D366] transition-all"
            style={{ width: `${numBatches ? Math.max(0, current - 1) / numBatches * 100 : 0}%` }}
          />
        </div>
      )}
    </div>
  );
}
