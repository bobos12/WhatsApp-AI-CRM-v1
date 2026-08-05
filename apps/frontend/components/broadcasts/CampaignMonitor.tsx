'use client';

/**
 * ─── Live campaign monitor ───────────────────────────────────────────────────
 *
 * What a running campaign is doing right now: real throughput, a projection from
 * that throughput rather than from the configured ceiling, and — the part that
 * matters most — an unmissable explanation when the system stopped the run by
 * itself.
 *
 * An automatic pause is the moment the whole safety design either pays off or
 * gets angrily overridden. If the user sees "Paused" with no reason, they press
 * Resume, the same refusals happen again, and the account takes the damage
 * anyway. So the reason is the loudest thing on the page, and Resume asks for an
 * explicit acknowledgement.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity, AlertOctagon, Clock, FlaskConical, Gauge, Loader2, Play, ShieldAlert,
} from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { PACING_LABELS, type PacingProfile } from '../../lib/preflight';

export interface LiveStatus {
  id: string;
  status: string;
  totalSent: number;
  totalFailed: number;
  nextBatchAt: string | null;
  sentAt: string | null;
  healthPausedAt: string | null;
  healthPauseReason: string | null;
  pilotSize: number | null;
  pilotCompletedAt: string | null;
  pacingProfile: string;
  throttlePerHour: number | null;
  riskLevel: string | null;
  riskScore: number | null;
  lastError: string | null;
  counts: { pending: number; sent: number; failed: number; skipped: number; total: number };
  throughput: { lastHour: number; etaMinutes: number | null };
  autoPaused: boolean;
  /**
   * The safety picture as it stands NOW. `riskLevel`/`riskScore` above are the
   * prediction frozen when the campaign was saved; these change underneath it.
   */
  safety: {
    health: {
      score: number;
      grade: string;
      confidence: 'none' | 'low' | 'good';
      blocked: boolean;
      blockedReason: string | null;
      budget: { dailyLimit: number; usedToday: number; remainingToday: number; hourlyLimit: number };
      failureRate: number;
      hardBlocks: number;
      coldReachoutBlocks: number;
    } | null;
    gate: { ok: boolean; code: string | null; reason: string | null } | null;
    observed: {
      attempted: number;
      failureRate: number;
      errorsByCode: Record<string, number>;
      hardBlocks: number;
      coldReachoutBlocks: number;
    };
  };
}

/** Health score → colour. Mirrors the grades the backend assigns. */
function scoreTone(score: number): { text: string; ring: string; bg: string } {
  if (score >= 75) return { text: 'text-[#16A34A] dark:text-[#25D366]', ring: 'border-[#25D366]/30', bg: 'bg-[#25D366]/[0.07]' };
  if (score >= 50) return { text: 'text-amber-600 dark:text-amber-400', ring: 'border-amber-400/30', bg: 'bg-amber-400/[0.07]' };
  return { text: 'text-red-600 dark:text-red-400', ring: 'border-red-400/30', bg: 'bg-red-400/[0.07]' };
}

/** "in 2 hours" / "in 14 minutes" — relative, so it needs no timezone context. */
function formatEta(minutes: number | null): string | null {
  if (minutes == null) return null;
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function Metric({ label, value, sub, icon: Icon, pulse }: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Activity;
  pulse?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3.5 py-3 dark:border-white/10 dark:bg-[#0B141A]">
      <div className="flex items-center gap-1.5">
        <Icon className={cn('h-3 w-3 text-[#25D366]', pulse && 'animate-pulse')} />
        <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-[#8696A0]">{label}</p>
      </div>
      <p className="mt-1 text-lg font-bold tabular-nums text-gray-900 dark:text-white">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-gray-500 dark:text-[#8696A0]">{sub}</p>}
    </div>
  );
}

export default function CampaignMonitor({
  broadcastId,
  status,
  onResumed,
}: {
  broadcastId: string;
  status: string;
  onResumed?: () => void;
}) {
  const { t } = useTranslation('broadcasts');
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const active = status === 'SENDING' || status === 'PAUSED';
  const finished = status === 'SENT' || status === 'CANCELLED';

  const load = useCallback(async () => {
    try {
      setLive(await api.get<LiveStatus>(`/api/broadcasts/${broadcastId}/live`));
    } catch {
      /* transient — the next poll retries */
    }
  }, [broadcastId]);

  useEffect(() => {
    void load();
    // Fifteen seconds while sending. The socket already pushes per-message
    // progress; this poll exists for the derived numbers (throughput, ETA) the
    // socket does not carry, and for the case where a tab was left open through
    // a reconnect.
    //
    // It runs for every status now, not only SENDING/PAUSED. Account health and
    // the send gate move on their own — a campaign sitting in DRAFT can become
    // unsendable overnight because the number picked up blocks, and the frozen
    // riskScore on the row will happily keep saying LOW. A minute is plenty for
    // a campaign that is not currently moving.
    const timer = setInterval(() => void load(), active ? 15_000 : 60_000);
    return () => clearInterval(timer);
  }, [active, load]);

  if (!live) return null;

  // `healthPausedAt` can survive on a finished row, so both of these are gated
  // on the campaign actually being stoppable right now.
  const autoPaused = active && live.autoPaused && !live.pilotCompletedAt;
  const pilotHold = Boolean(live.pilotCompletedAt) && live.counts.pending > 0 && status === 'PAUSED';
  const eta = formatEta(live.throughput.etaMinutes);
  const profile = (PACING_LABELS[live.pacingProfile as PacingProfile] ?? PACING_LABELS.BALANCED);

  const resume = async (acknowledged: boolean) => {
    setResuming(true);
    setResumeError(null);
    try {
      await api.post(`/api/broadcasts/${broadcastId}/resume`, { acknowledged });
      await load();
      onResumed?.();
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : 'Could not resume this campaign.');
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* ── Automatic pause ─────────────────────────────────────────────────── */}
      {autoPaused && (
        <div className="rounded-2xl border border-red-300/60 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/[0.08]">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400">
              <AlertOctagon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-red-900 dark:text-red-200">
                {t('monitor.autoPaused', { defaultValue: 'Stopped automatically to protect your WhatsApp number' })}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-red-800/90 dark:text-red-300/85">
                {live.healthPauseReason}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void resume(true)}
                  disabled={resuming}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/40 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-500/10"
                >
                  {resuming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  {t('monitor.resumeAnyway', { defaultValue: 'Resume anyway' })}
                </button>
                <span className="text-[11px] text-red-700/70 dark:text-red-300/60">
                  {t('monitor.resumeWarning', {
                    defaultValue: 'Only if you have fixed what caused it — the same refusals will otherwise repeat.',
                  })}
                </span>
              </div>

              {resumeError && (
                <p className="mt-2 text-[11px] text-red-700 dark:text-red-300">{resumeError}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Pilot hold ──────────────────────────────────────────────────────── */}
      {pilotHold && (
        <div className="rounded-2xl border border-[#25D366]/30 bg-[#25D366]/[0.07] p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#25D366]/15 text-[#25D366]">
              <FlaskConical className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {t('monitor.pilotDone', { defaultValue: 'Pilot batch delivered' })}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-gray-600 dark:text-[#8696A0]">
                {live.healthPauseReason ??
                  t('monitor.pilotHint', {
                    defaultValue: 'Check for replies and blocks, then release the rest of the campaign.',
                  })}
              </p>
              <button
                type="button"
                onClick={() => void resume(true)}
                disabled={resuming}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-[#25D366]/90 disabled:opacity-50"
              >
                {resuming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                {t('monitor.releaseRest', {
                  defaultValue: 'Send to the remaining {{count}}',
                  count: live.counts.pending,
                })}
              </button>
              {resumeError && <p className="mt-2 text-[11px] text-red-400">{resumeError}</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── Ban protection, as it stands right now ──────────────────────────── */}
      {live.safety?.health && (() => {
        const h = live.safety.health;
        const gate = live.safety.gate;
        const obs = live.safety.observed;
        const tone = scoreTone(h.score);
        const measured = obs.attempted > 0;
        // Anything WhatsApp itself refused. These are the signals that precede a
        // ban, so they outrank the score whenever they are non-zero.
        const pushback = obs.hardBlocks + obs.coldReachoutBlocks;

        return (
          <div className={cn('rounded-2xl border p-4', tone.ring, tone.bg)}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#8696A0]">
                  {/* The label is the honest part: before a send this is a
                      forecast, during one it is a measurement. */}
                  {measured
                    ? t('monitor.safetyLive', { defaultValue: 'Ban protection · measured' })
                    : t('monitor.safetyForecast', { defaultValue: 'Ban protection · forecast' })}
                </p>
                <p className={cn('mt-1 text-lg font-bold tabular-nums', tone.text)}>
                  {h.confidence === 'none'
                    ? t('monitor.noHistory', { defaultValue: 'No sending history yet' })
                    : t('monitor.healthScore', { defaultValue: '{{score}}/100 account health', score: h.score })}
                </p>
              </div>

              <div className="text-end">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#8696A0]">
                  {t('monitor.budgetToday', { defaultValue: 'Today' })}
                </p>
                <p className="mt-1 text-sm font-bold tabular-nums text-gray-900 dark:text-white">
                  {h.budget.usedToday.toLocaleString()} / {h.budget.dailyLimit.toLocaleString()}
                </p>
              </div>
            </div>

            {/* The gate: why sending can or cannot happen this second. This is
                what makes the panel track the campaign instead of the save. */}
            {gate && !gate.ok && gate.reason && (
              <p className="mt-3 rounded-lg bg-white/60 px-3 py-2 text-xs font-medium leading-relaxed text-gray-800 dark:bg-black/20 dark:text-white/85">
                {gate.reason}
              </p>
            )}

            {(measured || pushback > 0) && (
              <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-gray-200/70 pt-3 text-center dark:border-white/10">
                {[
                  {
                    label: t('monitor.attempted', { defaultValue: 'Attempted' }),
                    value: obs.attempted.toLocaleString(),
                    tone: 'text-gray-900 dark:text-white',
                  },
                  {
                    label: t('monitor.failureRate', { defaultValue: 'Failed' }),
                    value: `${Math.round(obs.failureRate * 100)}%`,
                    tone: obs.failureRate > 0.15 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white',
                  },
                  {
                    label: t('monitor.pushback', { defaultValue: 'Refused by WhatsApp' }),
                    value: pushback.toLocaleString(),
                    tone: pushback > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white',
                  },
                ].map((cell) => (
                  <div key={cell.label} className="min-w-0">
                    <dd className={cn('text-sm font-bold tabular-nums', cell.tone)}>{cell.value}</dd>
                    <dt className="mt-0.5 text-[9px] uppercase leading-tight tracking-wide text-gray-500 break-words dark:text-[#8696A0]">
                      {cell.label}
                    </dt>
                  </div>
                ))}
              </dl>
            )}

            {/* When the prediction and the outcome disagree, say so rather than
                leaving a stale LOW badge on a campaign that is being refused. */}
            {measured && pushback > 0 && live.riskLevel === 'LOW' && (
              <p className="mt-2.5 text-[11px] leading-relaxed text-red-700 dark:text-red-300">
                {t('monitor.forecastBeaten', {
                  defaultValue:
                    'This was rated low risk before sending, but WhatsApp has refused messages since. Trust the measurement.',
                })}
              </p>
            )}
          </div>
        );
      })()}

      {/* ── Live metrics ────────────────────────────────────────────────────── */}
      {active && (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          icon={Activity}
          label={t('monitor.throughput', { defaultValue: 'Last hour' })}
          value={`${live.throughput.lastHour}`}
          sub={t('monitor.messagesSent', { defaultValue: 'messages sent' })}
          pulse={status === 'SENDING'}
        />
        <Metric
          icon={Clock}
          label={t('monitor.remaining', { defaultValue: 'Remaining' })}
          value={live.counts.pending.toLocaleString()}
          sub={eta ? t('monitor.eta', { defaultValue: 'about {{eta}} left', eta }) : undefined}
        />
        <Metric
          icon={Gauge}
          label={t('monitor.pace', { defaultValue: 'Pace' })}
          value={t(`safety.pacing_${live.pacingProfile}`, { defaultValue: profile.name })}
          sub={live.throttlePerHour ? `max ${live.throttlePerHour}/hr` : profile.rate}
        />
        <Metric
          icon={ShieldAlert}
          label={t('monitor.excluded', { defaultValue: 'Excluded' })}
          value={live.counts.skipped.toLocaleString()}
          sub={t('monitor.excludedSub', { defaultValue: 'opted out or on cooldown' })}
        />
      </div>
      )}

      {/* ── Waiting between batches ─────────────────────────────────────────── */}
      {live.nextBatchAt && status === 'SENDING' && (
        <p className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-[11px] text-gray-500 dark:border-white/10 dark:bg-[#0B141A] dark:text-[#8696A0]">
          <Clock className="h-3 w-3 shrink-0" />
          {t('monitor.waiting', {
            defaultValue: 'Pausing between batches — delivery resumes at {{time}}.',
            time: new Date(live.nextBatchAt).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }),
          })}
        </p>
      )}
    </div>
  );
}
