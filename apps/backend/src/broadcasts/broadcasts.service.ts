import { prisma } from '../lib/prisma';
import { getTenantContext } from '../lib/tenant-context';
import { HttpError } from '../auth/authorize';
import { toStorageRef, resolveMediaUrl } from '../lib/media';
import { instantToWallClock, isValidTimeZone, resolveScheduledInstant } from '../lib/timezone';
import { ensureBroadcastWorker } from './broadcast.queue';
import { claimAndEnqueue } from './broadcast.scheduler';
import { resolveAudience, type AudienceFilter } from './audience';

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
  /** Smart Sending: batch the audience with a wait between each batch. */
  smartSending?: boolean;
  batchSize?: number | null;
  batchIntervalMinutes?: number | null;
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
 */
function recipientRows(phones: string[]): Array<{ phone: string; tenantId: string | null }> {
  const tenantId = getTenantContext()?.tenantId ?? null;
  return phones.map((phone) => ({ phone, tenantId }));
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Resolve the batching half of a request into columns. When smart sending is off
 * the columns are nulled, so a broadcast can be flipped back to a plain send by
 * simply unchecking the box. `nextBatchAt` is always null here — it is owned by
 * the worker, which sets it after a batch finishes and there is more to send.
 */
function smartColumns(input: BroadcastInput) {
  if (!input.smartSending) {
    return { smartSending: false, batchSize: null, batchIntervalMinutes: null, nextBatchAt: null };
  }
  return {
    smartSending: true,
    batchSize: clampInt(input.batchSize ?? DEFAULT_BATCH_SIZE, MIN_BATCH_SIZE, MAX_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    batchIntervalMinutes: clampInt(
      input.batchIntervalMinutes ?? DEFAULT_BATCH_INTERVAL,
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
      include: { _count: { select: { recipients: true } } },
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
        : { _count: { select: { recipients: true } } },
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
        select: { id: true, phone: true, status: true },
        orderBy: [{ status: 'asc' }, { phone: 'asc' }],
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

    const counts = { pending: 0, sent: 0, failed: 0, total: 0 };
    for (const group of grouped) {
      const bucket = group.status as keyof typeof counts;
      const n = group._count._all;
      if (bucket in counts && bucket !== 'total') counts[bucket] = n;
      counts.total += n;
    }

    return { rows, total, page, pageSize, counts };
  }

  static async createBroadcast(input: BroadcastInput) {
    const schedule = resolveSchedule(input);
    const recipients = await resolveAudience(input);
    if (!recipients.length) {
      throw new HttpError(400, 'At least one recipient, tag, or filter is required');
    }

    const broadcast = await prisma.broadcast.create({
      data: {
        teamId: input.teamId,
        name: input.name,
        message: input.message,
        interactiveContent: input.interactiveContent ?? undefined,
        ...mediaColumns(input),
        ...smartColumns(input),
        status: schedule ? 'SCHEDULED' : 'DRAFT',
        type: schedule ? 'SCHEDULED' : 'IMMEDIATE',
        scheduledAt: schedule?.scheduledAt ?? null,
        timezone: schedule?.timezone ?? input.timezone?.trim() ?? 'UTC',
        description: input.tag ? `Tag: ${input.tag}` : null,
        recipients: {
          create: recipientRows(recipients),
        },
      },
      // Without this the response would claim `recipientCount: 0` for a
      // broadcast that just had its whole audience written.
      include: { _count: { select: { recipients: true } } },
    });

    return serializeBroadcast(broadcast);
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
    const recipients = await resolveAudience(input);
    if (!recipients.length) {
      throw new HttpError(400, 'At least one recipient, tag, or filter is required');
    }

    const broadcast = await prisma.broadcast.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        message: input.message,
        interactiveContent: input.interactiveContent ?? undefined,
        ...mediaColumns(input),
        ...smartColumns(input),
        status: schedule ? 'SCHEDULED' : 'DRAFT',
        type: schedule ? 'SCHEDULED' : 'IMMEDIATE',
        scheduledAt: schedule?.scheduledAt ?? null,
        timezone: schedule?.timezone ?? input.timezone?.trim() ?? 'UTC',
        description: input.tag ? `Tag: ${input.tag}` : null,
        lastError: null,
        // The audience is rewritten below, so any leftover batch cursor from a
        // prior run must reset too — otherwise the fresh send would think it was
        // mid-way through the old, now-deleted recipient set.
        queuedAt: null,
        recipients: {
          deleteMany: {},
          create: recipientRows(recipients),
        },
      },
      include: { _count: { select: { recipients: true } } },
    });

    return serializeBroadcast(broadcast);
  }

  /** Send right now, regardless of any schedule that was set. */
  static async sendBroadcast(id: string, teamId?: string) {
    const broadcast = await prisma.broadcast.findFirst({
      where: teamId ? { id, teamId } : { id },
    });
    if (!broadcast) throw new HttpError(404, 'Broadcast not found');

    if (broadcast.status === 'SENDING') throw new HttpError(409, 'This broadcast is already sending.');
    if (broadcast.status === 'SENT') throw new HttpError(409, 'This broadcast has already been sent.');

    // The same compare-and-swap the scheduler uses, so a manual Send racing the
    // scheduled fire time can only produce one run.
    const claimed = await claimAndEnqueue(id, ['DRAFT', 'SCHEDULED', 'FAILED', 'PAUSED']);
    if (!claimed) throw new HttpError(409, 'This broadcast was just started by someone else.');

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
      include: { recipients: { select: { phone: true } } },
    });
    if (!source) throw new HttpError(404, 'Broadcast not found');

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
        status: 'DRAFT',
        type: 'IMMEDIATE',
        scheduledAt: null,
        timezone: source.timezone,
        recipients: { create: recipientRows(source.recipients.map((recipient) => recipient.phone)) },
      },
      include: { _count: { select: { recipients: true } } },
    });

    return serializeBroadcast(copy);
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

  static async resumeBroadcast(id: string, teamId?: string) {
    const broadcast = await prisma.broadcast.findFirst({
      where: teamId ? { id, teamId } : { id },
      select: { id: true, status: true },
    });
    if (!broadcast) throw new HttpError(404, 'Broadcast not found');
    if (broadcast.status !== 'PAUSED') throw new HttpError(409, 'Broadcast is not paused');

    // Re-queue — the worker skips recipients already marked sent.
    const claimed = await claimAndEnqueue(id, ['PAUSED']);
    if (!claimed) throw new HttpError(409, 'Broadcast is no longer paused.');
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

  static async getBroadcastStats(id: string, teamId?: string) {
    const broadcast = await prisma.broadcast.findFirst({
      where: teamId ? { id, teamId } : { id },
      include: { recipients: true },
    });

    if (!broadcast) throw new HttpError(404, 'Broadcast not found');

    return {
      ...serializeBroadcast(broadcast),
      recipients: broadcast.recipients.map((recipient) => ({
        phone: recipient.phone,
        status: recipient.status,
      })),
    };
  }
}
