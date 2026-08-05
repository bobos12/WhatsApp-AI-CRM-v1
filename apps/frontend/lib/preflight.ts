/**
 * Wire types for the campaign safety report.
 *
 * Mirrors `broadcasts/safety/risk-engine.ts` on the server. The report is
 * produced there and never recomputed here — a second scoring implementation in
 * the browser would eventually disagree with the one that actually decides
 * whether a campaign sends, and the user would be shown a verdict the server
 * does not hold.
 */

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type HealthGrade = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'AT_RISK' | 'CRITICAL';
export type PacingProfile = 'CAREFUL' | 'BALANCED' | 'STEADY';
export type ContactTier = 'HOT' | 'WARM' | 'COOL' | 'COLD';

export type FixAction =
  | 'append_opt_out'
  | 'enable_smart_sending'
  | 'set_pacing'
  | 'drop_cold'
  | 'exclude_already_received'
  | 'enable_pilot'
  | 'enable_quiet_hours'
  | 'add_personalization'
  | 'reschedule';

export interface RiskFinding {
  key: string;
  kind: 'blocker' | 'warning' | 'tip';
  label: string;
  detail: string;
  weight: number;
  fix?: { action: FixAction; label: string; value?: Record<string, unknown> };
}

export interface HealthSignal {
  key: string;
  label: string;
  penalty: number;
  detail: string;
  severity: 'info' | 'warn' | 'danger';
}

/** How much sending history stands behind the score. See account-health.ts. */
export type HealthConfidence = 'none' | 'low' | 'good';

export interface AccountHealth {
  score: number;
  grade: HealthGrade;
  confidence: HealthConfidence;
  signals: HealthSignal[];
  metrics: {
    windowDays: number;
    sent: number;
    failed: number;
    failureRate: number;
    coldSent: number;
    coldRatio: number;
    hardBlocks: number;
    coldReachoutBlocks: number;
    replies: number;
    replyRate: number;
    optOuts: number;
    optOutRate: number;
    sentToday: number;
  };
  account: {
    ageDays: number;
    phase: 'new' | 'growing' | 'maturing' | 'established';
    linkAgeDays: number;
    basis: 'declared' | 'history' | 'link';
    companionRestricted: boolean;
  };
  budget: {
    dailyLimit: number;
    usedToday: number;
    remainingToday: number;
    maxCampaignSize: number;
    hourlyLimit: number;
  };
  blocked: boolean;
  blockedReason: string | null;
}

export interface ContentIssue {
  key: string;
  label: string;
  severity: 'info' | 'warn' | 'danger';
  weight: number;
  detail: string;
  suggestion: string;
}

export interface PreflightReport {
  generatedAt: string;
  riskScore: number;
  riskLevel: RiskLevel;
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
    tiers: Record<ContactTier, number>;
    coldRatio: number;
    averageScore: number;
    unknownContacts: number;
    zones: Array<{ zone: string; count: number }>;
  };
  content: {
    issues: ContentIssue[];
    riskWeight: number;
    stats: {
      length: number;
      words: number;
      linkCount: number;
      shortenerLinks: string[];
      emojiCount: number;
      capsRatio: number;
      exclamations: number;
      personalizationTokens: string[];
      hasOptOut: boolean;
      variantCount: number;
    };
  };
  health: AccountHealth;
  simulation: {
    ratePerHour: number;
    totalMinutes: number;
    days: number;
    messagesPerDay: number;
    summary: string;
  };
  recommended: {
    pacingProfile: PacingProfile;
    smartSending: boolean;
    batchSize: number;
    batchIntervalMinutes: number;
    pilotSize: number | null;
    quietHours: { enabled: boolean; start: number; end: number };
    throttlePerHour: number;
    maxAudienceToday: number;
  };
  duplicateOf: { id: string; name: string; sentAt: string | null; overlap: number } | null;
}

/** Colours per risk level, used by the badge and the score dial. */
export const RISK_STYLES: Record<RiskLevel, { text: string; bg: string; ring: string; stroke: string }> = {
  LOW:      { text: 'text-[#25D366]', bg: 'bg-[#25D366]/10', ring: 'border-[#25D366]/30', stroke: '#25D366' },
  MODERATE: { text: 'text-amber-300',  bg: 'bg-amber-400/10',  ring: 'border-amber-400/30',  stroke: '#fbbf24' },
  HIGH:     { text: 'text-orange-300', bg: 'bg-orange-500/10', ring: 'border-orange-400/30', stroke: '#fb923c' },
  CRITICAL: { text: 'text-red-300',    bg: 'bg-red-500/10',    ring: 'border-red-400/30',    stroke: '#f87171' },
};

export const HEALTH_STYLES: Record<HealthGrade, { text: string; bg: string; stroke: string }> = {
  EXCELLENT: { text: 'text-[#25D366]', bg: 'bg-[#25D366]/10', stroke: '#25D366' },
  GOOD:      { text: 'text-[#25D366]', bg: 'bg-[#25D366]/10', stroke: '#4ade80' },
  FAIR:      { text: 'text-amber-300', bg: 'bg-amber-400/10', stroke: '#fbbf24' },
  AT_RISK:   { text: 'text-orange-300', bg: 'bg-orange-500/10', stroke: '#fb923c' },
  CRITICAL:  { text: 'text-red-300',   bg: 'bg-red-500/10',   stroke: '#f87171' },
};

export const TIER_STYLES: Record<ContactTier, { label: string; dot: string; hint: string }> = {
  HOT:  { label: 'Active',   dot: 'bg-[#25D366]', hint: 'Messaged you in the last week' },
  WARM: { label: 'Engaged',  dot: 'bg-emerald-400/70', hint: 'Messaged you in the last 45 days' },
  COOL: { label: 'Quiet',    dot: 'bg-amber-400/70', hint: 'Has messaged you, but not recently' },
  COLD: { label: 'Never replied', dot: 'bg-red-400/70', hint: 'Has never sent you a message' },
};

/**
 * Human phrasing for pacing profiles. The numbers matter less than the framing:
 * users pick "Careful" when it is described as protective, and pick the fastest
 * option available when the choice reads as a speed setting.
 */
/**
 * Rates here are the measured output of the matching server profile, not a
 * marketing figure — the campaign-duration estimate is derived from the same
 * numbers, and a user who plans around "4 hours" should not get eight.
 */
export const PACING_LABELS: Record<PacingProfile, { name: string; blurb: string; rate: string }> = {
  CAREFUL:  { name: 'Careful',  blurb: 'Long, irregular gaps. Best for new numbers or cold audiences.', rate: '~120/hour' },
  BALANCED: { name: 'Balanced', blurb: 'Natural, hand-paced delivery. The safe default.', rate: '~280/hour' },
  STEADY:   { name: 'Steady',   blurb: 'Faster. Only for mature numbers with engaged audiences.', rate: '~440/hour' },
};

export function riskLabel(level: RiskLevel): string {
  return { LOW: 'Low risk', MODERATE: 'Some risk', HIGH: 'High risk', CRITICAL: 'Critical risk' }[level];
}

export function healthLabel(grade: HealthGrade): string {
  return {
    EXCELLENT: 'Excellent',
    GOOD: 'Good',
    FAIR: 'Fair',
    AT_RISK: 'At risk',
    CRITICAL: 'Critical',
  }[grade];
}

/**
 * What to actually show as the headline.
 *
 * A number that has never run a campaign scores in the eighties because nothing
 * has gone wrong, and calling that "Excellent" projects a confidence the data
 * has not earned — it is the same number a genuinely well-behaved account would
 * show, which makes the badge worthless precisely when it matters. Below the
 * evidence threshold the grade is withheld and the state is named instead.
 */
export function healthHeadline(health: Pick<AccountHealth, 'grade' | 'confidence'>): string {
  if (health.confidence === 'none') return 'No campaign history yet';
  if (health.confidence === 'low') return `${healthLabel(health.grade)} so far`;
  return healthLabel(health.grade);
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * A ratio with no denominator is not zero, it is unknown. Printing "0.0% reply
 * rate" for an account that has never sent anything reads as a damning
 * measurement of something that never happened.
 */
export function formatRatio(value: number, denominator: number, digits = 0): string {
  return denominator > 0 ? formatPercent(value, digits) : '—';
}

/** Same idea for plain counts that only mean something once there is traffic. */
export function formatCount(value: number, denominator: number): string {
  return denominator > 0 ? value.toLocaleString() : '—';
}
