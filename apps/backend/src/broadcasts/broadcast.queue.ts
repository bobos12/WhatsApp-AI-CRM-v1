import crypto from 'node:crypto';
import Queue from 'bull';
import { prisma, prismaUnscoped } from '../lib/prisma';
import { runWithTenant, runAsPlatform } from '../lib/tenant-context';
import { providerManager } from '../providers/manager';
import { emitRealtime } from '../realtime/socket';
import { logger } from '../lib/logger';
import { CONTACT_FIELDS, fillBlank, readBlank } from '@crm/messaging-schema';
import { buildPersonalizationVars } from './personalization';
import { toMetaTemplateName, approvedExtras } from '../providers/meta/templates';
import { asMetaError, type MetaApiError } from '../providers/meta/graph';
import { HttpError } from '../auth/authorize';
import { emitDataChanged } from '../realtime/socket';

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

/**
 * Jobs are namespaced by the database they belong to.
 *
 * Two deployments pointed at one Redis (an old server left running after a
 * move, a staging copy) would otherwise share one queue: whichever worker took
 * a job looked the campaign up in *its own* database, found nothing, and
 * dropped it — leaving the real campaign stuck at "Sending" forever.
 */
const queuePrefix = `bull-${crypto
  .createHash('sha256')
  .update(process.env.DATABASE_URL ?? 'local')
  .digest('hex')
  .slice(0, 12)}`;

export const broadcastQueue = new Queue('broadcast-sends', redisUrl, {
  prefix: queuePrefix,
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
const SEND_GAP_MS = Number(process.env.BROADCAST_SEND_GAP_MS ?? 25);

/** Recipients sent to at the same moment. */
const SEND_CONCURRENCY = Math.max(1, Number(process.env.BROADCAST_SEND_CONCURRENCY ?? 4));

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
  | 'ACCOUNT_RESTRICTED'
  | 'CAMPAIGN_PROBLEM';

/** Rate limits that apply to the whole number, not to one recipient. */
const NUMBER_RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048]);

/**
 * Template errors that would repeat for every recipient — the template is
 * paused, gone, or shaped differently from what we send. Value-level errors
 * (one person's name too long, …) are per recipient and are not listed.
 */
const CAMPAIGN_WIDE_TEMPLATE_CODES = new Set([132000, 132001, 132015, 132016, 132068, 132069]);

/**
 * Consecutive failures after which a run stops itself. A list where twenty
 * messages in a row fail is a list, template or account problem, and carrying on
 * only spends money and hurts the number's standing with Meta.
 */
const FAILURE_STREAK_LIMIT = Number(process.env.BROADCAST_FAILURE_STREAK_LIMIT ?? 20);

type Verdict =
  /** This recipient failed; carry on with the next. */
  | 'recipient'
  /** The number is sending too fast; wait and resume. */
  | 'rate'
  /** The account cannot send at all right now; wait and resume. */
  | 'account'
  /** Every remaining send would fail the same way; stop and tell the user. */
  | 'campaign';

function classify(error: unknown, meta: MetaApiError): Verdict {
  if (error instanceof HttpError) {
    if (error.code === 'CHANNEL_RESTRICTED' || error.code === 'CLOUD_API_NOT_CONFIGURED') return 'account';
    // A header attachment that cannot be loaded fails identically for everyone.
    if (meta.code === -1 && error.status === 400 && /header/i.test(error.message)) return 'campaign';
  }
  if (meta.kind === 'AUTH' || meta.kind === 'ACCOUNT_RESTRICTED') return 'account';
  if (meta.kind === 'RATE_LIMITED' && NUMBER_RATE_LIMIT_CODES.has(meta.code)) return 'rate';
  if (CAMPAIGN_WIDE_TEMPLATE_CODES.has(meta.code)) return 'campaign';
  return 'recipient';
}

/** Failures that say nothing about the campaign — the person just can't get it. */
function isRecipientSpecific(meta: MetaApiError): boolean {
  return meta.kind === 'UNDELIVERABLE' || meta.kind === 'NOT_DELIVERED';
}

/** Replace each {{slot}} in the body with the value sent for it. */
function renderBody(body: string, slots: string[], values: string[]): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (all, slot: string) => {
    const index = slots.indexOf(slot);
    return index >= 0 ? values[index] : all;
  });
}

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
    await parkUntil(
      broadcastId,
      teamId,
      new Date(Date.now() + 60_000),
      'NOT_CONNECTED',
      'Waiting for the WhatsApp connection. Sending continues by itself as soon as it is back.',
    );
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
    await pauseForReview(
      broadcastId,
      teamId,
      'The template this campaign uses was deleted. Edit the campaign, choose another template, then press Resume.',
    );
    logger.error('broadcast.template_missing', { broadcastId });
    return { broadcastId, paused: 'TEMPLATE_MISSING' };
  }

  if (template.metaStatus !== 'APPROVED') {
    await pauseForReview(
      broadcastId,
      teamId,
      `WhatsApp no longer allows the "${template.name}" template (status: ${(template.metaStatus ?? 'not submitted').toLowerCase()}). ` +
        'Edit the campaign and choose an approved template, then resume.',
    );
    logger.warn('broadcast.template_not_approved', {
      broadcastId,
      templateId: template.id,
      metaStatus: template.metaStatus,
    });
    return { broadcastId, paused: 'TEMPLATE_NOT_APPROVED' };
  }

  /** Positional slots the approved template expects, in order. */
  const variableOrder: string[] = Array.isArray(template.variables) ? (template.variables as string[]) : [];
  /** How the campaign fills each slot — a contact field (with a backup) or fixed text. */
  const variableMap = (broadcast.templateVariables ?? null) as Record<string, string> | null;
  const customFieldKeys = variableOrder.length
    ? (await prisma.customFieldDefinition.findMany({ select: { key: true } })).map((f) => f.key)
    : [];
  const knownFields = [...CONTACT_FIELDS, ...customFieldKeys];
  const blanks = variableOrder.map((slot) => readBlank(variableMap, slot, knownFields));
  /** Footer + buttons exactly as Meta approved them — same for every recipient. */
  const extras = approvedExtras(template);

  // ── Recipients ─────────────────────────────────────────────────────────────
  const recipients = await prisma.broadcastRecipient.findMany({
    where: { broadcastId, status: 'pending' },
    orderBy: { sortOrder: 'asc' },
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
  let failureStreak = 0;
  let stopReason: StopReason = 'AUDIENCE_DRAINED';
  /** Why the run stopped itself, in words the user can act on. */
  let stopMessage = '';

  type Outcome =
    | { kind: 'sent' }
    | { kind: 'failed'; meta: MetaApiError }
    | { kind: 'stop'; verdict: Verdict; message: string; code: number };

  /** One recipient, start to finish. Never throws. */
  const sendOne = async (recipient: (typeof recipients)[number]): Promise<Outcome> => {
    const contact = contactByPhone.get(recipient.phone);
    const vars = buildPersonalizationVars(contact, recipient.phone);

    // Fill the approved template's positional slots. Never with an empty value:
    // Meta refuses the whole message when a blank is empty, so a missing field
    // falls back to the campaign's backup text (or a neutral default).
    const bodyValues = blanks.map((blank) => fillBlank(blank, vars, template.language));

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
          renderedBody: renderBody(template.content ?? '', variableOrder, bodyValues),
          ...extras,
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
      return { kind: 'sent' };
    } catch (error) {
      const meta = asMetaError(error);
      const verdict = classify(error, meta);

      // Not this person's fault: leave them pending so they are sent to when
      // the run resumes, rather than written off as a failure.
      if (verdict !== 'recipient') {
        return {
          kind: 'stop',
          verdict,
          code: meta.code,
          message: meta.code === -1 && error instanceof Error ? error.message : meta.userMessage,
        };
      }

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
      return { kind: 'failed', meta };
    }
  };

  // A few sends in flight at once: each one mostly waits on Meta and the
  // database, so four together take about as long as one. Still a tiny
  // fraction of what Meta accepts per number.
  for (let at = 0; at < recipients.length; at += SEND_CONCURRENCY) {
    // Time-box the job so a long run stays resumable across a deploy.
    if (Date.now() - startedAt > MAX_JOB_MS) {
      stopReason = 'JOB_TIME_LIMIT';
      break;
    }

    // Re-read status so Pause/Cancel takes effect within a few messages.
    const current = await prisma.broadcast.findUnique({
      where: { id: broadcastId },
      select: { status: true },
    });
    if (current?.status !== 'SENDING') {
      stopReason = 'USER_STOPPED';
      break;
    }

    const outcomes = await Promise.all(recipients.slice(at, at + SEND_CONCURRENCY).map(sendOne));

    for (const outcome of outcomes) {
      if (outcome.kind === 'sent') {
        sent += 1;
        failureStreak = 0;
      } else if (outcome.kind === 'failed') {
        failed += 1;
        if (!isRecipientSpecific(outcome.meta)) failureStreak += 1;
        if (failureStreak >= FAILURE_STREAK_LIMIT && stopReason === 'AUDIENCE_DRAINED') {
          stopReason = 'CAMPAIGN_PROBLEM';
          stopMessage =
            `The last ${FAILURE_STREAK_LIMIT} messages all failed, so sending was stopped to protect your number. ` +
            `WhatsApp's reason: ${outcome.meta.userMessage}`;
        }
      } else if (stopReason === 'AUDIENCE_DRAINED') {
        stopReason =
          outcome.verdict === 'rate'
            ? 'RATE_LIMITED'
            : outcome.verdict === 'account'
              ? 'ACCOUNT_RESTRICTED'
              : 'CAMPAIGN_PROBLEM';
        stopMessage = outcome.message;
        logger.warn('broadcast.stopped_by_error', { broadcastId, code: outcome.code, verdict: outcome.verdict });
      }
    }

    emitRealtime('broadcast:progress', { broadcastId, sent, failed }, teamId);
    emitDataChanged('broadcasts', broadcastId);

    if (stopReason !== 'AUDIENCE_DRAINED') break;
    if (SEND_GAP_MS > 0) await sleep(SEND_GAP_MS);
  }

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: {
      totalSent: { increment: sent },
      totalFailed: { increment: failed },
      // Messages are flowing again, so an earlier "waiting for…" note is stale.
      ...(sent > 0 && stopReason !== 'RATE_LIMITED' && stopReason !== 'ACCOUNT_RESTRICTED' ? { lastError: null } : {}),
    },
  });

  logger.info('broadcast.slice_complete', { broadcastId, sent, failed, stopReason });

  // ── What happens next ──────────────────────────────────────────────────────
  if (stopReason === 'USER_STOPPED') {
    return { broadcastId, sent, failed, stopped: true };
  }

  if (stopReason === 'RATE_LIMITED') {
    // A throughput limit clears within minutes; a spam limit (131048) takes
    // longer. Either way the campaign carries on by itself.
    await parkUntil(broadcastId, teamId, new Date(Date.now() + 15 * 60_000), 'RATE_LIMITED', stopMessage);
    return { broadcastId, sent, failed, parked: 'RATE_LIMITED' };
  }

  if (stopReason === 'ACCOUNT_RESTRICTED') {
    // Usually something a manager fixes (billing, reconnecting). Check again
    // every half hour so the campaign resumes soon after it is fixed.
    await parkUntil(broadcastId, teamId, new Date(Date.now() + 30 * 60_000), 'ACCOUNT_RESTRICTED', stopMessage);
    return { broadcastId, sent, failed, parked: 'ACCOUNT_RESTRICTED' };
  }

  if (stopReason === 'CAMPAIGN_PROBLEM') {
    await pauseForReview(broadcastId, teamId, stopMessage);
    return { broadcastId, sent, failed, paused: 'CAMPAIGN_PROBLEM' };
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
  /** Shown on the campaign while it waits; routine pauses clear it. */
  message = '',
): Promise<void> {
  const parked = await prisma.broadcast.updateMany({
    where: { id: broadcastId, status: 'SENDING' },
    data: { nextBatchAt: at, queuedAt: null, lastError: message || null },
  });

  if (parked.count > 0) {
    logger.info('broadcast.parked', { broadcastId, reason, resumeAt: at.toISOString() });
    emitRealtime('broadcast:parked', { broadcastId, reason, resumeAt: at.toISOString() }, teamId);
    emitDataChanged('broadcasts', broadcastId);
  }
}

/**
 * Stop a run that cannot succeed as it stands, and say why.
 *
 * Paused (not failed) so nothing is lost: everyone not yet reached is still
 * pending, and Resume carries on from there once the cause is fixed.
 */
async function pauseForReview(broadcastId: string, teamId: string | undefined, reason: string): Promise<void> {
  const paused = await prisma.broadcast.updateMany({
    where: { id: broadcastId, status: 'SENDING' },
    data: {
      status: 'PAUSED',
      nextBatchAt: null,
      queuedAt: null,
      healthPausedAt: new Date(),
      healthPauseReason: reason,
      lastError: reason,
    },
  });
  if (paused.count > 0) {
    logger.warn('broadcast.auto_paused', { broadcastId, reason });
    emitRealtime('broadcast:parked', { broadcastId, reason: 'PAUSED', message: reason }, teamId);
    emitDataChanged('broadcasts', broadcastId);
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
  emitDataChanged('broadcasts', broadcastId);

  return { broadcastId, sent, failed, completed: true };
}
