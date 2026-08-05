import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { providerManager } from '../providers/manager';
import { resolveAudienceDetailed, type AudienceFilter } from './audience';
import { getAccountHealth } from './safety/account-health';
import { partitionSuppressed } from './safety/suppression';
import { scoreAudience, orderForDelivery, type ScoredRecipient } from './safety/contact-quality';
import { analyzeContent, contentFingerprint, resolveVariants } from './safety/content-analyzer';
import { assessCampaign, type PreflightReport } from './safety/risk-engine';
import type { PacingProfile } from './safety/pacing';
import type { QuietHoursWindow } from './safety/quiet-hours';

/**
 * ─── Pre-flight ──────────────────────────────────────────────────────────────
 *
 * One entry point that takes a campaign draft and answers: who would actually
 * receive this, what would it cost the account, and what should change first.
 *
 * Run twice in a campaign's life — live in the composer while the user is still
 * editing, and again at claim time, where its output is authoritative and its
 * blockers are enforced. Same code both times, so what the user was shown is
 * what the sender does.
 */

export interface PreflightInput {
  message: string;
  recipients?: string[];
  tag?: string;
  filter?: AudienceFilter | null;
  teamId?: string;
  mediaUrl?: string | null;
  interactiveContent?: object | null;
  pacingProfile?: PacingProfile;
  quietHoursEnabled?: boolean;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  /** Exclude this campaign from duplicate detection (it is the one being edited). */
  excludeBroadcastId?: string;
  /** Skip the recent-contact cooldown, e.g. for a genuine transactional notice. */
  ignoreCooldown?: boolean;
  /**
   * Drop everyone who has never messaged us. The "send to the people who have
   * written to you" remedy, resolved here rather than in the browser: the client
   * does not know which numbers are cold, and shipping a 40,000-entry list to it
   * so it can filter its own selection would be absurd.
   */
  excludeCold?: boolean;
  /** Drop anyone who already received this broadcast — the duplicate remedy. */
  excludeReceivedFrom?: string;
}

export interface PreflightResult {
  report: PreflightReport;
  /** Delivery-ordered, deliverable recipients. Consumed by the audience writer. */
  plan: ScoredRecipient[];
  /** Everyone excluded, with the reason, so the UI can explain the shortfall. */
  excluded: ScoredRecipient[];
  contentHash: string;
  variants: string[];
}

/** How far back a same-content campaign counts as a duplicate. */
const DUPLICATE_WINDOW_DAYS = Number(process.env.BROADCAST_DUPLICATE_WINDOW_DAYS ?? 14);

function quietWindow(input: PreflightInput): QuietHoursWindow {
  return {
    enabled: input.quietHoursEnabled !== false,
    start: clampHour(input.quietHoursStart, 21),
    end: clampHour(input.quietHoursEnd, 9),
  };
}

function clampHour(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(23, Math.max(0, Math.floor(value)));
}

/**
 * Find a recently-sent campaign carrying the same content, and how many of this
 * audience already received it.
 *
 * Duplicate detection matters more than it looks: the fastest path to a
 * restriction in this product was Duplicate → Send, twice, because nothing
 * anywhere checked whether those people had just been messaged.
 */
async function findDuplicate(
  contentHash: string,
  phones: string[],
  excludeBroadcastId?: string,
): Promise<{ id: string; name: string; sentAt: Date | null; overlap: number } | null> {
  if (!phones.length) return null;

  const since = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const prior = await prisma.broadcast.findFirst({
    where: {
      contentHash,
      status: { in: ['SENT', 'SENDING', 'PAUSED'] },
      createdAt: { gte: since },
      ...(excludeBroadcastId ? { id: { not: excludeBroadcastId } } : {}),
    },
    select: { id: true, name: true, sentAt: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!prior) return null;

  const overlap = await prisma.broadcastRecipient.count({
    where: { broadcastId: prior.id, phone: { in: phones }, status: 'sent' },
  });

  return { ...prior, overlap };
}

export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  const window = quietWindow(input);
  const message = input.message ?? '';

  // 1. Resolve and canonicalize the audience.
  const audience = await resolveAudienceDetailed({
    recipients: input.recipients,
    tag: input.tag,
    filter: input.filter,
    teamId: input.teamId,
  });

  // 2. Strip anyone who has opted out or is otherwise suppressed. Unconditional.
  const { allowed, suppressed } = await partitionSuppressed(audience.phones);
  const optedOutCount = Array.from(suppressed.values()).filter((hit) => hit.reason === 'OPTED_OUT').length;

  // 3. Score what remains and apply the fatigue cooldown.
  const quality = await scoreAudience(allowed, { respectCooldown: !input.ignoreCooldown });

  // 3b. User-requested exclusions, applied as skips so the report can still show
  // how many were removed and why.
  if (input.excludeCold) {
    for (const recipient of quality.recipients) {
      if (!recipient.skipReason && recipient.isCold) recipient.skipReason = 'COLD_EXCLUDED';
    }
  }
  if (input.excludeReceivedFrom) {
    const alreadySent = await prisma.broadcastRecipient.findMany({
      where: { broadcastId: input.excludeReceivedFrom, status: 'sent', phone: { in: allowed } },
      select: { phone: true },
    });
    const received = new Set(alreadySent.map((row) => row.phone));
    for (const recipient of quality.recipients) {
      if (!recipient.skipReason && received.has(recipient.phone)) recipient.skipReason = 'ALREADY_RECEIVED';
    }
  }

  // Re-derive the aggregates the exclusions just invalidated. Recomputing beats
  // threading the flags into scoreAudience: it keeps the scorer's only job
  // "score contacts", and the exclusions are policy, not quality.
  if (input.excludeCold || input.excludeReceivedFrom) {
    const remaining = quality.recipients.filter((recipient) => !recipient.skipReason);
    quality.deliverable = remaining.length;
    quality.skipped = quality.recipients.filter((recipient) => recipient.skipReason);
    quality.counts = { HOT: 0, WARM: 0, COOL: 0, COLD: 0 };
    for (const recipient of remaining) quality.counts[recipient.tier] += 1;
    const coldCount = remaining.filter((recipient) => recipient.isCold).length;
    quality.coldRatio = remaining.length ? coldCount / remaining.length : 0;
    quality.averageScore = remaining.length
      ? Math.round(remaining.reduce((sum, recipient) => sum + recipient.score, 0) / remaining.length)
      : 0;
    quality.unknownContacts = remaining.filter((recipient) => !recipient.contactId).length;
  }

  // 4. Content.
  const contentHash = contentFingerprint({
    message,
    mediaUrl: input.mediaUrl,
    interactiveContent: input.interactiveContent,
  });
  const variants = resolveVariants(message);
  const content = analyzeContent(message, {
    hasMedia: Boolean(input.mediaUrl),
    isInteractive: Boolean(input.interactiveContent),
    audienceSize: quality.deliverable,
  });

  // 5. Health and duplicate check, in parallel — neither depends on the other.
  const [health, duplicateOf] = await Promise.all([
    getAccountHealth(),
    findDuplicate(contentHash, allowed, input.excludeBroadcastId),
  ]);

  const deliverable = quality.recipients.filter((recipient) => !recipient.skipReason);

  const report = assessCampaign({
    health,
    quality,
    content,
    requested: audience.requested,
    suppressedCount: suppressed.size,
    optedOutCount,
    invalidCount: audience.invalid.length,
    duplicateCount: audience.duplicates,
    // Zone breakdown describes who actually receives the campaign, not who was
    // originally selected.
    phones: deliverable.map((recipient) => recipient.phone),
    averageMessageLength: message.length || 120,
    quietHours: window,
    requestedProfile: input.pacingProfile,
    duplicateOf,
    isInteractive: Boolean(input.interactiveContent),
  });

  // Suppressed numbers were removed before scoring, so re-attach them as
  // excluded rows — the UI has to be able to say *why* 2,000 became 1,740.
  const suppressedRows: ScoredRecipient[] = Array.from(suppressed.values()).map((hit) => ({
    phone: hit.phone,
    contactId: null,
    name: null,
    tier: 'COLD',
    score: 0,
    isCold: true,
    daysSinceInbound: null,
    daysSinceLastBroadcast: null,
    skipReason: hit.reason === 'OPTED_OUT' ? 'OPTED_OUT' : 'SUPPRESSED',
  }));

  const invalidRows: ScoredRecipient[] = audience.invalid.map((phone) => ({
    phone,
    contactId: null,
    name: null,
    tier: 'COLD',
    score: 0,
    isCold: true,
    daysSinceInbound: null,
    daysSinceLastBroadcast: null,
    skipReason: 'INVALID_PHONE',
  }));

  return {
    report,
    plan: orderForDelivery(deliverable),
    excluded: [...suppressedRows, ...quality.skipped, ...invalidRows],
    contentHash,
    variants,
  };
}

/**
 * Re-check just the account-level gates immediately before a claimed run starts.
 *
 * A campaign scheduled on Monday for Friday was assessed against Monday's health.
 * If the number picked up three 463s on Wednesday, Friday's send must not happen
 * on Monday's verdict — this is the cheap re-read that catches that, without
 * re-resolving a 50,000-row audience.
 */
export type AccountGateCode = 'NOT_CONNECTED' | 'CONNECTING' | 'ACCOUNT_BLOCKED' | 'DAILY_BUDGET';

export interface AccountGate {
  ok: boolean;
  reason: string | null;
  /** Machine-readable, so the caller can decide between refuse, park and retry. */
  code: AccountGateCode | null;
}

export async function verifyAccountGate(): Promise<AccountGate> {
  // ── Is there a line to send on at all? ─────────────────────────────────────
  //
  // Checked first, and outside the try: nothing below it matters without a
  // connection, and it is the one gate that must never fail open.
  //
  // Without this a campaign starts happily while WhatsApp is offline, every
  // recipient throws "WhatsApp is not connected" from the sender, and the run
  // reports N failures for messages WhatsApp never even saw. Read through the
  // provider rather than the Baileys client directly so the Meta path answers
  // for itself.
  const providerStatus = providerManager.getStatus().status;
  if (providerStatus !== 'connected') {
    return providerStatus === 'connecting'
      ? {
          ok: false,
          code: 'CONNECTING',
          reason: 'WhatsApp is still connecting. Sending will start on its own once the number is linked.',
        }
      : {
          ok: false,
          code: 'NOT_CONNECTED',
          reason: 'No WhatsApp number is connected, so there is nothing to send from. Connect a number first.',
        };
  }

  try {
    const health = await getAccountHealth();
    if (health.blocked) {
      return { ok: false, code: 'ACCOUNT_BLOCKED', reason: health.blockedReason };
    }
    if (health.budget.remainingToday <= 0) {
      return {
        ok: false,
        code: 'DAILY_BUDGET',
        reason:
          `This number has already sent its safe daily volume (${health.budget.usedToday}/${health.budget.dailyLimit}). ` +
          'The campaign will continue automatically tomorrow.',
      };
    }
    return { ok: true, reason: null, code: null };
  } catch (error) {
    // Never block a send because the health check itself broke.
    logger.warn('broadcast.health_gate_unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: true, reason: null, code: null };
  }
}
