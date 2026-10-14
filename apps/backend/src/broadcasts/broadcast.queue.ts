import Queue from 'bull';
import { prisma, prismaUnscoped } from '../lib/prisma';
import { runWithTenant, runAsPlatform } from '../lib/tenant-context';
import { providerManager } from '../providers/manager';
import { emitRealtime } from '../realtime/socket';
import { logger } from '../lib/logger';
import { buildPersonalizationVars, personalize } from './personalization';
import { toMetaTemplateName } from '../providers/meta/templates';
import { asMetaError } from '../providers/meta/graph';

/**
 * Broadcast delivery worker.
 *
 * A campaign on the Cloud API is a loop of template sends. It used to be far
 * more than that: the previous worker carried humanised inter-message delays, a
 * warm-up ramp, a circuit breaker, per-recipient quality tiers and quiet hours,
 * all of which existed because the CRM sent over an unofficial WhatsApp Web
 * library where volume alone could get a number banned with no appeal.
 *
 * None of that applies here. Meta publishes an explicit messaging limit tier,
 * enforces it server-side, and returns a specific error code when you exceed it.
 * Guessing at a "safe" rate underneath a limit the platform already tells you is
 * strictly worse than reading the limit — so the pacing is now just enough to
 * stay inside Meta's documented throughput, and everything else is handled by
 * reacting to what Meta actually says.
 *
 * What is deliberately kept is the *job* machinery, which was never about bans:
 * a slice delivers part of the audience and parks, so a large campaign survives
 * a deploy, stays resumable, and never holds a worker for hours.
 */

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const broadcastQueue = new Queue('broadcast-sends', redisUrl, {
  defaultJobOptions: {
    // One retry. A job that failed did so because the channel or Meta is
    // unhappy; genuine transients are already retried inside the Graph client,
    // and re-running a whole slice risks re-sending to recipients it had
    // already delivered to.
    attempts: 2,
    backoff: { type: 'fixed', delay: 60_000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

/**
 * How long a single job may hold the worker before parking itself.
 *
 * A job that runs for hours is invisible to operators, un-resumable across a
 * deploy, and occupies a concurrency slot. Each job delivers a slice and parks;
 * the scheduler picks the campaign back up on the next tick.
 */
const MAX_JOB_MS = Number(process.env.BROADCAST_MAX_JOB_MS ?? 20 * 60_000);

/** Concurrent broadcast jobs across all tenants. */
const WORKER_CONCURRENCY = Number(process.env.BROADCAST_WORKER_CONCURRENCY ?? 3);

/**
 * Gap between sends, in milliseconds.
 *
 * Meta accepts a high throughput (80 messages/second by default on Cloud API),
 * far above anything a CRM campaign needs. This modest gap keeps us well clear
 * of that ceiling and of per-second bursts, without pretending to be a safety
 * mechanism — Meta's messaging limit tier is the real constraint and it is
 * enforced by Meta, not by us.
 */
const SEND_GAP_MS = Number(process.env.BROADCAST_SEND_GAP_MS ?? 120);

/** How many recipients one slice will attempt before parking. */
const SLICE_SIZE = Number(process.env.BROADCAST_SLICE_SIZE ?? 500);

/**
 * One campaign per account at a time. Two campaigns interleaving through one
 * number doubles the effective rate and makes the delivery order unpredictable.
 */
const PLATFORM_LOCK = '__platform__';
const activeTenantLocks = new Set<string>();

function acquireTenantLock(key: string): boolean {
  if (activeTenantLocks.has(key)) return false;
  activeTenantLocks.add(key);
  return true;
}

function releaseTenantLock(key: string): void {
  activeTenantLocks.delete(key);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type StopReason =
  | 'AUDIENCE_DRAINED'
  | 'SLICE_LIMIT'
  | 'JOB_TIME_LIMIT'
  | 'USER_STOPPED'
  | 'NOT_CONNECTED'
  | 'TEMPLATE_MISSING'
  | 'TEMPLATE_NOT_APPROVED'
  | 'RATE_LIMITED'
  | 'ACCOUNT_RESTRICTED';

let workerInitialized = false;

export function ensureBroadcastWorker() {
  if (workerInitialized) return;
  workerInitialized = true;

  broadcastQueue.process(WORKER_CONCURRENCY, async (job) => {
    const { broadcastId } = job.data as { broadcastId: string };

    // A Bull job runs detached from any request/boot scope. Resolve the owning
    // tenant unguarded, then run the whole job in that tenant's scope so every
    // query is fenced and the send uses that tenant's own credentials.
    const owner = await prismaUnscoped.broadcast.findUnique({
      where: { id: broadcastId },
      select: { tenantId: true },
    });

    if (!owner) {
      logger.info('broadcast.job_for_deleted_broadcast', { broadcastId });
      return { broadcastId, deleted: true };
    }

    const lockKey = owner.tenantId ?? PLATFORM_LOCK;
    if (!acquireTenantLock(lockKey)) {
      const runScopedQuick = <T>(fn: () => Promise<T>): Promise<T> =>
        owner.tenantId ? runWithTenant(owner.tenantId, fn) : runAsPlatform(fn);
      await runScopedQuick(async () => {
        await prisma.broadcast.updateMany({
          where: { id: broadcastId, status: 'SENDING' },
          data: { nextBatchAt: new Date(Date.now() + 60_000), queuedAt: null },
        });
      });
      logger.info('broadcast.deferred_account_busy', { broadcastId, tenantId: owner.tenantId });
      return { broadcastId, deferred: true };
    }

    try {
      const runScoped = <T>(fn: () => Promise<T>): Promise<T> =>
        owner.tenantId ? runWithTenant(owner.tenantId, fn) : runAsPlatform(fn);
      return await runScoped(() => runSlice(broadcastId));
    } finally {
      releaseTenantLock(lockKey);
    }
  });
}

/**
 * Deliver one slice of a campaign, then decide what happens next.
 *
 * A slice ends when the audience is drained, the slice size is reached, the job
 * time budget is spent, the user stops the run, or Meta tells us to stop.
 */
async function runSlice(broadcastId: string) {
  const broadcast = await prisma.broadcast.findUnique({ where: { id: broadcastId } });

  if (!broadcast) {
    logger.info('broadcast.job_for_deleted_broadcast', { broadcastId });
    return { broadcastId, deleted: true };
  }

  // The only status a job may run against is SENDING — the claim sets it before
  // the job is added. Any other value means the row was claimed away: completed,
  // cancelled, paused or reverted. Never re-set SENDING here; that would
  // silently un-cancel a campaign the user just stopped.
  if (broadcast.status !== 'SENDING') {
    logger.info('broadcast.not_sending_skipping', { broadcastId, status: broadcast.status });
    return { broadcastId, sent: broadcast.totalSent, failed: broadcast.totalFailed, skipped: true };
  }

  const teamId = broadcast.teamId ?? undefined;

  // ── Channel gate ───────────────────────────────────────────────────────────
  // A slice that starts with no usable channel is not a failed slice — it is a
  // slice that has not happened yet. Parking keeps every recipient `pending`, so
  // the campaign resumes when the channel recovers. Running anyway would burn
  // the remaining audience into failures for messages Meta never received.
  const status = await providerManager.getStatus();
  if (status.status !== 'connected') {
    await parkUntil(broadcastId, teamId, new Date(Date.now() + 60_000), 'NOT_CONNECTED');
    return { broadcastId, parked: 'NOT_CONNECTED' };
  }

  // ── Template gate ──────────────────────────────────────────────────────────
  // Preflight blocks a template-less campaign at save time; reaching here means
  // the template was deleted or un-approved after scheduling. Park rather than
  // burn the audience into failures for messages Meta would refuse.
  const template = broadcast.templateId
    ? await prisma.messageTemplate.findUnique({ where: { id: broadcast.templateId } })
    : null;

  if (!template) {
    await parkUntil(broadcastId, teamId, new Date(Date.now() + 15 * 60_000), 'TEMPLATE_MISSING');
    logger.error('broadcast.template_missing', { broadcastId });
    return { broadcastId, parked: 'TEMPLATE_MISSING' };
  }

  if (template.metaStatus !== 'APPROVED') {
    await parkUntil(broadcastId, teamId, new Date(Date.now() + 30 * 60_000), 'TEMPLATE_NOT_APPROVED');
    logger.warn('broadcast.template_not_approved', {
      broadcastId,
      templateId: template.id,
      metaStatus: template.metaStatus,
    });
    return { broadcastId, parked: 'TEMPLATE_NOT_APPROVED' };
  }

  /** Positional slots the approved template expects, in order. */
  const variableOrder: string[] = Array.isArray(template.variables) ? (template.variables as string[]) : [];
  /** Explicit position → contact-field overrides set on the campaign. */
  const variableMap = (broadcast.templateVariables ?? null) as Record<string, string> | null;

  // ── Recipients ─────────────────────────────────────────────────────────────
  const recipients = await prisma.broadcastRecipient.findMany({
    where: { broadcastId, status: 'pending' },
    take: SLICE_SIZE,
    select: { id: true, phone: true, attempts: true },
  });

  if (recipients.length === 0) {
    return finishCampaign(broadcastId, teamId, 'AUDIENCE_DRAINED');
  }

  const contacts = await prisma.contact.findMany({
    where: { phone: { in: recipients.map((r) => r.phone) } },
    select: { id: true, phone: true, name: true, email: true, company: true, customFields: true },
  });
  const contactByPhone = new Map(contacts.map((c) => [c.phone, c]));

  const startedAt = Date.now();
  let sent = 0;
  let failed = 0;
  let stopReason: StopReason = 'AUDIENCE_DRAINED';

  for (const recipient of recipients) {
    // Time-box the job so a long run stays resumable across a deploy.
    if (Date.now() - startedAt > MAX_JOB_MS) {
      stopReason = 'JOB_TIME_LIMIT';
      break;
    }

    // Re-read status so Pause/Cancel takes effect mid-slice rather than after it.
    const current = await prisma.broadcast.findUnique({
      where: { id: broadcastId },
      select: { status: true },
    });
    if (current?.status !== 'SENDING') {
      stopReason = 'USER_STOPPED';
      break;
    }

    const contact = contactByPhone.get(recipient.phone);
    const vars = buildPersonalizationVars(contact, recipient.phone);

    // Fill the approved template's positional slots. A slot maps to a contact
    // field either through the campaign's explicit mapping or, by default,
    // through a personalization token of the same name — so `{{name}}` in the
    // template works without extra configuration.
    const bodyValues = variableOrder.map((slot) => vars[variableMap?.[slot] ?? slot] ?? '');

    try {
      const result = await providerManager.sendMessage({
        phone: recipient.phone,
        template: {
          templateId: template.id,
          name: toMetaTemplateName(template.name),
          language: template.language,
          bodyValues,
          headerMedia: template.mediaUrl
            ? {
                storageRef: template.mediaUrl,
                format: (template.mediaType as 'IMAGE' | 'VIDEO' | 'DOCUMENT') ?? 'IMAGE',
                filename: template.mediaFilename,
              }
            : null,
          // What the recipient actually reads, so the CRM transcript and the
          // conversation preview match the delivered message.
          renderedBody: personalize(template.content ?? '', vars),
        },
      });

      await prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          attempts: recipient.attempts + 1,
          contactId: contact?.id ?? null,
          messageId: result?.messageId ?? null,
          errorCode: null,
          lastError: null,
        },
      });
      sent += 1;
    } catch (error) {
      const meta = asMetaError(error);

      await prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'failed',
          attempts: recipient.attempts + 1,
          contactId: contact?.id ?? null,
          errorCode: String(meta.code),
          lastError: meta.userMessage.slice(0, 500),
        },
      });
      failed += 1;

      // Some failures are about the account, not this recipient. Continuing
      // would convert the rest of the audience into failures for messages Meta
      // was never going to accept — park instead and let the scheduler retry.
      if (meta.kind === 'RATE_LIMITED') {
        stopReason = 'RATE_LIMITED';
        break;
      }
      if (meta.kind === 'ACCOUNT_RESTRICTED' || meta.kind === 'AUTH') {
        stopReason = 'ACCOUNT_RESTRICTED';
        break;
      }
    }

    emitRealtime('broadcast:progress', { broadcastId, sent, failed }, teamId);

    if (SEND_GAP_MS > 0) await sleep(SEND_GAP_MS);
  }

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: {
      totalSent: { increment: sent },
      totalFailed: { increment: failed },
    },
  });

  logger.info('broadcast.slice_complete', { broadcastId, sent, failed, stopReason });

  // ── What happens next ──────────────────────────────────────────────────────
  if (stopReason === 'USER_STOPPED') {
    return { broadcastId, sent, failed, stopped: true };
  }

  if (stopReason === 'RATE_LIMITED') {
    // Meta's limits reset on a rolling window; an hour is long enough to clear a
    // burst limit and short enough that a large campaign still finishes today.
    await parkUntil(broadcastId, teamId, new Date(Date.now() + 60 * 60_000), 'RATE_LIMITED');
    return { broadcastId, sent, failed, parked: 'RATE_LIMITED' };
  }

  if (stopReason === 'ACCOUNT_RESTRICTED') {
    await parkUntil(broadcastId, teamId, new Date(Date.now() + 6 * 60 * 60_000), 'ACCOUNT_RESTRICTED');
    return { broadcastId, sent, failed, parked: 'ACCOUNT_RESTRICTED' };
  }

  const remaining = await prisma.broadcastRecipient.count({ where: { broadcastId, status: 'pending' } });
  if (remaining === 0) {
    return finishCampaign(broadcastId, teamId, 'AUDIENCE_DRAINED');
  }

  // More to send: re-arm promptly. Batch spacing, when the user asked for it, is
  // honoured here rather than by sleeping inside the job.
  const gapMinutes = broadcast.smartSending && broadcast.batchIntervalMinutes
    ? broadcast.batchIntervalMinutes
    : 0;
  await parkUntil(
    broadcastId,
    teamId,
    new Date(Date.now() + gapMinutes * 60_000),
    stopReason === 'JOB_TIME_LIMIT' ? 'JOB_TIME_LIMIT' : 'SLICE_LIMIT',
  );

  return { broadcastId, sent, failed, remaining };
}

/**
 * Hand the campaign back to the scheduler at `at`, leaving every unsent
 * recipient `pending`. Guarded so a Pause or Cancel that landed during the slice
 * is not overwritten.
 */
async function parkUntil(
  broadcastId: string,
  teamId: string | undefined,
  at: Date,
  reason: StopReason,
): Promise<void> {
  const parked = await prisma.broadcast.updateMany({
    where: { id: broadcastId, status: 'SENDING' },
    data: { nextBatchAt: at, queuedAt: null },
  });

  if (parked.count > 0) {
    logger.info('broadcast.parked', { broadcastId, reason, resumeAt: at.toISOString() });
    emitRealtime('broadcast:parked', { broadcastId, reason, resumeAt: at.toISOString() }, teamId);
  }
}

async function finishCampaign(broadcastId: string, teamId: string | undefined, reason: StopReason) {
  const totals = await prisma.broadcastRecipient.groupBy({
    by: ['status'],
    where: { broadcastId },
    _count: { _all: true },
  });

  const sent = totals.find((t) => t.status === 'sent')?._count._all ?? 0;
  const failed = totals.find((t) => t.status === 'failed')?._count._all ?? 0;

  await prisma.broadcast.updateMany({
    where: { id: broadcastId, status: 'SENDING' },
    data: {
      status: 'SENT',
      sentAt: new Date(),
      nextBatchAt: null,
      queuedAt: null,
      totalSent: sent,
      totalFailed: failed,
    },
  });

  logger.info('broadcast.completed', { broadcastId, sent, failed, reason });
  emitRealtime('broadcast:complete', { broadcastId, sent, failed }, teamId);

  return { broadcastId, sent, failed, completed: true };
}
