import { prisma } from '../lib/prisma';
import { getTenantContext } from '../lib/tenant-context';
import { HttpError } from '../auth/authorize';
import { toStorageRef, resolveMediaUrl } from '../lib/media';
import { instantToWallClock, isValidTimeZone, resolveScheduledInstant } from '../lib/timezone';
import { logger } from '../lib/logger';
import { ensureBroadcastWorker } from './broadcast.queue';
import { claimAndEnqueue } from './broadcast.scheduler';
import { type AudienceFilter } from './audience';
import { runPreflight, verifyAccountGate, type PreflightResult } from './preflight.service';
import { getAccountHealth } from './safety/account-health';
import { PACING_PROFILES, type PacingProfile } from './safety/pacing';
import { type ScoredRecipient } from './safety/contact-quality';

ensureBroadcastWorker();

/**
 * A schedule must land in the future, but a request that took a second to reach
 * us shouldn't be rejected for a time the user picked as "now". Anything up to a
 * minute in the past is treated as immediate.
 */
const PAST_GRACE_MS = 60_000;
/** Guards against a fat-fingered year ("2206") parking a campaign forever. */
const MAX_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

/** Statuses from which a broadcast's content may still be edited. */
const EDITABLE_STATUSES = ['DRAFT', 'SCHEDULED', 'FAILED'] as const;

/**
 * `recipientCount` must mean "how many messages this campaign will send", not
 * "how many rows we wrote". Excluded recipients — opted out, on cooldown, invalid
 * — are stored so the report can explain the shortfall, but counting them would
 * make every progress bar under-report: a campaign that reached all 1,740 of its
 * deliverable audience would sit at 87% of 2,000 forever, looking stuck.
 */
const DELIVERABLE_RECIPIENTS = { where: { status: { not: 'skipped' } } } as const;

export interface BroadcastInput {
  name: string;
  message: string;
  recipients?: string[];
  tag?: string;
  filter?: AudienceFilter | null;
  /** Preferred: the wall clock the user picked, plus the zone they picked it in. */
  scheduledAtLocal?: string | null;
  timezone?: string | null;
  /** Legacy/API: an absolute instant. Ignored when `scheduledAtLocal` is present. */
  scheduledAt?: string | Date | null;
  teamId?: string;
  interactiveContent?: object;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaFilename?: string | null;
  mediaMimeType?: string | null;
  /**
   * @deprecated Accepted for API compatibility and ignored.
   *
   * Batching is now derived from account health by the pre-flight recommendation
   * (see `smartColumns`). Silently honouring a caller's hand-picked numbers would
   * reintroduce the exact conflict this replaced — two pacing systems disagreeing,
   * with the less-informed one winning.
   */
  smartSending?: boolean;
  batchSize?: number | null;
  batchIntervalMinutes?: number | null;
  // ── Deliverability controls ─────────────────────────────────────────────────
  /** CAREFUL | BALANCED | STEADY. Clamped to what account health allows. */
  pacingProfile?: PacingProfile | null;
  quietHoursEnabled?: boolean | null;
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  /** Deliver this many first, then hold for a health check. */
  pilotSize?: number | null;
  /** Skip the recent-contact cooldown. Requires a stated reason in the UI. */
  ignoreCooldown?: boolean;
  /** Drop everyone who has never messaged us (the "send to warm contacts" fix). */
  excludeCold?: boolean;
  /** Drop anyone who already received the named broadcast (the duplicate fix). */
  excludeReceivedFrom?: string | null;
}

/** Keep user-supplied batch numbers inside sane bounds. */
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 5_000;
const MIN_BATCH_INTERVAL = 1;
const MAX_BATCH_INTERVAL = 1_440; // 24h
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_BATCH_INTERVAL = 30;

/**
 * Build the recipient rows for a nested `create`, tenant stamp included.
 *
 * The tenant guard in lib/prisma.ts only stamps the TOP-LEVEL `data` of a
 * create — a nested `recipients: { create: [...] }` slips past it, and the child
 * rows land with `tenantId: null`. Every later guarded query then injects
 * `where: { tenantId }` and silently matches none of them, which meant:
 *
 *   • the worker's per-recipient `sent`/`failed` markers were never persisted
 *     (so a resumed run would message everyone a second time), and
 *   • `deleteBroadcast`'s `deleteMany` removed nothing, so deleting ANY campaign
 *     died on the recipient foreign key.
 *
 * Stamping the children here is what keeps them reachable. Null under platform
 * scope, which matches the parent broadcast and is what the guard expects.
 *
 * Rows carry their delivery position, tier and message variant, all decided once
 * at audience-build time. The worker then reads the next N pending rows in
 * `sortOrder` and needs no knowledge of how the ordering was reached.
 */
function recipientRows(plan: ScoredRecipient[], variantCount: number) {
  const tenantId = getTenantContext()?.tenantId ?? null;
  return plan.map((recipient, index) => ({
    tenantId,
    phone: recipient.phone,
    contactId: recipient.contactId,
    tier: recipient.tier,
    sortOrder: index,
    // Round-robin across variants. Interleaving rather than blocking means any
    // slice of the campaign — including a pilot — contains a mix of wordings,
    // which is the entire point of having them.
    variantIndex: variantCount > 1 ? index % variantCount : 0,
    status: 'pending',
  }));
}

/**
 * Rows for everyone who was excluded, written as `skipped` with the reason.
 *
 * Recording exclusions rather than dropping them is what lets the campaign
 * report say "2,000 selected → 1,740 delivered, 190 opted out, 70 already
 * messaged this week". Silently sending to fewer people than the user chose,
 * with no explanation, is how a safety feature gets mistaken for a bug and
 * worked around.
 */
function skippedRows(excluded: ScoredRecipient[]) {
  const tenantId = getTenantContext()?.tenantId ?? null;
  return excluded.map((recipient) => ({
    tenantId,
    phone: recipient.phone,
    contactId: recipient.contactId,
    tier: recipient.tier,
    sortOrder: 1_000_000,
    variantIndex: 0,
    status: 'skipped',
    skipReason: recipient.skipReason,
  }));
}

/** Columns derived from a pre-flight run. */
function safetyColumns(preflight: PreflightResult) {
  const { report } = preflight;
  return {
    riskScore: report.riskScore,
    riskLevel: report.riskLevel,
    preflight: report as unknown as object,
    contentHash: preflight.contentHash,
    variants: preflight.variants as unknown as object,
    pacingProfile: report.recommended.pacingProfile,
    throttlePerHour: report.recommended.throttlePerHour,
  };
}

function clampHour(value: number | null | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(23, Math.max(0, Math.floor(value)));
}

function requestedProfile(input: BroadcastInput): PacingProfile | undefined {
  const value = input.pacingProfile;
  return value && (PACING_PROFILES as string[]).includes(value) ? (value as PacingProfile) : undefined;
}

/** Run pre-flight for a create/update request. */
async function preflightFor(input: BroadcastInput, excludeBroadcastId?: string): Promise<PreflightResult> {
  return runPreflight({
    message: input.message ?? '',
    recipients: input.recipients,
    tag: input.tag,
    filter: input.filter,
    teamId: input.teamId,
    mediaUrl: input.mediaUrl,
    interactiveContent: input.interactiveContent ?? null,
    pacingProfile: requestedProfile(input),
    quietHoursEnabled: input.quietHoursEnabled !== false,
    quietHoursStart: clampHour(input.quietHoursStart, 21),
    quietHoursEnd: clampHour(input.quietHoursEnd, 9),
    excludeBroadcastId,
    ignoreCooldown: input.ignoreCooldown === true,
    excludeCold: input.excludeCold === true,
    excludeReceivedFrom: input.excludeReceivedFrom ?? undefined,
  });
}

/**
 * Columns for the delivery-safety controls the user set. Pilot size is clamped
 * to the audience so a "pilot of 100" on an 80-person campaign doesn't leave the
 * run permanently short of its own hold point.
 */
function deliveryColumns(input: BroadcastInput, deliverable: number) {
  const pilot = input.pilotSize != null ? Math.floor(Number(input.pilotSize)) : null;
  return {
    quietHoursEnabled: input.quietHoursEnabled !== false,
    quietHoursStart: clampHour(input.quietHoursStart, 21),
    quietHoursEnd: clampHour(input.quietHoursEnd, 9),
    pilotSize: pilot && pilot > 0 && pilot < deliverable ? pilot : null,
    pilotCompletedAt: null,
  };
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Resolve the batching columns — now derived, not dictated.
 *
 * These used to be two numbers the user typed on the Delivery step: "send N
 * contacts, wait M minutes". That was the only pacing control the module had, so
 * it made sense at the time. It does not any more, and keeping it was actively
 * harmful for three reasons:
 *
 *   • It competed with the safety engine. Both controlled pacing, in different
 *     units, on different steps, and the hand-typed interval overrode the
 *     health-derived one — letting a campaign burn its whole hourly allowance in
 *     a burst and then idle, which is precisely the spiky shape the pacer exists
 *     to avoid.
 *   • It was worse-informed. The risk engine computes batch size from the
 *     account's real daily budget and health; a typed number is a guess.
 *   • It gave false assurance. Someone setting "5000 every 1 minute" believed
 *     they had configured safe sending. They had configured nothing of the sort,
 *     and the thing actually protecting them was the engine their setting was
 *     fighting.
 *
 * The columns stay — they are still the mechanism the worker runs on — but the
 * values come from the pre-flight recommendation. `nextBatchAt` remains owned by
 * the worker, which sets it after a batch finishes and there is more to send.
 */
function smartColumns(preflight: PreflightResult) {
  const { recommended } = preflight.report;
  if (!recommended.smartSending) {
    return { smartSending: false, batchSize: null, batchIntervalMinutes: null, nextBatchAt: null };
  }
  return {
    smartSending: true,
    batchSize: clampInt(recommended.batchSize, MIN_BATCH_SIZE, MAX_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    batchIntervalMinutes: clampInt(
      recommended.batchIntervalMinutes,
      MIN_BATCH_INTERVAL, MAX_BATCH_INTERVAL, DEFAULT_BATCH_INTERVAL,
    ),
    nextBatchAt: null,
  };
}

/**
 * Turn the schedule half of a request into columns, or throw something the user
 * can act on. Returns `null` for an immediate (unscheduled) broadcast.
 */
function resolveSchedule(input: BroadcastInput): { scheduledAt: Date; timezone: string } | null {
  const timezone = input.timezone?.trim() || 'UTC';
  if (!isValidTimeZone(timezone)) {
    throw new HttpError(400, `Unknown time zone "${timezone}".`);
  }

  let resolved: { instant: Date; timezone: string } | null;
  try {
    resolved = resolveScheduledInstant(input);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Invalid schedule.');
  }
  if (!resolved) return null;

  const { instant } = resolved;
  const now = Date.now();

  if (instant.getTime() < now - PAST_GRACE_MS) {
    throw new HttpError(
      400,
      `That time has already passed (${instantToWallClock(instant, timezone)} in ${timezone}). Pick a future time or send now.`,
    );
  }
  if (instant.getTime() > now + MAX_HORIZON_MS) {
    throw new HttpError(400, 'A broadcast cannot be scheduled more than a year ahead.');
  }

  return { scheduledAt: instant, timezone };
}

interface SerializableBroadcast {
  scheduledAt: Date | null;
  timezone: string;
  mediaUrl: string | null;
  recipients?: Array<unknown>;
  _count?: { recipients: number };
}

/**
 * Shape a broadcast for the wire. `scheduledAtLocal` is the exact wall clock the
 * user chose — the UI binds it straight into its `datetime-local` input and never
 * converts, which is what keeps the displayed time equal to the stored one.
 * Media refs are expanded from storage-relative to loadable URLs here and nowhere else.
 *
 * `recipientCount` is flattened out of Prisma's `_count` so the list view can show
 * delivery progress without fetching every recipient row of every campaign.
 */
export function serializeBroadcast<T extends SerializableBroadcast>(broadcast: T) {
  const { _count, ...rest } = broadcast;
  return {
    ...rest,
    mediaUrl: resolveMediaUrl(broadcast.mediaUrl),
    scheduledAtLocal: broadcast.scheduledAt ? instantToWallClock(broadcast.scheduledAt, broadcast.timezone) : null,
    recipientCount: _count?.recipients ?? broadcast.recipients?.length ?? 0,
  };
}

function mediaColumns(input: BroadcastInput) {
  return {
    mediaUrl: toStorageRef(input.mediaUrl),
    mediaType: input.mediaType ?? null,
    mediaFilename: input.mediaFilename ?? null,
    mediaMimeType: input.mediaMimeType ?? null,
  };
}

export class BroadcastsService {
  static async getBroadcasts(teamId?: string) {
    const broadcasts = await prisma.broadcast.findMany({
      where: teamId ? { teamId } : undefined,
      orderBy: { createdAt: 'desc' },
      // Count only — pulling every recipient row for every campaign would move
      // hundreds of thousands of rows to render one progress bar each.
      include: { _count: { select: { recipients: DELIVERABLE_RECIPIENTS } } },
    });
    return broadcasts.map(serializeBroadcast);
  }

  /**
   * `includeRecipients` hauls every recipient row back with the broadcast. The
   * edit form needs them (it re-populates the audience picker); nothing else
   * does, and a 50k-recipient campaign turns an innocent status refresh into a
   * multi-megabyte response. Callers that only need the summary opt out and get
   * `recipientCount` from a `COUNT(*)` instead.
   */
  static async getBroadcastById(
    id: string,
    teamId?: string,
    { includeRecipients = true }: { includeRecipients?: boolean } = {},
  ) {
    const broadcast = await prisma.broadcast.findFirst({
      where: teamId ? { id, teamId } : { id },
      include: includeRecipients
        ? { recipients: true }
        : { _count: { select: { recipients: DELIVERABLE_RECIPIENTS } } },
    });

    if (!broadcast) throw new HttpError(404, 'Broadcast not found');

    return serializeBroadcast(broadcast);
  }

  /**
   * A page of the audience, plus a tally of every status across the whole
   * broadcast — not just the page — so the detail view can show
   * "12 sent · 3 failed · 5 pending" while displaying twenty rows.
   */
  static async getRecipients(
    id: string,
    {
      teamId,
      status,
      search,
      page = 1,
      pageSize = 25,
    }: { teamId?: string; status?: string; search?: string; page?: number; pageSize?: number },
  ) {
    const broadcast = await prisma.broadcast.findFirst({
      where: teamId ? { id, teamId } : { id },
      select: { id: true },
    });
    if (!broadcast) throw new HttpError(404, 'Broadcast not found');

    const where = {
      broadcastId: id,
      ...(status ? { status } : {}),
      ...(search ? { phone: { contains: search } } : {}),
    };

    const [rows, total, grouped] = await Promise.all([
      prisma.broadcastRecipient.findMany({
        where,
        select: {
          id: true,
          phone: true,
          status: true,
          tier: true,
          skipReason: true,
          errorCode: true,
          lastError: true,
          sentAt: true,
          repliedAt: true,
        },
        // Delivery order, not alphabetical: the list reads as the campaign ran.
        orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.broadcastRecipient.count({ where }),
      prisma.broadcastRecipient.groupBy({
        by: ['status'],
        where: { broadcastId: id },
        _count: { _all: true },
      }),
    ]);

    const counts = { pending: 0, sent: 0, failed: 0, skipped: 0, total: 0 };
    for (const group of grouped) {
      const bucket = group.status as keyof typeof counts;
      const n = group._count._all;
      if (bucket in counts && bucket !== 'total') counts[bucket] = n;
      counts.total += n;
    }

    return { rows, total, page, pageSize, counts };
  }

  /**
   * Analyse a campaign draft without saving it.
   *
   * The composer calls this while the user types, so the report they act on is
   * produced by exactly the same code that will gate the send.
   */
  static async preflight(input: BroadcastInput, excludeBroadcastId?: string) {
    const result = await preflightFor(input, excludeBroadcastId);
    return result.report;
  }

  /** Account-level health, independent of any one campaign. */
  static async getHealth() {
    return getAccountHealth();
  }

  static async createBroadcast(input: BroadcastInput) {
    const schedule = resolveSchedule(input);
    const preflight = await preflightFor(input);
    const { report, plan, excluded } = preflight;

    if (!plan.length) {
      throw new HttpError(
        400,
        report.audience.requested > 0
          ? 'None of the selected contacts can be messaged: they have opted out, are suppressed, were messaged too recently, or their numbers are not valid.'
          : 'At least one recipient, tag, or filter is required',
      );
    }

    const broadcast = await prisma.broadcast.create({
      data: {
        teamId: input.teamId,
        name: input.name,
        message: input.message,
        interactiveContent: input.interactiveContent ?? undefined,
        ...mediaColumns(input),
        ...smartColumns(preflight),
        ...safetyColumns(preflight),
        ...deliveryColumns(input, plan.length),
        status: schedule ? 'SCHEDULED' : 'DRAFT',
        type: schedule ? 'SCHEDULED' : 'IMMEDIATE',
        scheduledAt: schedule?.scheduledAt ?? null,
        timezone: schedule?.timezone ?? input.timezone?.trim() ?? 'UTC',
        description: input.tag ? `Tag: ${input.tag}` : null,
        recipients: {
          create: [...recipientRows(plan, preflight.variants.length), ...skippedRows(excluded)],
        },
      },
      // Without this the response would claim `recipientCount: 0` for a
      // broadcast that just had its whole audience written.
      include: { _count: { select: { recipients: DELIVERABLE_RECIPIENTS } } },
    });

    return { ...serializeBroadcast(broadcast), preflight: report };
  }

  static async updateBroadcast(id: string, input: BroadcastInput) {
    const existing = await prisma.broadcast.findFirst({
      where: input.teamId ? { id, teamId: input.teamId } : { id },
    });
    if (!existing) throw new HttpError(404, 'Broadcast not found');

    // Rewriting recipients of a run in flight would drop the per-recipient `sent`
    // markers the worker relies on to avoid double-sending.
    if (!(EDITABLE_STATUSES as readonly string[]).includes(existing.status)) {
      throw new HttpError(
        409,
        `A broadcast that is ${existing.status.toLowerCase()} can no longer be edited. Duplicate it instead.`,
      );
    }

    const schedule = resolveSchedule(input);
    const preflight = await preflightFor(input, id);
    const { report, plan, excluded } = preflight;

    if (!plan.length) {
      throw new HttpError(
        400,
        report.audience.requested > 0
          ? 'None of the selected contacts can be messaged: they have opted out, are suppressed, were messaged too recently, or their numbers are not valid.'
          : 'At least one recipient, tag, or filter is required',
      );
    }

    const broadcast = await prisma.broadcast.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        message: input.message,
        interactiveContent: input.interactiveContent ?? undefined,
        ...mediaColumns(input),
        ...smartColumns(preflight),
        ...safetyColumns(preflight),
        ...deliveryColumns(input, plan.length),
        status: schedule ? 'SCHEDULED' : 'DRAFT',
        type: schedule ? 'SCHEDULED' : 'IMMEDIATE',
        scheduledAt: schedule?.scheduledAt ?? null,
        timezone: schedule?.timezone ?? input.timezone?.trim() ?? 'UTC',
        description: input.tag ? `Tag: ${input.tag}` : null,
        lastError: null,
        // Editing invalidates any prior review, and clears an auto-pause: the
        // campaign that was stopped is not the campaign being saved.
        reviewedAt: null,
        healthPausedAt: null,
        healthPauseReason: null,
        // The audience is rewritten below, so any leftover batch cursor from a
        // prior run must reset too — otherwise the fresh send would think it was
        // mid-way through the old, now-deleted recipient set.
        queuedAt: null,
        nextBatchAt: null,
        recipients: {
          deleteMany: {},
          create: [...recipientRows(plan, preflight.variants.length), ...skippedRows(excluded)],
        },
      },
      include: { _count: { select: { recipients: DELIVERABLE_RECIPIENTS } } },
    });

    return { ...serializeBroadcast(broadcast), preflight: report };
  }

  /**
   * Send right now, regardless of any schedule that was set.
   *
   * The pre-flight gate runs here rather than only in the composer, because the
   * composer is not the only way to reach this: the API, a duplicated campaign,
   * and a retry of a failed one all land on the same door. A blocker found here
   * is refused with the reason; warnings are not — the user has seen those and
   * chosen to proceed, and a system that argues with a decision it already
   * presented is one people learn to click through.
   */
  static async sendBroadcast(id: string, teamId?: string, options: { acknowledged?: boolean } = {}) {
    const broadcast = await prisma.broadcast.findFirst({
      where: teamId ? { id, teamId } : { id },
    });
    if (!broadcast) throw new HttpError(404, 'Broadcast not found');

    if (broadcast.status === 'SENDING') throw new HttpError(409, 'This broadcast is already sending.');
    if (broadcast.status === 'SENT') throw new HttpError(409, 'This broadcast has already been sent.');

    const gate = await verifyAccountGate();
    if (!gate.ok) {
      throw new HttpError(
        409,
        gate.reason ?? 'Sending is currently disabled for this number.',
        gate.code ?? undefined,
      );
    }

    // A stored CRITICAL verdict must be acknowledged explicitly. This is the one
    // point of friction in the flow, and it is deliberate: it is also the only
    // place where the cost of being wrong is an account.
    if (broadcast.riskLevel === 'CRITICAL' && !options.acknowledged && !broadcast.reviewedAt) {
      throw new HttpError(
        428,
        'This campaign was rated CRITICAL risk. Open the safety report and confirm before sending.',
      );
    }

    // The same compare-and-swap the scheduler uses, so a manual Send racing the
    // scheduled fire time can only produce one run.
    const claimed = await claimAndEnqueue(id, ['DRAFT', 'SCHEDULED', 'FAILED', 'PAUSED']);
    if (!claimed) throw new HttpError(409, 'This broadcast was just started by someone else.');

    if (options.acknowledged) {
      await prisma.broadcast
        .updateMany({ where: { id }, data: { reviewedAt: new Date() } })
        .catch(() => {});
    }

    return this.getBroadcastById(id, teamId, { includeRecipients: false });
  }

  /**
   * Re-run pre-flight against a saved campaign and store the result.
   *
   * Used by the detail view: a campaign drafted last week is assessed against
   * this week's account health, not the health it was created under.
   */
  static async refreshPreflight(id: string, teamId?: string) {
    const broadcast = await prisma.broadcast.findFirst({
      where: teamId ? { id, teamId } : { id },
      include: { recipients: { where: { status: { not: 'skipped' } }, select: { phone: true } } },
    });
    if (!broadcast) throw new HttpError(404, 'Broadcast not found');

    const preflight = await runPreflight({
      message: broadcast.message,
      recipients: broadcast.recipients.map((recipient) => recipient.phone),
      teamId: broadcast.teamId ?? undefined,
      mediaUrl: broadcast.mediaUrl,
      interactiveContent: (broadcast.interactiveContent ?? null) as object | null,
      pacingProfile: broadcast.pacingProfile as PacingProfile,
      quietHoursEnabled: broadcast.quietHoursEnabled,
      quietHoursStart: broadcast.quietHoursStart,
      quietHoursEnd: broadcast.quietHoursEnd,
      excludeBroadcastId: id,
      // Recipients already committed to this campaign are not re-cooldowned
      // against their own campaign.
      ignoreCooldown: true,
    });

    await prisma.broadcast.updateMany({
      where: { id },
      data: {
        riskScore: preflight.report.riskScore,
        riskLevel: preflight.report.riskLevel,
        preflight: preflight.report as unknown as object,
      },
    });

    return preflight.report;
  }

  /** Record that the user has read and accepted the safety report. */
  static async acknowledgeReview(id: string, teamId?: string) {
    const updated = await prisma.broadcast.updateMany({
      where: { ...(teamId ? { teamId } : {}), id },
      data: { reviewedAt: new Date() },
    });
    if (updated.count !== 1) throw new HttpError(404, 'Broadcast not found');
    return this.getBroadcastById(id, teamId, { includeRecipients: false });
  }

  /**
   * Copy a broadcast, including its audience and attachment.
   *
   * The copy always lands as an unscheduled DRAFT. Inheriting the original's
   * `scheduledAt` would either fire the duplicate immediately (the time has
   * already passed) or silently queue a second blast at the same moment — both
   * of which are ways to message a customer twice by accident.
   */
  static async duplicateBroadcast(id: string, teamId?: string) {
    const source = await prisma.broadcast.findFirst({
      where: teamId ? { id, teamId } : { id },
      include: { recipients: { where: { status: { not: 'skipped' } }, select: { phone: true } } },
    });
    if (!source) throw new HttpError(404, 'Broadcast not found');

    // The copy is re-assessed from scratch rather than inheriting the original's
    // verdict. Duplicate-then-send was the single easiest way to message the same
    // people the same thing twice in an afternoon; now the copy's own pre-flight
    // sees the original as a duplicate campaign and says so, and anyone still in
    // the contact cooldown is filtered out before the audience is written.
    const preflight = await runPreflight({
      message: source.message,
      recipients: source.recipients.map((recipient) => recipient.phone),
      teamId: source.teamId ?? undefined,
      mediaUrl: source.mediaUrl,
      interactiveContent: (source.interactiveContent ?? null) as object | null,
      pacingProfile: source.pacingProfile as PacingProfile,
      quietHoursEnabled: source.quietHoursEnabled,
      quietHoursStart: source.quietHoursStart,
      quietHoursEnd: source.quietHoursEnd,
      excludeBroadcastId: id,
    });

    const copy = await prisma.broadcast.create({
      data: {
        teamId: source.teamId,
        name: `${source.name} (copy)`,
        description: source.description,
        message: source.message,
        interactiveContent: (source.interactiveContent ?? undefined) as any,
        mediaUrl: source.mediaUrl,
        mediaType: source.mediaType,
        mediaFilename: source.mediaFilename,
        mediaMimeType: source.mediaMimeType,
        smartSending: source.smartSending,
        batchSize: source.batchSize,
        batchIntervalMinutes: source.batchIntervalMinutes,
        quietHoursEnabled: source.quietHoursEnabled,
        quietHoursStart: source.quietHoursStart,
        quietHoursEnd: source.quietHoursEnd,
        ...safetyColumns(preflight),
        status: 'DRAFT',
        type: 'IMMEDIATE',
        scheduledAt: null,
        timezone: source.timezone,
        recipients: {
          create: [
            ...recipientRows(preflight.plan, preflight.variants.length),
            ...skippedRows(preflight.excluded),
          ],
        },
      },
      include: { _count: { select: { recipients: DELIVERABLE_RECIPIENTS } } },
    });

    return { ...serializeBroadcast(copy), preflight: preflight.report };
  }

  /** Return a scheduled broadcast to draft without sending it. */
  static async cancelSchedule(id: string, teamId?: string) {
    const updated = await prisma.broadcast.updateMany({
      where: { ...(teamId ? { teamId } : {}), id, status: 'SCHEDULED' },
      data: { status: 'DRAFT', type: 'IMMEDIATE', scheduledAt: null, queuedAt: null },
    });
    if (updated.count !== 1) throw new HttpError(409, 'Only a scheduled broadcast can be unscheduled.');
    return this.getBroadcastById(id, teamId, { includeRecipients: false });
  }

  static async pauseBroadcast(id: string, teamId?: string) {
    const broadcast = await prisma.broadcast.findFirst({
      where: teamId ? { id, teamId } : { id },
    });
    if (!broadcast) throw new HttpError(404, 'Broadcast not found');
    if (broadcast.status !== 'SENDING') throw new HttpError(409, 'Broadcast is not currently sending');
    // Clearing `nextBatchAt` takes the campaign out of the scheduler's due-batch
    // poll, so a smart send paused *between* batches stays paused. Resume re-queues
    // the next batch immediately (nextBatchAt stays null until that batch finishes).
    await prisma.broadcast.update({ where: { id: broadcast.id }, data: { status: 'PAUSED', nextBatchAt: null } });
    return this.getBroadcastById(id, teamId, { includeRecipients: false });
  }

  /**
   * Stop a running or paused campaign for good. Already-sent messages stay sent;
   * no further batches go out. Unlike delete, the record and its per-recipient
   * outcomes are kept, so the user can still see who was reached before the stop.
   */
  static async cancelBroadcast(id: string, teamId?: string) {
    const broadcast = await prisma.broadcast.findFirst({
      where: teamId ? { id, teamId } : { id },
      select: { id: true, status: true },
    });
    if (!broadcast) throw new HttpError(404, 'Broadcast not found');
    if (broadcast.status !== 'SENDING' && broadcast.status !== 'PAUSED') {
      throw new HttpError(409, 'Only a sending or paused broadcast can be cancelled.');
    }
    // Guarded update: if a batch worker flips the row to SENT/FAILED in the same
    // instant, this no-ops and we report the real terminal state instead.
    await prisma.broadcast.updateMany({
      where: { id: broadcast.id, status: { in: ['SENDING', 'PAUSED'] } },
      data: { status: 'CANCELLED', nextBatchAt: null, queuedAt: null },
    });
    return this.getBroadcastById(id, teamId, { includeRecipients: false });
  }

  /**
   * Resume a paused campaign.
   *
   * A campaign the *machine* paused is treated differently from one a person
   * paused. If the circuit breaker stopped a run because WhatsApp was refusing
   * messages, resuming it thirty seconds later is the worst possible thing to
   * do — so the account gate is re-checked, and a still-unhealthy account
   * refuses the resume with the reason rather than quietly restarting the run
   * that caused the problem.
   */
  static async resumeBroadcast(id: string, teamId?: string, options: { acknowledged?: boolean } = {}) {
    const broadcast = await prisma.broadcast.findFirst({
      where: teamId ? { id, teamId } : { id },
      select: { id: true, status: true, healthPausedAt: true, healthPauseReason: true, pilotCompletedAt: true },
    });
    if (!broadcast) throw new HttpError(404, 'Broadcast not found');
    if (broadcast.status !== 'PAUSED') throw new HttpError(409, 'Broadcast is not paused');

    const autoPaused = Boolean(broadcast.healthPausedAt) && !broadcast.pilotCompletedAt;
    if (autoPaused) {
      const gate = await verifyAccountGate();
      if (!gate.ok) {
        // A missing connection is not "the same reason" the breaker paused this
        // run — saying so would blame the account for the user's socket.
        const connectionIssue = gate.code === 'NOT_CONNECTED' || gate.code === 'CONNECTING';
        throw new HttpError(
          409,
          connectionIssue
            ? gate.reason!
            : `${gate.reason} This campaign was paused automatically for the same reason — resuming now would repeat it.`,
          gate.code ?? undefined,
        );
      }
      if (!options.acknowledged) {
        throw new HttpError(
          428,
          broadcast.healthPauseReason ??
            'This campaign was paused automatically to protect the WhatsApp number. Review the reason before resuming.',
        );
      }
    }

    // Re-queue — the worker skips recipients already marked sent.
    const claimed = await claimAndEnqueue(id, ['PAUSED']);
    if (!claimed) throw new HttpError(409, 'Broadcast is no longer paused.');

    await prisma.broadcast
      .updateMany({
        where: { id },
        data: { healthPausedAt: null, healthPauseReason: null },
      })
      .catch(() => {});

    logger.info('broadcast.resumed', { broadcastId: id, wasAutoPaused: autoPaused });
    return this.getBroadcastById(id, teamId, { includeRecipients: false });
  }

  static async deleteBroadcast(id: string, teamId?: string) {
    const broadcast = await prisma.broadcast.findFirst({
      where: teamId ? { id, teamId } : { id },
      select: { id: true, status: true },
    });

    if (!broadcast) throw new HttpError(404, 'Broadcast not found');

    // Deleting a live campaign is also how you stop one. Flip the status *before*
    // removing the rows so the worker's between-send check sees a cancelled
    // campaign on its very next poll — that check runs between every recipient,
    // so the send halts within one message rather than waiting on this delete.
    // The delete itself then removes the (now inert) record.
    if (broadcast.status === 'SENDING' || broadcast.status === 'PAUSED') {
      await prisma.broadcast.updateMany({
        where: { id: broadcast.id },
        data: { status: 'CANCELLED', nextBatchAt: null, queuedAt: null },
      });
    }

    return await prisma.$transaction([
      prisma.broadcastRecipient.deleteMany({ where: { broadcastId: broadcast.id } }),
      prisma.broadcast.delete({ where: { id: broadcast.id } }),
    ]);
  }

  /**
   * Campaign report: outcomes, engagement, and why anyone was left out.
   *
   * The old version pulled every recipient row into memory to build a two-field
   * summary — a 50,000-row transfer to render a progress bar. Everything here is
   * a grouped count, so the cost is flat in audience size.
   */
  static async getBroadcastStats(id: string, teamId?: string) {
    const broadcast = await prisma.broadcast.findFirst({
      where: teamId ? { id, teamId } : { id },
      include: { _count: { select: { recipients: DELIVERABLE_RECIPIENTS } } },
    });
    if (!broadcast) throw new HttpError(404, 'Broadcast not found');

    const [byStatus, bySkipReason, byErrorCode, byTier, replied, delivered, read] = await Promise.all([
      prisma.broadcastRecipient.groupBy({
        by: ['status'],
        where: { broadcastId: id },
        _count: { _all: true },
      }),
      prisma.broadcastRecipient.groupBy({
        by: ['skipReason'],
        where: { broadcastId: id, status: 'skipped' },
        _count: { _all: true },
      }),
      prisma.broadcastRecipient.groupBy({
        by: ['errorCode'],
        where: { broadcastId: id, status: 'failed' },
        _count: { _all: true },
      }),
      prisma.broadcastRecipient.groupBy({
        by: ['tier'],
        where: { broadcastId: id, status: 'sent' },
        _count: { _all: true },
      }),
      prisma.broadcastRecipient.count({ where: { broadcastId: id, repliedAt: { not: null } } }),
      prisma.broadcastRecipient.count({ where: { broadcastId: id, deliveredAt: { not: null } } }),
      prisma.broadcastRecipient.count({ where: { broadcastId: id, readAt: { not: null } } }),
    ]);

    const tally = (rows: Array<{ _count: { _all: number } }>, key: string) =>
      Object.fromEntries(
        rows.map((row) => [String((row as Record<string, unknown>)[key] ?? 'UNKNOWN'), row._count._all]),
      );

    const statusCounts = tally(byStatus, 'status');
    const sent = statusCounts.sent ?? 0;

    return {
      ...serializeBroadcast(broadcast),
      report: {
        status: {
          pending: statusCounts.pending ?? 0,
          sent,
          failed: statusCounts.failed ?? 0,
          skipped: statusCounts.skipped ?? 0,
          // Every row, including exclusions — this block is a breakdown, so its
          // parts have to add up to its total. (`recipientCount` on the campaign
          // itself is the deliverable count, which is a different question.)
          total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
        },
        engagement: {
          delivered,
          read,
          replied,
          // Reply rate is the metric that matters here. Delivery is table stakes;
          // a campaign nobody answers is the one that gets an account restricted.
          replyRate: sent ? replied / sent : 0,
          readRate: sent ? read / sent : 0,
          deliveryRate: sent ? delivered / sent : 0,
        },
        skipReasons: tally(bySkipReason, 'skipReason'),
        errorCodes: tally(byErrorCode, 'errorCode'),
        sentByTier: tally(byTier, 'tier'),
      },
    };
  }

  /**
   * Live view for a running campaign — cheap enough to poll, and the counters the
   * monitor draws its throughput chart from.
   */
  static async getLiveStatus(id: string, teamId?: string) {
    const broadcast = await prisma.broadcast.findFirst({
      where: teamId ? { id, teamId } : { id },
      select: {
        id: true,
        status: true,
        totalSent: true,
        totalFailed: true,
        nextBatchAt: true,
        sentAt: true,
        healthPausedAt: true,
        healthPauseReason: true,
        pilotSize: true,
        pilotCompletedAt: true,
        pacingProfile: true,
        throttlePerHour: true,
        riskLevel: true,
        riskScore: true,
        lastError: true,
      },
    });
    if (!broadcast) throw new HttpError(404, 'Broadcast not found');

    const [counts, recentSends, errorCodes, health, gate] = await Promise.all([
      prisma.broadcastRecipient.groupBy({
        by: ['status'],
        where: { broadcastId: id },
        _count: { _all: true },
      }),
      prisma.broadcastRecipient.count({
        where: { broadcastId: id, sentAt: { gte: new Date(Date.now() - 60 * 60_000) } },
      }),
      // What this campaign has actually run into. `riskLevel` on the row is the
      // verdict from before a single message went out; these are the facts.
      prisma.broadcastRecipient.groupBy({
        by: ['errorCode'],
        where: { broadcastId: id, status: 'failed', errorCode: { not: null } },
        _count: { _all: true },
      }),
      getAccountHealth().catch(() => null),
      verifyAccountGate().catch(() => null),
    ]);

    const byStatus = Object.fromEntries(counts.map((row) => [row.status, row._count._all]));
    const sent = byStatus.sent ?? 0;
    const pending = byStatus.pending ?? 0;
    const failed = byStatus.failed ?? 0;

    // Projection from observed throughput, not from the configured rate — the
    // configured rate is a ceiling, and quiet hours and rest breaks mean the real
    // number is always lower.
    const perHour = recentSends;
    const etaMinutes = perHour > 0 && pending > 0 ? Math.round((pending / perHour) * 60) : null;

    const errorsByCode = Object.fromEntries(
      errorCodes.map((row) => [row.errorCode ?? 'UNKNOWN', row._count._all]),
    ) as Record<string, number>;

    return {
      ...broadcast,
      counts: {
        pending,
        sent,
        failed,
        skipped: byStatus.skipped ?? 0,
        total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
      },
      throughput: { lastHour: perHour, etaMinutes },
      autoPaused: Boolean(broadcast.healthPausedAt),

      /**
       * The safety picture as it stands NOW, not as it stood when the campaign
       * was saved.
       *
       * `riskLevel`/`riskScore` above are a prediction frozen at save time. A
       * campaign drafted last week was assessed against last week's account, and
       * a campaign that has been running for two hours has real evidence that
       * beats any prediction. Both are returned so the UI can show the forecast
       * and the outcome side by side instead of pretending the forecast is still
       * the truth.
       */
      safety: {
        /** Live account health — the number the ban risk actually turns on. */
        health: health
          ? {
              score: health.score,
              grade: health.grade,
              confidence: health.confidence,
              blocked: health.blocked,
              blockedReason: health.blockedReason,
              budget: health.budget,
              failureRate: health.metrics.failureRate,
              hardBlocks: health.metrics.hardBlocks,
              coldReachoutBlocks: health.metrics.coldReachoutBlocks,
            }
          : null,
        /** Why sending is (or is not) possible this second. */
        gate: gate ? { ok: gate.ok, code: gate.code, reason: gate.reason } : null,
        /** This campaign's own delivery record. */
        observed: {
          attempted: sent + failed,
          failureRate: sent + failed > 0 ? failed / (sent + failed) : 0,
          errorsByCode,
          /** The two codes that mean WhatsApp itself is pushing back. */
          hardBlocks: errorsByCode.BLOCKED_403 ?? 0,
          coldReachoutBlocks: errorsByCode.COLD_REACHOUT_463 ?? 0,
        },
      },
    };
  }
}
