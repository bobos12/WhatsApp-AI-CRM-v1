'use client';

/**
 * ─── Campaign safety report ──────────────────────────────────────────────────
 *
 * The screen that replaces "Send to 5,000 people?" with an argument.
 *
 * Its job is not to stop people sending. It is to make the safe choice the
 * obvious one, by showing three things a user cannot otherwise see: who is
 * really in this audience, what this number can survive today, and how long the
 * campaign will actually take. Every problem it raises carries a one-tap fix, so
 * acting on the advice is cheaper than ignoring it — which is the only reliable
 * way to change what people do.
 */

import { useMemo } from 'react';
import {
  ShieldCheck, ShieldAlert, AlertTriangle, Info, Users, Clock, Activity,
  Sparkles, ChevronRight, Loader2, TrendingUp, MessageSquareOff, Ban,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  formatCount, formatPercent, formatRatio, healthHeadline, riskLabel,
  HEALTH_STYLES, RISK_STYLES, TIER_STYLES,
  type ContactTier, type PreflightReport, type RiskFinding,
} from '../../lib/preflight';

/** Circular score dial. `invert` draws high-is-good (health) vs high-is-bad (risk). */
function ScoreDial({
  value,
  stroke,
  label,
  caption,
  size = 104,
}: {
  value: number;
  stroke: string;
  label: string;
  caption: string;
  size?: number;
}) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.min(100, Math.max(0, value)) / 100) * circumference;

  return (
    <div className="flex shrink-0 flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" className="text-gray-200 dark:text-white/8" strokeWidth="6" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={stroke}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">{Math.round(value)}</span>
          <span className="text-[9px] uppercase tracking-wider text-gray-500 dark:text-[#8696A0]">{caption}</span>
        </div>
      </div>
      <span className="mt-2 text-xs font-medium text-gray-700 dark:text-white/90">{label}</span>
    </div>
  );
}

/** A labelled horizontal segment bar — the audience tier mix. */
function TierBar({ tiers, total }: { tiers: Record<ContactTier, number>; total: number }) {
  const order: ContactTier[] = ['HOT', 'WARM', 'COOL', 'COLD'];
  if (!total) return null;

  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-gray-50 dark:bg-white/5">
        {order.map((tier) => {
          const count = tiers[tier] ?? 0;
          if (!count) return null;
          return (
            <div
              key={tier}
              className={cn('h-full transition-all duration-500', TIER_STYLES[tier].dot)}
              style={{ width: `${(count / total) * 100}%` }}
              title={`${TIER_STYLES[tier].label}: ${count.toLocaleString()}`}
            />
          );
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {order.map((tier) => {
          const count = tiers[tier] ?? 0;
          if (!count) return null;
          return (
            <div key={tier} className="flex items-center gap-1.5" title={TIER_STYLES[tier].hint}>
              <span className={cn('h-1.5 w-1.5 rounded-full', TIER_STYLES[tier].dot)} />
              <span className="text-[11px] text-gray-500 dark:text-[#8696A0]">
                {TIER_STYLES[tier].label}{' '}
                <span className="font-medium tabular-nums text-gray-600 dark:text-white/80">{count.toLocaleString()}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The audience funnel. Showing the shortfall — and naming each cause — is what
 * keeps a safety filter from being mistaken for a bug: "2,000 selected, 1,740
 * will receive it" is only reassuring when the missing 260 are accounted for.
 */
function AudienceFunnel({ audience }: { audience: PreflightReport['audience'] }) {
  const removed = [
    { key: 'optedOut', label: 'opted out', value: audience.optedOut, icon: MessageSquareOff, tone: 'text-red-300' },
    { key: 'suppressed', label: 'on the do-not-message list', value: Math.max(0, audience.suppressed - audience.optedOut), icon: Ban, tone: 'text-orange-300' },
    { key: 'cooldown', label: 'messaged too recently', value: audience.cooldown, icon: Clock, tone: 'text-amber-300' },
    { key: 'duplicates', label: 'duplicate numbers', value: audience.duplicates, icon: Users, tone: 'text-gray-500 dark:text-[#8696A0]' },
    { key: 'invalid', label: 'not valid numbers', value: audience.invalid, icon: AlertTriangle, tone: 'text-gray-500 dark:text-[#8696A0]' },
  ].filter((row) => row.value > 0);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-[#8696A0]">Will receive this</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
            {audience.deliverable.toLocaleString()}
          </p>
        </div>
        {audience.requested !== audience.deliverable && (
          <p className="text-[11px] text-gray-500 dark:text-[#8696A0]">
            of {audience.requested.toLocaleString()} selected
          </p>
        )}
      </div>

      {removed.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-gray-100 dark:border-white/5 pt-3">
          {removed.map((row) => (
            <li key={row.key} className="flex items-center gap-2 text-[11px]">
              <row.icon className={cn('h-3 w-3 shrink-0', row.tone)} />
              <span className="tabular-nums font-medium text-gray-600 dark:text-white/80">{row.value.toLocaleString()}</span>
              <span className="text-gray-500 dark:text-[#8696A0]">{row.label}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <TierBar tiers={audience.tiers} total={audience.deliverable} />
      </div>
    </div>
  );
}

const KIND_STYLES = {
  blocker: { icon: Ban, ring: 'border-red-400/30 bg-red-500/[0.07]', tone: 'text-red-300' },
  warning: { icon: AlertTriangle, ring: 'border-amber-400/25 bg-amber-400/[0.05]', tone: 'text-amber-300' },
  tip: { icon: Info, ring: 'border-gray-200 dark:border-white/10 bg-white/[0.02]', tone: 'text-gray-500 dark:text-[#8696A0]' },
} as const;

function FindingCard({
  finding,
  onApplyFix,
  applied,
}: {
  finding: RiskFinding;
  onApplyFix?: (finding: RiskFinding) => void;
  applied: boolean;
}) {
  const style = KIND_STYLES[finding.kind];
  const Icon = style.icon;

  return (
    <div className={cn('rounded-xl border p-3.5 transition-colors', style.ring)}>
      <div className="flex items-start gap-2.5">
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.tone)} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-gray-900 dark:text-white">{finding.label}</p>
          <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-[#8696A0]">{finding.detail}</p>

          {finding.fix && onApplyFix && (
            <button
              type="button"
              onClick={() => onApplyFix(finding)}
              disabled={applied}
              className={cn(
                'group mt-2.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all',
                applied
                  ? 'cursor-default bg-[#25D366]/10 text-[#25D366]'
                  : 'bg-gray-100 dark:bg-white/[0.06] text-gray-900 dark:text-white hover:bg-[#25D366]/15 hover:text-[#25D366]',
              )}
            >
              {applied ? (
                <>
                  <ShieldCheck className="h-3 w-3" />
                  Applied
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" />
                  {finding.fix.label}
                  <ChevronRight className="h-3 w-3 opacity-50 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 dark:border-white/[0.07] dark:bg-white/[0.02] px-3 py-2.5" title={hint}>
      <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-[#8696A0]">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

export interface SafetyReportProps {
  report: PreflightReport | null;
  loading?: boolean;
  error?: string | null;
  /** Omitted on read-only views (the campaign detail page). */
  onApplyFix?: (finding: RiskFinding) => void;
  appliedFixes?: Set<string>;
  /** Hide the account-health block when it is already shown elsewhere. */
  compact?: boolean;
}

export default function SafetyReport({
  report,
  loading,
  error,
  onApplyFix,
  appliedFixes,
  compact,
}: SafetyReportProps) {
  const blockers = useMemo(() => report?.findings.filter((f) => f.kind === 'blocker') ?? [], [report]);
  const warnings = useMemo(() => report?.findings.filter((f) => f.kind === 'warning') ?? [], [report]);
  const tips = useMemo(() => report?.findings.filter((f) => f.kind === 'tip') ?? [], [report]);

  if (error) {
    return (
      <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-4">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div>
            <p className="text-[13px] font-semibold text-gray-900 dark:text-white">Safety check unavailable</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-[#8696A0]">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A] px-4 py-10 text-xs text-gray-500 dark:text-[#8696A0]">
        {loading ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking this campaign…
          </>
        ) : (
          <>
            <Users className="h-3.5 w-3.5" />
            Pick an audience to see the safety report.
          </>
        )}
      </div>
    );
  }

  const risk = RISK_STYLES[report.riskLevel];
  const health = HEALTH_STYLES[report.health.grade];
  const { budget } = report.health;
  const budgetUsed = budget.dailyLimit ? budget.usedToday / budget.dailyLimit : 0;

  return (
    <div className={cn('space-y-4', loading && 'opacity-60 transition-opacity')}>
      {/* ── Verdict ─────────────────────────────────────────────────────────── */}
      <div className={cn('rounded-2xl border p-5', risk.ring, risk.bg)}>
        <div className="flex flex-wrap items-center gap-5 sm:flex-nowrap">
          <ScoreDial
            value={report.riskScore}
            stroke={risk.stroke}
            label={riskLabel(report.riskLevel)}
            caption="risk"
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {report.riskLevel === 'LOW' ? (
                <ShieldCheck className={cn('h-4 w-4', risk.text)} />
              ) : (
                <ShieldAlert className={cn('h-4 w-4', risk.text)} />
              )}
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {report.riskLevel === 'LOW'
                  ? 'This campaign looks healthy'
                  : report.riskLevel === 'CRITICAL'
                    ? 'This campaign puts your WhatsApp number at risk'
                    : 'A few things are worth fixing first'}
              </p>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-[#8696A0]">
              {blockers.length > 0
                ? `${blockers.length} issue${blockers.length === 1 ? '' : 's'} must be resolved before this can send.`
                : warnings.length > 0
                  ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'} — each one below has a one-tap fix.`
                  : 'No warnings. Delivery is paced to look like a person, not a bot.'}
            </p>

            <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat
                label="Recipients"
                value={report.audience.deliverable.toLocaleString()}
                hint="After opt-outs, cooldowns and invalid numbers are removed"
              />
              <Stat
                label="Takes"
                value={report.simulation.summary.replace('about ', '')}
                hint={`About ${report.simulation.ratePerHour} messages an hour at a safe pace`}
              />
              <Stat
                label="Never replied"
                value={formatPercent(report.audience.coldRatio)}
                hint="Share of the audience that has never messaged you — the riskiest traffic there is"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Audience + account ──────────────────────────────────────────────── */}
      <div className={cn('grid gap-4', compact ? 'grid-cols-1' : 'md:grid-cols-2')}>
        <AudienceFunnel audience={report.audience} />

        {!compact && (
          <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-[#8696A0]">Number health</p>
                <p className={cn('mt-0.5 text-lg font-bold', report.health.confidence === 'none' ? 'text-gray-500 dark:text-[#8696A0]' : health.text)}>
                  {healthHeadline(report.health)}
                  {report.health.confidence !== 'none' && (
                    <span className="ml-1.5 text-xs font-normal text-gray-500 dark:text-[#8696A0]">{report.health.score}/100</span>
                  )}
                </p>
              </div>
              <Activity className={cn('h-4 w-4', health.text)} />
            </div>

            {/* Today's budget — the number that decides whether this sends now. */}
            <div className="mt-3.5">
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="text-gray-500 dark:text-[#8696A0]">Today&apos;s safe volume</span>
                <span className="tabular-nums text-gray-600 dark:text-white/80">
                  {budget.usedToday.toLocaleString()} / {budget.dailyLimit.toLocaleString()}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-50 dark:bg-white/5">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    budgetUsed > 0.9 ? 'bg-red-400' : budgetUsed > 0.7 ? 'bg-amber-400' : 'bg-[#25D366]',
                  )}
                  style={{ width: `${Math.min(100, budgetUsed * 100)}%` }}
                />
              </div>
            </div>

            <dl className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-gray-100 dark:border-white/5 pt-3 text-[11px]">
              <div className="flex items-center justify-between">
                <dt className="text-gray-500 dark:text-[#8696A0]">Reply rate</dt>
                <dd className="tabular-nums text-gray-600 dark:text-white/80">
                  {formatRatio(report.health.metrics.replyRate, report.health.metrics.sent, 1)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-gray-500 dark:text-[#8696A0]">Blocked by</dt>
                <dd className="tabular-nums text-gray-600 dark:text-white/80">
                  {formatCount(report.health.metrics.hardBlocks, report.health.metrics.sent)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-gray-500 dark:text-[#8696A0]">Unsubscribes</dt>
                <dd className="tabular-nums text-gray-600 dark:text-white/80">
                  {formatCount(report.health.metrics.optOuts, report.health.metrics.sent)}
                </dd>
              </div>
              <div
                className="flex items-center justify-between"
                title={
                  report.health.account.basis === 'link'
                    ? 'Measured from when this number was linked here. If it was in use before that, set its start date in settings.'
                    : report.health.account.basis === 'history'
                      ? 'Inferred from the message history in this CRM.'
                      : 'As declared in settings.'
                }
              >
                <dt className="text-gray-500 dark:text-[#8696A0]">Number age</dt>
                <dd className="tabular-nums text-gray-600 dark:text-white/80">{report.health.account.ageDays}d</dd>
              </div>
            </dl>

            {report.health.signals.length > 0 && (
              <p className="mt-3 border-t border-gray-100 dark:border-white/5 pt-3 text-[11px] leading-relaxed text-gray-500 dark:text-[#8696A0]">
                {report.health.signals[0].detail}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Delivery plan ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#0B141A] p-4">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 text-[#25D366]" />
          <p className="text-[13px] font-semibold text-gray-900 dark:text-white">Delivery plan</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Pace" value={`${report.simulation.ratePerHour}/hr`} hint="Messages an hour, including natural pauses" />
          <Stat label="Per day" value={report.simulation.messagesPerDay.toLocaleString()} />
          <Stat label="Finishes in" value={report.simulation.summary.replace('about ', '')} />
          <Stat
            label="Quiet hours"
            value={report.recommended.quietHours.enabled
              ? `${report.recommended.quietHours.end}:00–${report.recommended.quietHours.start}:00`
              : 'Off'}
            hint="Recipient's local time — nobody is messaged during their night"
          />
        </div>
        {report.audience.zones.length > 1 && (
          <p className="mt-3 text-[11px] text-gray-500 dark:text-[#8696A0]">
            Recipients span {report.audience.zones.length} time zones. Each one is delivered against its own local
            clock.
          </p>
        )}
      </div>

      {/* ── Findings ────────────────────────────────────────────────────────── */}
      {(blockers.length > 0 || warnings.length > 0 || tips.length > 0) && (
        <div className="space-y-2">
          {[...blockers, ...warnings, ...tips].map((finding) => (
            <FindingCard
              key={finding.key}
              finding={finding}
              onApplyFix={onApplyFix}
              applied={appliedFixes?.has(finding.key) ?? false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
