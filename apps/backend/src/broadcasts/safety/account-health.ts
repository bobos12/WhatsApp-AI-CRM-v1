import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { getAuthSessionId } from '../../whatsapp/client';

/**
 * ─── Account health ──────────────────────────────────────────────────────────
 *
 * A single number, 0–100, answering "how close is this WhatsApp number to being
 * restricted?" — and the evidence behind it.
 *
 * The old module had no concept of this at all. It would happily push a
 * five-thousand-recipient campaign through a socket that WhatsApp had already
 * started refusing, marking each refusal as an ordinary failure and moving on to
 * the next number. That is the exact loop that converts a warning into a ban.
 *
 * The signals, in rough order of how much they predict a restriction:
 *
 *   1. 463 cold-reachout blocks. WhatsApp explicitly time-locking outbound to
 *      people who never messaged first. This is the last warning before a
 *      restriction, so it is weighted brutally.
 *   2. 403 hard blocks. The recipient blocked the number. A handful is normal;
 *      a rising rate is the strongest recipient-side negative signal there is.
 *   3. Opt-out rate. Customers actively asking to stop.
 *   4. Cold ratio — what share of outbound goes to people who never wrote to us.
 *   5. Overall broadcast failure rate.
 *   6. Reply rate, inverted: a campaign nobody answers looks like a blast.
 *   7. Account age (warm-up phase) and today's volume against budget.
 *
 * Everything is read from `AccountHealthDay`, a small per-tenant daily rollup, so
 * scoring costs one indexed read of ~14 rows rather than aggregating Message.
 */

/** How many days of history feed the score. */
const WINDOW_DAYS = 14;
/** Below this many sends, ratios are statistically meaningless — don't punish. */
const MIN_SAMPLE = 25;

export type HealthGrade = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'AT_RISK' | 'CRITICAL';

/**
 * How much the score is actually worth.
 *
 * A number with no sending history scores high because nothing has gone wrong
 * yet, not because anything has gone right — the same reasoning that makes a
 * credit score meaningless for someone who has never borrowed. Callers use this
 * to say "not enough data" instead of "Excellent", which is the honest reading
 * and stops the banner projecting confidence it has not earned.
 */
export type HealthConfidence = 'none' | 'low' | 'good';

export interface HealthSignal {
  key: string;
  label: string;
  /** How many points this signal removed from 100. */
  penalty: number;
  detail: string;
  severity: 'info' | 'warn' | 'danger';
}

export interface AccountHealth {
  score: number;
  grade: HealthGrade;
  /** Whether there is enough sending history for the score to mean anything. */
  confidence: HealthConfidence;
  signals: HealthSignal[];
  /** Rolled-up window metrics, exposed so the UI can chart them. */
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
  /** Account maturity, and where the verdict came from. */
  account: {
    ageDays: number;
    phase: 'new' | 'growing' | 'maturing' | 'established';
    linkAgeDays: number;
    basis: 'declared' | 'history' | 'link';
    companionRestricted: boolean;
  };
  /** What this account may send today, and what is left. */
  budget: {
    dailyLimit: number;
    usedToday: number;
    remainingToday: number;
    /** Suggested ceiling for a single campaign right now. */
    maxCampaignSize: number;
    hourlyLimit: number;
  };
  /** Set when health is so poor that sending should stop entirely. */
  blocked: boolean;
  blockedReason: string | null;
}

function startOfUtcDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Increment today's rollup. Best-effort by design: a lost counter must never
 * fail a send, and the score tolerates small gaps.
 */
export async function bumpHealthCounter(delta: {
  broadcastSent?: number;
  broadcastFailed?: number;
  coldSent?: number;
  hardBlocks?: number;
  coldReachoutBlocks?: number;
  broadcastReplies?: number;
  optOuts?: number;
}): Promise<void> {
  const date = startOfUtcDay();
  const increments = Object.fromEntries(
    Object.entries(delta)
      .filter(([, value]) => typeof value === 'number' && value !== 0)
      .map(([key, value]) => [key, { increment: value }]),
  );
  if (!Object.keys(increments).length) return;

  const create = Object.fromEntries(
    Object.entries(delta).filter(([, value]) => typeof value === 'number' && value !== 0),
  );

  try {
    // No composite-unique upsert here: the tenant guard stamps `tenantId` onto
    // `create` but cannot rewrite a `where: { tenantId_date: … }` locator, so the
    // compound key would have to be assembled by the caller. Find-then-write is
    // equivalent at this volume (one row per tenant per day) and stays guarded.
    const existing = await prisma.accountHealthDay.findFirst({ where: { date }, select: { id: true } });
    if (existing) {
      await prisma.accountHealthDay.update({ where: { id: existing.id }, data: increments });
    } else {
      await prisma.accountHealthDay.create({ data: { date, ...create } as any });
    }
  } catch (error) {
    // A unique-violation here means a concurrent worker created the row first.
    // Retry the increment once; anything else is swallowed.
    try {
      const row = await prisma.accountHealthDay.findFirst({ where: { date }, select: { id: true } });
      if (row) await prisma.accountHealthDay.update({ where: { id: row.id }, data: increments });
    } catch {
      logger.warn('broadcast.health_counter_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

interface RollupTotals {
  sent: number;
  failed: number;
  coldSent: number;
  hardBlocks: number;
  coldReachoutBlocks: number;
  replies: number;
  optOuts: number;
}

function emptyTotals(): RollupTotals {
  return { sent: 0, failed: 0, coldSent: 0, hardBlocks: 0, coldReachoutBlocks: 0, replies: 0, optOuts: 0 };
}

async function readWindow(days: number): Promise<{ window: RollupTotals; today: RollupTotals }> {
  const today = startOfUtcDay();
  const from = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  const rows = await prisma.accountHealthDay.findMany({
    where: { date: { gte: from } },
    orderBy: { date: 'asc' },
  });

  const windowTotals = emptyTotals();
  const todayTotals = emptyTotals();

  for (const row of rows) {
    const bucket = row.date.getTime() === today.getTime() ? [windowTotals, todayTotals] : [windowTotals];
    for (const target of bucket) {
      target.sent += row.broadcastSent;
      target.failed += row.broadcastFailed;
      target.coldSent += row.coldSent;
      target.hardBlocks += row.hardBlocks;
      target.coldReachoutBlocks += row.coldReachoutBlocks;
      target.replies += row.broadcastReplies;
      target.optOuts += row.optOuts;
    }
  }

  return { window: windowTotals, today: todayTotals };
}

/**
 * ─── Account maturity ────────────────────────────────────────────────────────
 *
 * Two different risks live here, and conflating them is a mistake that costs a
 * real business most of its throughput for no safety benefit:
 *
 *   • **Account trust.** How long the *number* has been a real WhatsApp presence.
 *     A number run for three years with thousands of conversations is trusted by
 *     WhatsApp, and this is what mostly governs how much volume it can carry.
 *
 *   • **Companion-device age.** How long *this Baileys link* has existed. A newly
 *     linked device is watched closely — that is precisely what error 463
 *     (RESTRICT_ALL_COMPANIONS) enforces — but the restriction is narrow: it
 *     targets *cold reachout*, messaging people who never messaged first. It is
 *     also short-lived, days rather than weeks.
 *
 * So a mature number on a fresh link gets full volume to people it already talks
 * to, and a tight leash on cold contacts for the first few days. Treating it as
 * a brand-new account — which is what reading `WhatsAppSession.createdAt` alone
 * does — caps a three-year-old business number at 40 messages a day.
 *
 * Maturity is the strongest of three sources, because each is a *lower bound* on
 * how long the number has existed:
 *
 *   1. Link age — when this session row was created.
 *   2. CRM evidence — how far back the message history reaches. If we hold two
 *      months of conversations, the number is at least two months old.
 *   3. Operator declaration — `accountActiveSince`. The only source that can
 *      speak for a number whose history predates this CRM entirely.
 */
export interface AccountAge {
  /** Days of established WhatsApp presence — the strongest available evidence. */
  ageDays: number;
  phase: 'new' | 'growing' | 'maturing' | 'established';
  baseDailyLimit: number;
  /** Days since *this device link*. Governs cold-outreach headroom only. */
  linkAgeDays: number;
  /** Which source won, so the UI can explain the verdict rather than assert it. */
  basis: 'declared' | 'history' | 'link';
  /** True while the fresh-link cold-reachout restriction still plausibly applies. */
  companionRestricted: boolean;
}

const PHASE_LIMITS: Array<{ untilDay: number; phase: AccountAge['phase']; limit: number }> = [
  { untilDay: 3, phase: 'new', limit: 40 },
  { untilDay: 7, phase: 'growing', limit: 120 },
  { untilDay: 14, phase: 'maturing', limit: 350 },
  { untilDay: 29, phase: 'established', limit: 800 },
];
const MATURE_DAILY_LIMIT = Number(process.env.BROADCAST_MAX_DAILY ?? 1500);

/**
 * How long a freshly linked companion device stays under the cold-reachout
 * leash. WhatsApp's 463 timelock on new links typically clears within a few
 * days; this is deliberately short because it throttles cold contacts only.
 */
const COMPANION_WATCH_DAYS = Number(process.env.BROADCAST_COMPANION_WATCH_DAYS ?? 5);

const DAY = 24 * 60 * 60 * 1000;
const daysSince = (date: Date): number => Math.floor((Date.now() - date.getTime()) / DAY);

export async function getAccountAge(): Promise<AccountAge> {
  let session: { createdAt: Date; accountActiveSince: Date | null } | null = null;
  try {
    const sessionId = getAuthSessionId();
    session = sessionId
      ? await prisma.whatsAppSession.findFirst({
          where: { sessionId },
          select: { createdAt: true, accountActiveSince: true },
        })
      : await prisma.whatsAppSession.findFirst({
          select: { createdAt: true, accountActiveSince: true },
          orderBy: { createdAt: 'asc' },
        });
  } catch {
    session = null;
  }

  // No session row: nothing is linked. Fail safe — the most cautious limits, not
  // the loosest.
  const linkAgeDays = session ? daysSince(session.createdAt) : 0;

  // Evidence: the oldest message we hold. A conversation from two months ago
  // could not have happened on a number that did not exist two months ago.
  let historyAgeDays = 0;
  try {
    const oldest = await prisma.message.findFirst({
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true },
    });
    if (oldest) historyAgeDays = Math.max(0, daysSince(oldest.timestamp));
  } catch {
    historyAgeDays = 0;
  }

  const declaredAgeDays = session?.accountActiveSince ? daysSince(session.accountActiveSince) : 0;

  const ageDays = Math.max(linkAgeDays, historyAgeDays, declaredAgeDays);
  // Evidence is checked before the declaration: `accountActiveSince` is seeded
  // from message history at migration time, so when the two agree the honest
  // answer is "we observed it", not "you told us". Only a declaration that
  // reaches further back than anything on disk is genuinely a declaration.
  const basis: AccountAge['basis'] =
    historyAgeDays === ageDays && historyAgeDays > 0
      ? 'history'
      : declaredAgeDays === ageDays && declaredAgeDays > 0
        ? 'declared'
        : 'link';

  const bracket = PHASE_LIMITS.find((entry) => ageDays <= entry.untilDay);
  const { phase, baseDailyLimit } = bracket
    ? { phase: bracket.phase, baseDailyLimit: bracket.limit }
    : { phase: 'established' as const, baseDailyLimit: MATURE_DAILY_LIMIT };

  return {
    ageDays,
    phase,
    baseDailyLimit,
    linkAgeDays,
    basis,
    companionRestricted: Boolean(session) && linkAgeDays < COMPANION_WATCH_DAYS,
  };
}

function gradeFor(score: number): HealthGrade {
  if (score >= 85) return 'EXCELLENT';
  if (score >= 70) return 'GOOD';
  if (score >= 50) return 'FAIR';
  if (score >= 30) return 'AT_RISK';
  return 'CRITICAL';
}

/** Ratio helper that returns 0 rather than NaN for an empty denominator. */
function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export async function getAccountHealth(): Promise<AccountHealth> {
  const [{ window, today }, account] = await Promise.all([readWindow(WINDOW_DAYS), getAccountAge()]);

  const attempted = window.sent + window.failed;
  const failureRate = ratio(window.failed, attempted);
  const coldRatio = ratio(window.coldSent, window.sent);
  const replyRate = ratio(window.replies, window.sent);
  const optOutRate = ratio(window.optOuts, window.sent);
  const blockRate = ratio(window.hardBlocks, window.sent);

  const signals: HealthSignal[] = [];
  let score = 100;

  const penalize = (signal: Omit<HealthSignal, 'penalty'> & { penalty: number }) => {
    if (signal.penalty <= 0) return;
    score -= signal.penalty;
    signals.push(signal);
  };

  // ── 1. Cold-reachout blocks (463) ────────────────────────────────────────────
  // Not a rate — a count. Even a few of these mean WhatsApp has already started
  // time-locking this number's outbound.
  if (window.coldReachoutBlocks > 0) {
    const penalty = Math.min(55, 12 + window.coldReachoutBlocks * 3);
    penalize({
      key: 'cold_reachout_blocks',
      label: 'WhatsApp is blocking cold outreach',
      penalty,
      severity: 'danger',
      detail:
        `${window.coldReachoutBlocks} message(s) were refused with error 463 in the last ${WINDOW_DAYS} days. ` +
        'WhatsApp time-locks a number that messages people who never messaged it first. ' +
        'Pause outbound campaigns to contacts who have not written to you.',
    });
  }

  // ── 2. Recipients blocking us (403) ─────────────────────────────────────────
  if (window.hardBlocks > 0 && window.sent >= MIN_SAMPLE) {
    const penalty = Math.min(30, Math.round(blockRate * 500));
    penalize({
      key: 'hard_blocks',
      label: 'Recipients are blocking this number',
      penalty,
      severity: blockRate > 0.02 ? 'danger' : 'warn',
      detail:
        `${window.hardBlocks} recipient(s) (${(blockRate * 100).toFixed(1)}%) blocked this number. ` +
        'Blocks are the strongest input to WhatsApp\'s spam classifier.',
    });
  }

  // ── 3. Opt-outs ─────────────────────────────────────────────────────────────
  if (optOutRate > 0.01 && window.sent >= MIN_SAMPLE) {
    const penalty = Math.min(20, Math.round(optOutRate * 400));
    penalize({
      key: 'opt_outs',
      label: 'High unsubscribe rate',
      penalty,
      severity: optOutRate > 0.03 ? 'danger' : 'warn',
      detail:
        `${(optOutRate * 100).toFixed(1)}% of recipients opted out. ` +
        'Above 3% suggests the audience did not expect to hear from you.',
    });
  }

  // ── 4. Cold ratio ───────────────────────────────────────────────────────────
  if (coldRatio > 0.5 && window.sent >= MIN_SAMPLE) {
    const penalty = Math.min(25, Math.round((coldRatio - 0.5) * 50));
    penalize({
      key: 'cold_ratio',
      label: 'Mostly one-way traffic',
      penalty,
      severity: coldRatio > 0.8 ? 'danger' : 'warn',
      detail:
        `${(coldRatio * 100).toFixed(0)}% of your broadcast volume went to contacts who have never messaged you. ` +
        'A healthy business number sends mostly to people it is already talking to.',
    });
  }

  // ── 5. Failure rate ─────────────────────────────────────────────────────────
  if (failureRate > 0.05 && attempted >= MIN_SAMPLE) {
    const penalty = Math.min(20, Math.round(failureRate * 60));
    penalize({
      key: 'failure_rate',
      label: 'Elevated delivery failures',
      penalty,
      severity: failureRate > 0.2 ? 'danger' : 'warn',
      detail:
        `${(failureRate * 100).toFixed(0)}% of broadcast sends failed. ` +
        'Invalid numbers and refused sends both damage sender reputation.',
    });
  }

  // ── 6. Engagement, inverted ─────────────────────────────────────────────────
  if (window.sent >= 100 && replyRate < 0.02) {
    penalize({
      key: 'low_engagement',
      label: 'Almost nobody replies',
      penalty: 10,
      severity: 'warn',
      detail:
        `Only ${(replyRate * 100).toFixed(1)}% of recipients replied. ` +
        'Two-way conversation is what tells WhatsApp your messages are wanted.',
    });
  }

  // ── 7. Account maturity ─────────────────────────────────────────────────────
  if (account.phase !== 'established') {
    penalize({
      key: 'young_account',
      label: 'Number is still warming up',
      penalty: account.phase === 'new' ? 15 : account.phase === 'growing' ? 8 : 4,
      severity: 'info',
      detail:
        `This number shows ${account.ageDays} day(s) of WhatsApp activity` +
        (account.basis === 'link'
          ? ' (measured from when it was linked here — if it was in use before that, say so in settings and the limits lift).'
          : account.basis === 'history'
            ? ' (from the message history in this CRM).'
            : ' (as declared in settings).') +
        ' New numbers are watched closely, so volume is capped until there is a track record.',
    });
  }

  // ── 8. Freshly linked device ────────────────────────────────────────────────
  // Separate from account age on purpose. This is the 463 window: the number
  // itself may be years old and perfectly trusted, while *this link* is hours old
  // and WhatsApp is still deciding whether to let it message strangers.
  if (account.companionRestricted && account.phase === 'established') {
    penalize({
      key: 'fresh_link',
      label: 'This device link is new',
      penalty: 5,
      severity: 'info',
      detail:
        `The number is established, but it was linked to this system ${account.linkAgeDays} day(s) ago. ` +
        'WhatsApp restricts a new linked device from messaging people who have never messaged it (error 463). ' +
        'Campaigns to existing conversations are unaffected — keep cold outreach light for a few days.',
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Health scales the daily budget: a struggling account earns less headroom.
  const healthMultiplier = score >= 85 ? 1 : score >= 70 ? 0.8 : score >= 50 ? 0.55 : score >= 30 ? 0.3 : 0.1;
  const dailyLimit = Math.max(20, Math.round(account.baseDailyLimit * healthMultiplier));
  const usedToday = today.sent;
  const remainingToday = Math.max(0, dailyLimit - usedToday);

  // An hourly ceiling keeps a day's budget from being spent in ten minutes,
  // which reads as a burst even when the daily total looks reasonable.
  const hourlyLimit = Math.max(10, Math.ceil(dailyLimit / 8));

  const blocked = window.coldReachoutBlocks >= 10 || score < 20;
  const blockedReason = !blocked
    ? null
    : window.coldReachoutBlocks >= 10
      ? 'WhatsApp has repeatedly refused cold outreach from this number (error 463). Sending more campaigns now risks a permanent restriction — reply to inbound conversations for a few days first.'
      : 'Account health is critical. Broadcasting is disabled until the signals above recover.';

  // Confidence in the score, judged on how much this number has actually sent.
  // Below MIN_SAMPLE none of the ratio-based signals could fire, so a high score
  // means "no evidence", not "good".
  const confidence: HealthConfidence =
    window.sent >= MIN_SAMPLE * 4 ? 'good' : window.sent > 0 ? 'low' : 'none';

  return {
    score,
    grade: gradeFor(score),
    confidence,
    signals,
    metrics: {
      windowDays: WINDOW_DAYS,
      sent: window.sent,
      failed: window.failed,
      failureRate,
      coldSent: window.coldSent,
      coldRatio,
      hardBlocks: window.hardBlocks,
      coldReachoutBlocks: window.coldReachoutBlocks,
      replies: window.replies,
      replyRate,
      optOuts: window.optOuts,
      optOutRate,
      sentToday: usedToday,
    },
    account: {
      ageDays: account.ageDays,
      phase: account.phase,
      linkAgeDays: account.linkAgeDays,
      basis: account.basis,
      companionRestricted: account.companionRestricted,
    },
    budget: {
      dailyLimit,
      usedToday,
      remainingToday,
      maxCampaignSize: Math.max(10, remainingToday),
      hourlyLimit,
    },
    blocked,
    blockedReason,
  };
}

/**
 * Classify a transport error into the codes the health rollup and circuit
 * breaker reason about. Baileys surfaces these as message text rather than
 * structured codes, so the matching is on substrings — deliberately broad,
 * because misclassifying a 463 as "unknown" is the expensive direction.
 */
export function classifySendError(error: unknown): {
  code: string;
  fatal: boolean;
  suppress: 'NOT_ON_WHATSAPP' | 'BLOCKED_US' | null;
} {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();

  if (message.includes('463') || message.includes('cold reachout') || message.includes('restrict')) {
    return { code: 'COLD_REACHOUT_463', fatal: true, suppress: null };
  }
  if (message.includes('403') || message.includes('forbidden') || message.includes('blocked')) {
    return { code: 'BLOCKED_403', fatal: false, suppress: 'BLOCKED_US' };
  }
  if (message.includes('not available on whatsapp') || message.includes('404')) {
    return { code: 'NOT_ON_WHATSAPP', fatal: false, suppress: 'NOT_ON_WHATSAPP' };
  }
  if (message.includes('not connected') || message.includes('connection closed') || message.includes('socket')) {
    return { code: 'DISCONNECTED', fatal: true, suppress: null };
  }
  if (message.includes('warm-up') || message.includes('warmup') || message.includes('daily limit')) {
    return { code: 'QUOTA', fatal: true, suppress: null };
  }
  if (message.includes('rate') && message.includes('limit')) {
    return { code: 'RATE_LIMITED', fatal: true, suppress: null };
  }
  if (message.includes('timed out') || message.includes('timeout') || message.includes('408')) {
    return { code: 'TIMEOUT', fatal: false, suppress: null };
  }
  if (message.includes('invalid phone') || message.includes('invalid recipient')) {
    return { code: 'INVALID_PHONE', fatal: false, suppress: 'NOT_ON_WHATSAPP' };
  }
  return { code: 'UNKNOWN', fatal: false, suppress: null };
}
