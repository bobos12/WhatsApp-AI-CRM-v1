import type { AccountHealth } from './account-health';
import type { AudienceQuality } from './contact-quality';
import type { ContentAnalysis } from './content-analyzer';
import { COOLDOWN_HOURS } from './contact-quality';
import {
  recommendProfile,
  simulate,
  slowerOf,
  type PacingProfile,
  type SimulationResult,
} from './pacing';
import { activeHoursPerDay, zoneBreakdown, type QuietHoursWindow } from './quiet-hours';

/**
 * ─── Risk engine ─────────────────────────────────────────────────────────────
 *
 * Turns everything the other modules know into one verdict a user can act on:
 * a score, the specific reasons behind it, and — the part that actually changes
 * behaviour — a concrete, applyable fix for each one.
 *
 * The design principle is that a limit the user does not understand is a limit
 * they route around. Someone told "audience too large" pastes the list into two
 * campaigns and sends both. Someone told "1,900 of these 2,000 people have never
 * messaged you, and that is what triggers error 463 — send to the 340 who have,
 * then warm the rest up over a fortnight" has been given a better plan than the
 * one they arrived with, and they take it.
 *
 * So: findings carry `fix` objects the UI renders as one-tap actions, and only
 * genuinely account-threatening conditions are hard blockers.
 */

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export interface RiskFinding {
  key: string;
  /** `blocker` prevents sending; the rest inform. */
  kind: 'blocker' | 'warning' | 'tip';
  label: string;
  detail: string;
  /** Contribution to the risk score. Blockers may be 0 — they block regardless. */
  weight: number;
  /** A one-tap remedy the UI can apply to the campaign form. */
  fix?: {
    /** What the UI should do. */
    action:
      | 'append_opt_out'
      | 'enable_smart_sending'
      | 'set_pacing'
      | 'drop_cold'
      | 'exclude_already_received'
      | 'enable_pilot'
      | 'enable_quiet_hours'
      | 'add_personalization'
      | 'reschedule';
    label: string;
    /** Payload for the action, e.g. `{ profile: 'CAREFUL' }`. */
    value?: Record<string, unknown>;
  };
}

export interface RecommendedSettings {
  pacingProfile: PacingProfile;
  smartSending: boolean;
  batchSize: number;
  batchIntervalMinutes: number;
  /** Send this many, then hold for a health re-check. Null disables the pilot. */
  pilotSize: number | null;
  quietHours: QuietHoursWindow;
  throttlePerHour: number;
  /** Audience size we would actually advise sending in one campaign. */
  maxAudienceToday: number;
}

export interface PreflightReport {
  generatedAt: string;
  riskScore: number;
  riskLevel: RiskLevel;
  /** True when nothing blocks the send. */
  canSend: boolean;
  findings: RiskFinding[];
  audience: {
    requested: number;
    deliverable: number;
    suppressed: number;
    optedOut: number;
    invalid: number;
    duplicates: number;
    cooldown: number;
    tiers: AudienceQuality['counts'];
    coldRatio: number;
    averageScore: number;
    unknownContacts: number;
    zones: Array<{ zone: string; count: number }>;
  };
  content: ContentAnalysis;
  health: AccountHealth;
  simulation: SimulationResult;
  recommended: RecommendedSettings;
  /** Prior campaign with the same content sent recently, if any. */
  duplicateOf: { id: string; name: string; sentAt: string | null; overlap: number } | null;
}

const LEVEL_THRESHOLDS: Array<{ atOrAbove: number; level: RiskLevel }> = [
  { atOrAbove: 70, level: 'CRITICAL' },
  { atOrAbove: 45, level: 'HIGH' },
  { atOrAbove: 22, level: 'MODERATE' },
  { atOrAbove: 0, level: 'LOW' },
];

function levelFor(score: number): RiskLevel {
  return LEVEL_THRESHOLDS.find((entry) => score >= entry.atOrAbove)!.level;
}

export interface RiskInput {
  health: AccountHealth;
  quality: AudienceQuality;
  content: ContentAnalysis;
  requested: number;
  suppressedCount: number;
  optedOutCount: number;
  invalidCount: number;
  duplicateCount: number;
  phones: string[];
  averageMessageLength: number;
  quietHours: QuietHoursWindow;
  /** The user's chosen profile, if they set one. */
  requestedProfile?: PacingProfile;
  duplicateOf?: { id: string; name: string; sentAt: Date | null; overlap: number } | null;
  isInteractive?: boolean;
  isScheduled?: boolean;
}

export function assessCampaign(input: RiskInput): PreflightReport {
  const { health, quality, content } = input;
  const findings: RiskFinding[] = [];
  let score = 0;

  const add = (finding: RiskFinding) => {
    findings.push(finding);
    score += finding.weight;
  };

  const deliverable = quality.deliverable;

  // ── Blockers ────────────────────────────────────────────────────────────────

  if (health.blocked) {
    add({
      key: 'account_blocked',
      kind: 'blocker',
      label: 'Sending is disabled to protect this number',
      detail: health.blockedReason ?? 'Account health is too low to send campaigns.',
      weight: 40,
    });
  }

  if (deliverable === 0) {
    add({
      key: 'empty_audience',
      kind: 'blocker',
      label: 'No deliverable recipients',
      detail:
        input.requested > 0
          ? 'Every recipient in this audience was removed — they have opted out, are suppressed, were messaged too recently, or the number is not valid.'
          : 'This campaign has no audience yet.',
      weight: 0,
    });
  }

  if (deliverable > health.budget.remainingToday && health.budget.remainingToday <= 0) {
    add({
      key: 'daily_budget_spent',
      kind: 'blocker',
      label: "Today's sending budget is used up",
      detail:
        `This number has already sent ${health.budget.usedToday} campaign messages today, which is its safe daily ` +
        `limit at ${health.account.phase === 'established' ? 'its current health level' : `${health.account.ageDays} days old`}. ` +
        'Schedule this campaign for tomorrow instead.',
      weight: 20,
      fix: { action: 'reschedule', label: 'Schedule for tomorrow morning' },
    });
  }

  // ── Audience risk ───────────────────────────────────────────────────────────

  const coldCount = Math.round(quality.coldRatio * deliverable);
  if (quality.coldRatio > 0.7 && deliverable >= 25) {
    add({
      key: 'mostly_cold',
      kind: 'warning',
      label: 'Almost everyone here has never messaged you',
      detail:
        `${coldCount} of ${deliverable} recipients (${Math.round(quality.coldRatio * 100)}%) have never sent you a message. ` +
        'Bulk outreach to people with no prior conversation is what WhatsApp blocks with error 463, and it is the ' +
        'most common reason a Business account gets restricted.',
      weight: Math.round(18 + quality.coldRatio * 20),
      fix: {
        action: 'drop_cold',
        label: `Send to the ${(deliverable - coldCount).toLocaleString()} contacts who have written to you`,
        value: { excludeCold: true },
      },
    });
  } else if (quality.coldRatio > 0.4 && deliverable >= 25) {
    add({
      key: 'many_cold',
      kind: 'warning',
      label: 'Large share of cold contacts',
      detail:
        `${coldCount} recipients (${Math.round(quality.coldRatio * 100)}%) have never messaged you. ` +
        'These carry most of the risk in this campaign.',
      weight: 10,
      fix: {
        action: 'enable_pilot',
        label: 'Send a small pilot first and check the response',
        value: { pilotSize: Math.min(50, Math.max(20, Math.round(deliverable * 0.05))) },
      },
    });
  }

  if (deliverable > health.budget.maxCampaignSize) {
    add({
      key: 'over_budget',
      kind: 'warning',
      label: 'Bigger than this number should send today',
      detail:
        `${deliverable.toLocaleString()} recipients against a safe remaining budget of ` +
        `${health.budget.remainingToday.toLocaleString()} for today. The campaign will be delivered over several days ` +
        'rather than all at once — that is intentional, and far safer than pushing it through in one session.',
      weight: 12,
      fix: {
        action: 'enable_smart_sending',
        label: 'Spread delivery across days automatically',
        value: { batchSize: Math.max(20, Math.floor(health.budget.dailyLimit / 4)), batchIntervalMinutes: 180 },
      },
    });
  }

  if (quality.unknownContacts > deliverable * 0.5 && deliverable >= 20) {
    add({
      key: 'unknown_contacts',
      kind: 'warning',
      label: 'Most numbers are not in your CRM',
      detail:
        `${quality.unknownContacts} of ${input.requested} numbers have no contact record. Pasted lists have no ` +
        'consent trail and no engagement history, which is exactly the profile WhatsApp scores as spam.',
      weight: 14,
    });
  }

  if (quality.averageScore < 30 && deliverable >= 25) {
    add({
      key: 'low_quality_audience',
      kind: 'warning',
      label: 'Low audience quality',
      detail:
        `Average contact quality is ${quality.averageScore}/100 — this audience has little recent engagement.`,
      weight: 8,
    });
  }

  // ── Account health ──────────────────────────────────────────────────────────

  if (!health.blocked && health.score < 50) {
    add({
      key: 'poor_health',
      kind: 'warning',
      label: `Account health is ${health.grade.toLowerCase().replace('_', ' ')}`,
      detail:
        `This number scores ${health.score}/100. ` +
        (health.signals[0]?.detail ?? 'Recent sending signals are worse than they should be.'),
      weight: Math.round((50 - health.score) / 2),
      fix: { action: 'set_pacing', label: 'Use the slowest sending speed', value: { profile: 'CAREFUL' } },
    });
  }

  if (health.account.phase !== 'established' && deliverable > health.budget.dailyLimit) {
    add({
      key: 'young_account_volume',
      kind: 'warning',
      label: 'New number, large campaign',
      detail:
        `This WhatsApp number was linked ${health.account.ageDays} day(s) ago and is still building trust. ` +
        `Its safe ceiling today is ${health.budget.dailyLimit} messages; delivery will be paced to respect that.`,
      weight: 12,
    });
  }

  // ── Duplicate campaign ──────────────────────────────────────────────────────

  if (input.duplicateOf) {
    const overlapPct = deliverable ? Math.round((input.duplicateOf.overlap / deliverable) * 100) : 0;
    add({
      key: 'duplicate_campaign',
      kind: 'warning',
      label: 'You already sent this',
      detail:
        `"${input.duplicateOf.name}" delivered the same message` +
        (input.duplicateOf.sentAt ? ` on ${new Date(input.duplicateOf.sentAt).toLocaleDateString()}` : '') +
        `, and ${input.duplicateOf.overlap.toLocaleString()} of these recipients (${overlapPct}%) already received it. ` +
        'Repeat sends of identical content are the fastest way to collect blocks.',
      weight: Math.min(25, 8 + Math.round(overlapPct / 5)),
      fix: {
        action: 'exclude_already_received',
        label: 'Remove people who already got this message',
        value: { excludeReceivedFrom: input.duplicateOf.id },
      },
    });
  }

  // ── Content ─────────────────────────────────────────────────────────────────

  score += content.riskWeight;
  for (const issue of content.issues) {
    findings.push({
      key: `content_${issue.key}`,
      kind: issue.severity === 'danger' ? 'warning' : 'tip',
      label: issue.label,
      detail: `${issue.detail} ${issue.suggestion}`,
      weight: issue.weight,
      fix:
        issue.key === 'no_opt_out'
          ? { action: 'append_opt_out', label: 'Add "Reply STOP to unsubscribe"' }
          : issue.key === 'no_personalization'
            ? { action: 'add_personalization', label: 'Insert the contact\'s first name' }
            : undefined,
    });
  }

  // ── Timing ──────────────────────────────────────────────────────────────────

  const zones = zoneBreakdown(input.phones.slice(0, 5000));
  if (!input.quietHours.enabled) {
    add({
      key: 'no_quiet_hours',
      kind: 'warning',
      label: 'Quiet hours are off',
      detail:
        'Messages can land in the middle of the recipient\'s night. A campaign that wakes someone at 3 a.m. ' +
        'gets blocked, not read.',
      weight: 10,
      fix: { action: 'enable_quiet_hours', label: 'Only deliver between 9am and 9pm local time' },
    });
  }

  if (zones.length > 3 && deliverable >= 50) {
    add({
      key: 'many_zones',
      kind: 'tip',
      label: `Recipients span ${zones.length} time zones`,
      detail:
        'Delivery is scheduled against each recipient\'s local clock, so the campaign will take longer than a ' +
        'single-region send — that is the trade for nobody being messaged at night.',
      weight: 0,
    });
  }

  // ── Recommendations ─────────────────────────────────────────────────────────

  const safeProfile = recommendProfile({
    healthScore: health.score,
    accountPhase: health.account.phase,
    coldRatio: quality.coldRatio,
  });
  // The user may pick a *slower* profile than recommended, never a faster one.
  const pacingProfile = input.requestedProfile ? slowerOf(input.requestedProfile, safeProfile) : safeProfile;

  const hoursPerDay = activeHoursPerDay(input.quietHours);
  const simulation = simulate({
    audienceSize: Math.max(1, deliverable),
    profile: pacingProfile,
    averageMessageLength: input.averageMessageLength,
    hourlyLimit: health.budget.hourlyLimit,
    dailyLimit: health.budget.dailyLimit,
    activeHoursPerDay: hoursPerDay,
  });

  // Batch settings that finish a day's budget in roughly four sittings, which
  // reads far more like a person working through a list than one long machine run.
  const batchSize = Math.max(10, Math.min(200, Math.floor(health.budget.dailyLimit / 4)));
  const needsSmartSending = deliverable > batchSize;

  // Pilot: a small first slice on any campaign large enough that being wrong
  // about it would be expensive.
  const pilotSize =
    deliverable >= 200
      ? Math.min(100, Math.max(25, Math.round(deliverable * 0.03)))
      : deliverable >= 60 && quality.coldRatio > 0.4
        ? 20
        : null;

  if (pilotSize && !findings.some((finding) => finding.key === 'many_cold')) {
    findings.push({
      key: 'pilot_recommended',
      kind: 'tip',
      label: 'Start with a pilot batch',
      detail:
        `The first ${pilotSize} messages go to your most engaged contacts, then the campaign pauses so you (and the ` +
        'health monitor) can see how WhatsApp responded before the rest goes out.',
      weight: 0,
      fix: { action: 'enable_pilot', label: `Send a pilot of ${pilotSize} first`, value: { pilotSize } },
    });
  }

  if (simulation.days > 1) {
    findings.push({
      key: 'multi_day',
      kind: 'tip',
      label: `Delivery will take ${simulation.summary}`,
      detail:
        `At a safe pace this number delivers about ${simulation.messagesPerDay.toLocaleString()} campaign messages a day. ` +
        'The campaign continues automatically each day until everyone has been reached.',
      weight: 0,
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const blockers = findings.filter((finding) => finding.kind === 'blocker');

  return {
    generatedAt: new Date().toISOString(),
    riskScore: score,
    riskLevel: levelFor(score),
    canSend: blockers.length === 0,
    // Blockers first, then by weight — the list reads worst-first without the UI
    // having to sort it.
    findings: findings.sort((a, b) => {
      if (a.kind !== b.kind) {
        const rank = { blocker: 0, warning: 1, tip: 2 } as const;
        return rank[a.kind] - rank[b.kind];
      }
      return b.weight - a.weight;
    }),
    audience: {
      requested: input.requested,
      deliverable,
      suppressed: input.suppressedCount,
      optedOut: input.optedOutCount,
      invalid: input.invalidCount,
      duplicates: input.duplicateCount,
      cooldown: quality.skipped.filter((recipient) => recipient.skipReason === 'COOLDOWN').length,
      tiers: quality.counts,
      coldRatio: quality.coldRatio,
      averageScore: quality.averageScore,
      unknownContacts: quality.unknownContacts,
      zones: zones.slice(0, 6),
    },
    content,
    health,
    simulation,
    recommended: {
      pacingProfile,
      smartSending: needsSmartSending,
      batchSize,
      batchIntervalMinutes: needsSmartSending ? Math.max(30, Math.round((hoursPerDay * 60) / 4)) : 30,
      pilotSize,
      quietHours: input.quietHours,
      throttlePerHour: health.budget.hourlyLimit,
      maxAudienceToday: health.budget.maxCampaignSize,
    },
    duplicateOf: input.duplicateOf
      ? {
          id: input.duplicateOf.id,
          name: input.duplicateOf.name,
          sentAt: input.duplicateOf.sentAt?.toISOString() ?? null,
          overlap: input.duplicateOf.overlap,
        }
      : null,
  };
}

export { COOLDOWN_HOURS };
