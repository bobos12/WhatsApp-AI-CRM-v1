import type { ContactTier } from './contact-quality';

/**
 * ─── Adaptive, humanised pacing ──────────────────────────────────────────────
 *
 * The old worker waited `uniform(1500ms, 4000ms)` between every message, forever,
 * at any hour, regardless of who it was messaging or how the account was doing.
 *
 * That is not a safe pattern; it is a *signature*. A uniform distribution with a
 * hard floor and ceiling produces an inter-arrival histogram no human hand ever
 * generates, and it holds that shape for hours. Worse, it caps throughput at a
 * flat ~1,400/hour whether the account was linked yesterday or three years ago —
 * simultaneously too fast for a new number and needlessly slow for a mature one.
 *
 * What replaces it:
 *
 *   • **Log-normal gaps.** Mostly short, occasionally long, with a fat tail —
 *     the shape real messaging traffic actually has.
 *   • **Typing time.** Longer messages take longer to "write". A 600-character
 *     promo appearing 1.5s after the last one is not something a person did.
 *   • **Micro-bursts and rests.** People fire off two or three messages quickly,
 *     then stop for a while. Every so often the pacer takes a longer break.
 *   • **Tier-aware.** Cold recipients — the ones that draw 463s — are spaced
 *     further apart than people who messaged us last week.
 *   • **Health-aware.** The profile is chosen from account health and age, and
 *     the circuit breaker can slow a run down mid-flight.
 */

export type PacingProfile = 'CAREFUL' | 'BALANCED' | 'STEADY';

export interface PacingConfig {
  profile: PacingProfile;
  /** Median gap between messages, ms. The distribution is centred here. */
  medianGapMs: number;
  /** Spread of the log-normal, in natural-log units. Higher = more variance. */
  sigma: number;
  /** Never go below this, whatever the draw. */
  minGapMs: number;
  /** Never exceed this on an ordinary draw (rest breaks are separate). */
  maxGapMs: number;
  /** Messages sent back-to-back before a longer pause is considered. */
  burstSize: number;
  /** Probability of taking a rest break after a burst. */
  restChance: number;
  /** Rest break duration bounds, ms. */
  restMinMs: number;
  restMaxMs: number;
  /** Hard ceiling on messages per hour for this profile. */
  maxPerHour: number;
}

/**
 * The three envelopes.
 *
 * Tuned against `effectiveHourlyRate` so the throughput each one advertises is
 * the throughput it delivers — a profile called "Balanced ~250/hour" that
 * actually manages 119 turns the campaign-duration estimate into a lie, and the
 * duration estimate is the number users plan around.
 *
 * The safety here is not in being slow. It is in the *shape*: a fat-tailed gap
 * distribution, genuine pauses, and per-tier spacing produce an inter-arrival
 * pattern that does not look machine-generated, at throughput a business can
 * still work with. Volume is bounded separately, by the daily budget.
 */
const PROFILES: Record<PacingProfile, PacingConfig> = {
  // A new or struggling number: ~120/hour. Slower than a busy human agent, which
  // is the point — this profile exists for numbers WhatsApp is still watching.
  CAREFUL: {
    profile: 'CAREFUL',
    medianGapMs: 16_000,
    sigma: 0.75,
    minGapMs: 6_000,
    maxGapMs: 240_000,
    burstSize: 2,
    restChance: 0.12,
    restMinMs: 60_000,
    restMaxMs: 180_000,
    maxPerHour: 150,
  },
  // The default: ~280/hour. Comfortably productive, still recognisably hand-paced.
  BALANCED: {
    profile: 'BALANCED',
    medianGapMs: 6_000,
    sigma: 0.8,
    minGapMs: 3_000,
    maxGapMs: 120_000,
    burstSize: 3,
    restChance: 0.1,
    restMinMs: 45_000,
    restMaxMs: 150_000,
    maxPerHour: 350,
  },
  // A mature, healthy number with an engaged audience: ~500/hour.
  STEADY: {
    profile: 'STEADY',
    medianGapMs: 3_200,
    sigma: 0.85,
    minGapMs: 1_800,
    maxGapMs: 60_000,
    burstSize: 4,
    restChance: 0.08,
    restMinMs: 30_000,
    restMaxMs: 120_000,
    maxPerHour: 600,
  },
};

export function pacingConfig(profile: PacingProfile): PacingConfig {
  return PROFILES[profile] ?? PROFILES.BALANCED;
}

export const PACING_PROFILES = Object.keys(PROFILES) as PacingProfile[];

/**
 * Pick a profile from account health and maturity.
 *
 * This is not advisory — the send path uses the result as a ceiling on whatever
 * the user asked for, so a healthy-looking UI slider can never talk a
 * three-day-old number into STEADY.
 */
export function recommendProfile(input: {
  healthScore: number;
  accountPhase: 'new' | 'growing' | 'maturing' | 'established';
  coldRatio: number;
}): PacingProfile {
  if (input.accountPhase === 'new' || input.accountPhase === 'growing') return 'CAREFUL';
  if (input.healthScore < 55) return 'CAREFUL';
  if (input.coldRatio > 0.6) return 'CAREFUL';
  if (input.accountPhase === 'maturing') return 'BALANCED';
  if (input.healthScore >= 85 && input.coldRatio < 0.25) return 'STEADY';
  return 'BALANCED';
}

/** Order the profiles so "no faster than" comparisons are one index check. */
const SPEED_RANK: Record<PacingProfile, number> = { CAREFUL: 0, BALANCED: 1, STEADY: 2 };

/** The slower of two profiles. Used to clamp a user's choice to what's safe. */
export function slowerOf(a: PacingProfile, b: PacingProfile): PacingProfile {
  return SPEED_RANK[a] <= SPEED_RANK[b] ? a : b;
}

/**
 * Standard normal via Box–Muller. `Math.random()` is fine here: this is traffic
 * shaping, not cryptography, and predictability is not the threat model.
 */
function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** A draw from a log-normal centred on `median`. */
function logNormal(median: number, sigma: number): number {
  return median * Math.exp(sigma * gaussian());
}

/**
 * Handling time that scales with message length.
 *
 * Not full composition time — a campaign body is written once and sent many
 * times, so simulating someone typing it out per recipient would be both
 * dishonest and ruinously slow. This models the shorter, real gap: picking the
 * next contact, glancing at the message, sending. ~90ms per word, capped, so a
 * long promo still spaces out further than a one-liner.
 */
function typingTimeMs(messageLength: number): number {
  const words = Math.max(1, Math.round(messageLength / 5));
  return Math.min(10_000, words * 90);
}

export interface PaceInput {
  config: PacingConfig;
  /** Index of the message inside the current run — drives burst/rest rhythm. */
  index: number;
  /** Characters in the body actually being sent. */
  messageLength: number;
  tier?: ContactTier;
  /** Multiplier applied on top, ≥1. The circuit breaker uses this to back off. */
  slowdown?: number;
}

export interface PaceDecision {
  delayMs: number;
  /** True when this gap is a deliberate long pause rather than a normal draw. */
  isRest: boolean;
}

/** Cold contacts get more room; warm ones can move at conversation speed. */
const TIER_MULTIPLIER: Record<ContactTier, number> = {
  HOT: 0.75,
  WARM: 0.9,
  COOL: 1.15,
  COLD: 1.45,
};

/**
 * Decide how long to wait before the *next* message.
 *
 * Called after each send. The result already includes typing time, so the caller
 * simply sleeps for it.
 */
export function nextDelay(input: PaceInput): PaceDecision {
  const { config, index, messageLength } = input;
  const slowdown = Math.max(1, input.slowdown ?? 1);
  const tierMultiplier = input.tier ? TIER_MULTIPLIER[input.tier] : 1;

  // End of a burst: consider a rest. A human sends a few, then does something
  // else — that gap is the most human thing in the whole distribution.
  const atBurstBoundary = index > 0 && (index + 1) % config.burstSize === 0;
  if (atBurstBoundary && Math.random() < config.restChance) {
    const rest = config.restMinMs + Math.random() * (config.restMaxMs - config.restMinMs);
    return { delayMs: Math.round(rest * slowdown), isRest: true };
  }

  const base = logNormal(config.medianGapMs, config.sigma);
  const withTyping = base + typingTimeMs(messageLength);
  const scaled = withTyping * tierMultiplier * slowdown;

  return {
    delayMs: Math.round(Math.min(config.maxGapMs * slowdown, Math.max(config.minGapMs, scaled))),
    isRest: false,
  };
}

/**
 * Effective messages per hour for a profile, accounting for rest breaks.
 * Used by the simulator so the duration shown to the user is the one they get.
 */
export function effectiveHourlyRate(config: PacingConfig, averageMessageLength = 120): number {
  const typing = typingTimeMs(averageMessageLength);
  // E[log-normal] = median·e^(σ²/2)
  const meanGap = config.medianGapMs * Math.exp((config.sigma * config.sigma) / 2) + typing;
  const restsPerMessage = config.restChance / config.burstSize;
  const meanRest = (config.restMinMs + config.restMaxMs) / 2;
  const perMessageMs = meanGap + restsPerMessage * meanRest;
  const uncapped = 3_600_000 / perMessageMs;
  return Math.floor(Math.min(config.maxPerHour, uncapped));
}

export interface SimulationInput {
  audienceSize: number;
  profile: PacingProfile;
  averageMessageLength?: number;
  /** Ceiling from account health; the simulation honours the lower of the two. */
  hourlyLimit?: number;
  dailyLimit?: number;
  /** Hours per day the campaign may actually deliver in (quiet hours removed). */
  activeHoursPerDay?: number;
}

export interface SimulationResult {
  ratePerHour: number;
  totalMinutes: number;
  /** Days needed once daily budget and quiet hours are applied. */
  days: number;
  messagesPerDay: number;
  /** Human-readable, e.g. "about 3 hours" / "2 days". */
  summary: string;
}

/**
 * Project how long a campaign will actually take.
 *
 * The value of showing this before the send is not the number — it is that a
 * user who sees "this will take 4 days" reconsiders the audience, which is a
 * better outcome than any limit we could impose.
 */
export function simulate(input: SimulationInput): SimulationResult {
  const config = pacingConfig(input.profile);
  const profileRate = effectiveHourlyRate(config, input.averageMessageLength ?? 120);
  const ratePerHour = Math.max(1, Math.min(profileRate, input.hourlyLimit ?? profileRate));
  const activeHours = Math.max(1, input.activeHoursPerDay ?? 12);

  const perDayByRate = ratePerHour * activeHours;
  const messagesPerDay = Math.max(1, Math.min(perDayByRate, input.dailyLimit ?? perDayByRate));

  const days = Math.max(1, Math.ceil(input.audienceSize / messagesPerDay));
  const totalMinutes = Math.round((input.audienceSize / ratePerHour) * 60);

  let summary: string;
  if (days > 1) {
    summary = `about ${days} days`;
  } else if (totalMinutes >= 90) {
    summary = `about ${Math.round(totalMinutes / 60)} hours`;
  } else if (totalMinutes >= 60) {
    summary = 'about an hour';
  } else {
    summary = `about ${Math.max(1, totalMinutes)} minutes`;
  }

  return { ratePerHour, totalMinutes, days, messagesPerDay, summary };
}
