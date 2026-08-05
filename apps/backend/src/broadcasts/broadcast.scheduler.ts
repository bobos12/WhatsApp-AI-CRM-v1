import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { emitRealtime } from '../realtime/socket';
import { broadcastQueue, ensureBroadcastWorker } from './broadcast.queue';
import { nextAllowedTime } from './safety/quiet-hours';
import { reconcileBroadcastEngagement } from './engagement.service';

/**
 * ─── Scheduled broadcast dispatch ────────────────────────────────────────────
 *
 * Before this existed, `createBroadcast` wrote `status: 'SCHEDULED'` and
 * `scheduledAt`, and then nothing on the entire server ever looked at those two
 * columns again. Scheduled broadcasts did not fire late or at the wrong time —
 * they never fired at all, until someone opened the campaign and pressed Send.
 *
 * The dispatcher is a database poll rather than a Bull delayed job, because the
 * database is the only thing that already survives everything we care about:
 *
 *   • Redis flushed / evicted → a delayed job vanishes silently. A row does not.
 *   • Server down at fire time → a delayed job's timer is gone. The poll sees
 *     `scheduledAt <= now()` on the next tick and catches up.
 *   • Two API instances → `updateMany` with a status guard is a compare-and-swap,
 *     so exactly one process transitions SCHEDULED → SENDING and enqueues.
 *
 * Redis is still where the *work* happens; it just no longer holds the only copy
 * of the promise that the work will happen.
 */

const POLL_INTERVAL_MS = Number(process.env.BROADCAST_SCHEDULER_POLL_MS ?? 30_000);
const BATCH_SIZE = Number(process.env.BROADCAST_SCHEDULER_BATCH ?? 50);

/**
 * How late is too late. If the server was down over a broadcast's scheduled
 * time, firing it days afterwards is worse than not firing it — a "Doors open in
 * 1 hour" blast landing on Thursday is a support ticket, not a delivery. Past
 * this window the row is parked in FAILED with an explanation so the user can
 * decide to re-send.
 */
const MAX_CATCHUP_MS = Number(process.env.BROADCAST_MAX_CATCHUP_MS ?? 24 * 60 * 60 * 1000);

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

/**
 * Atomically take ownership of a scheduled broadcast and enqueue it.
 *
 * The `where` clause carries the expected status, so the update only matches if
 * no other process (or the user pressing Send) got there first. `count === 1`
 * is the proof that we, and only we, own this run.
 */
export async function claimAndEnqueue(
  broadcastId: string,
  expectedStatuses: Array<'SCHEDULED' | 'DRAFT' | 'FAILED' | 'PAUSED'>,
): Promise<boolean> {
  const claimed = await prisma.broadcast.updateMany({
    where: { id: broadcastId, status: { in: expectedStatuses as any } },
    data: { status: 'SENDING', queuedAt: new Date(), lastError: null },
  });

  if (claimed.count !== 1) return false;

  try {
    await broadcastQueue.add({ broadcastId });
    return true;
  } catch (error) {
    // The claim succeeded but the enqueue didn't. Hand the row back rather than
    // stranding it in SENDING with no job behind it.
    const message = error instanceof Error ? error.message : String(error);
    await prisma.broadcast.updateMany({
      where: { id: broadcastId, status: 'SENDING' },
      data: {
        status: expectedStatuses.includes('SCHEDULED') ? 'SCHEDULED' : 'DRAFT',
        queuedAt: null,
        lastError: `Could not queue the broadcast: ${message}`,
      },
    });
    logger.error('broadcast.enqueue_failed', { broadcastId, error: message });
    throw error;
  }
}

/**
 * Continue a smart-sending campaign whose between-batch wait has elapsed.
 *
 * The row sits in SENDING with `nextBatchAt` set while it waits. This is the same
 * compare-and-swap as the scheduled poll: the guarded `updateMany` clears
 * `nextBatchAt` so exactly one process claims the continuation, then enqueues the
 * next batch. The worker parks it again (sets a fresh `nextBatchAt`) when that
 * batch finishes, and so on until the audience is drained.
 */
async function claimAndEnqueueBatch(broadcastId: string, now: Date): Promise<boolean> {
  const claimed = await prisma.broadcast.updateMany({
    where: { id: broadcastId, status: 'SENDING', nextBatchAt: { not: null, lte: now } },
    data: { nextBatchAt: null, queuedAt: now },
  });
  if (claimed.count !== 1) return false;

  try {
    await broadcastQueue.add({ broadcastId });
    return true;
  } catch (error) {
    // Enqueue failed after the claim. Re-arm `nextBatchAt` in the past so the next
    // tick retries, rather than stranding the campaign with no job and no timer.
    await prisma.broadcast.updateMany({
      where: { id: broadcastId, status: 'SENDING', nextBatchAt: null },
      data: { nextBatchAt: now },
    });
    logger.error('broadcast.batch_enqueue_failed', {
      broadcastId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function expireMissedBroadcast(broadcast: { id: string; teamId: string | null; scheduledAt: Date | null }) {
  const message =
    'This broadcast was not sent because the server was offline at its scheduled time, ' +
    'and the time has since passed by more than the catch-up window. Re-send it manually if it is still relevant.';

  const updated = await prisma.broadcast.updateMany({
    where: { id: broadcast.id, status: 'SCHEDULED' },
    data: { status: 'FAILED', lastError: message },
  });
  if (updated.count !== 1) return;

  logger.warn('broadcast.missed_schedule_window', {
    broadcastId: broadcast.id,
    scheduledAt: broadcast.scheduledAt?.toISOString(),
  });
  emitRealtime('broadcast:complete', {
    broadcastId: broadcast.id,
    sent: 0,
    failed: 0,
    total: 0,
    status: 'FAILED',
  }, broadcast.teamId ?? undefined);
}

/**
 * Scheduled campaigns whose fire time lands inside the recipient's night are
 * pushed to the morning rather than dispatched.
 *
 * This is the catch-up case that used to bite hardest: the server is down over a
 * 9 a.m. send, comes back at 2 a.m., and the old poll fired everything it found
 * the instant it booted. Every recipient got a marketing message in the middle of
 * the night, and the campaign's block rate reflected it.
 */
async function deferForQuietHours(broadcast: {
  id: string;
  quietHoursEnabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  timezone: string;
}, now: Date): Promise<boolean> {
  const window = {
    enabled: broadcast.quietHoursEnabled,
    start: broadcast.quietHoursStart,
    end: broadcast.quietHoursEnd,
  };
  const allowedAt = nextAllowedTime(window, broadcast.timezone || 'UTC', now);
  if (allowedAt.getTime() <= now.getTime() + 60_000) return false;

  await prisma.broadcast.updateMany({
    where: { id: broadcast.id, status: 'SCHEDULED' },
    data: { scheduledAt: allowedAt },
  });
  logger.info('broadcast.deferred_quiet_hours', {
    broadcastId: broadcast.id,
    resumesAt: allowedAt.toISOString(),
  });
  return true;
}

async function tick(): Promise<void> {
  if (ticking) return; // a slow tick must not overlap the next one
  ticking = true;
  try {
    const now = new Date();
    const due = await prisma.broadcast.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
      select: {
        id: true,
        teamId: true,
        scheduledAt: true,
        quietHoursEnabled: true,
        quietHoursStart: true,
        quietHoursEnd: true,
        timezone: true,
      },
      orderBy: { scheduledAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const broadcast of due) {
      const lateBy = broadcast.scheduledAt ? now.getTime() - broadcast.scheduledAt.getTime() : 0;

      if (lateBy > MAX_CATCHUP_MS) {
        await expireMissedBroadcast(broadcast);
        continue;
      }

      if (await deferForQuietHours(broadcast, now)) continue;

      try {
        const claimed = await claimAndEnqueue(broadcast.id, ['SCHEDULED']);
        if (claimed) {
          logger.info('broadcast.scheduled_dispatched', {
            broadcastId: broadcast.id,
            scheduledAt: broadcast.scheduledAt?.toISOString(),
            lateByMs: lateBy,
          });
          emitRealtime('broadcast:progress', {
            broadcastId: broadcast.id,
            sent: 0,
            failed: 0,
            total: 0,
          }, broadcast.teamId ?? undefined);
        }
      } catch {
        // claimAndEnqueue already logged and released the row; the next tick retries.
      }
    }

    // Smart-sending continuations whose between-batch wait has elapsed. This is
    // what makes batching survive a restart: the next batch is not an in-process
    // timer, it is a row the poll re-discovers by `nextBatchAt <= now`.
    const dueBatches = await prisma.broadcast.findMany({
      where: { status: 'SENDING', nextBatchAt: { not: null, lte: now } },
      select: { id: true },
      orderBy: { nextBatchAt: 'asc' },
      take: BATCH_SIZE,
    });
    for (const broadcast of dueBatches) {
      const claimed = await claimAndEnqueueBatch(broadcast.id, now);
      if (claimed) {
        logger.info('broadcast.next_batch_dispatched', { broadcastId: broadcast.id });
      }
    }

    // Delivery receipts and replies for recently-sent campaigns. Runs on the same
    // tick because it feeds account health, which the very next slice reads.
    await reconcileBroadcastEngagement();
  } catch (error) {
    logger.error('broadcast.scheduler_tick_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    ticking = false;
  }
}

/**
 * Re-queue broadcasts left mid-flight by a crash.
 *
 * A row sits in SENDING for the whole run. If the process died there, Redis
 * usually still holds the job and Bull resumes it on connect — but if Redis was
 * cleared too, nothing does. Ask the queue what it actually knows about, and
 * re-enqueue anything the database thinks is running but the queue has never
 * heard of. The worker skips recipients already marked `sent`, so a re-run is
 * idempotent and nobody receives the message twice.
 *
 * `nextBatchAt IS NULL` is the filter that keeps this from fighting the due-batch
 * poll: a smart campaign *waiting between batches* has `nextBatchAt` set and must
 * be left alone until it comes due. Only a run that was actively sending (or
 * claimed but not yet started) has a null cursor, and that is what needs rescuing.
 */
async function recoverInterrupted(): Promise<void> {
  try {
    const sending = await prisma.broadcast.findMany({
      where: { status: 'SENDING', nextBatchAt: null },
      select: { id: true },
    });
    if (!sending.length) return;

    const jobs = await broadcastQueue.getJobs(['waiting', 'active', 'delayed', 'paused']);
    const queued = new Set(
      jobs.map((job) => (job.data as { broadcastId?: string })?.broadcastId).filter(Boolean) as string[],
    );

    for (const broadcast of sending) {
      if (queued.has(broadcast.id)) continue;
      await broadcastQueue.add({ broadcastId: broadcast.id });
      logger.warn('broadcast.recovered_interrupted_run', { broadcastId: broadcast.id });
    }
  } catch (error) {
    logger.error('broadcast.recovery_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function startBroadcastScheduler(): () => void {
  ensureBroadcastWorker();

  // Boot order matters: pick up crashed runs first, then catch up on anything
  // whose scheduled time passed while the process was down.
  void recoverInterrupted().then(() => tick());

  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  logger.info('broadcast.scheduler_started', { pollIntervalMs: POLL_INTERVAL_MS });

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
