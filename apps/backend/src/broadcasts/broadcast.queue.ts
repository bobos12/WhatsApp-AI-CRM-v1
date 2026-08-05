import Queue from 'bull';
import { prisma, prismaUnscoped } from '../lib/prisma';
import { runWithTenant, runAsPlatform } from '../lib/tenant-context';
import { providerManager } from '../providers/manager';
import { emitRealtime } from '../realtime/socket';
import { logger } from '../lib/logger';
import { loadMedia, isAudioMediaType, resolveMediaUrl } from '../lib/media';
import { buildPersonalizationVars, personalize } from './personalization';
import interactiveMessageService from '../services/interactive-message.service';
import { bumpHealthCounter, classifySendError, getAccountHealth } from './safety/account-health';
import { SendCircuitBreaker, type BreakerVerdict } from './safety/circuit-breaker';
import { nextDelay, pacingConfig, type PacingProfile } from './safety/pacing';
import { checkQuietHours, nextAllowedTime, type QuietHoursWindow } from './safety/quiet-hours';
import { partitionSuppressed, suppress, withOptOutFooter } from './safety/suppression';
import type { ContactTier } from './safety/contact-quality';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const broadcastQueue = new Queue('broadcast-sends', redisUrl, {
  defaultJobOptions: {
    // One retry, not three. A broadcast job that failed did so because the
    // account or the socket is unhappy; hammering the same run twice more is the
    // opposite of what a struggling number needs. Genuine transients are handled
    // inside the loop by the circuit breaker, which parks the campaign for the
    // scheduler to retry on a sane cadence.
    attempts: 2,
    backoff: { type: 'fixed', delay: 60_000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

/**
 * How long a single job may hold the worker before parking itself.
 *
 * With humanised pacing a large campaign takes hours or days, and a job that
 * runs for six hours is invisible to operators, un-resumable across a deploy,
 * and blocks a concurrency slot. Instead each job delivers a slice and parks;
 * the scheduler picks the campaign back up on the next tick.
 */
const MAX_JOB_MS = Number(process.env.BROADCAST_MAX_JOB_MS ?? 20 * 60_000);

/**
 * Concurrent broadcast jobs across all tenants. The old worker was implicitly
 * serial (Bull's default concurrency of 1), which in a multi-tenant deployment
 * meant one tenant's 5,000-recipient campaign starved every other tenant's
 * campaigns completely.
 */
const WORKER_CONCURRENCY = Number(process.env.BROADCAST_WORKER_CONCURRENCY ?? 4);

/**
 * Per-tenant serialization.
 *
 * Two campaigns from the same tenant run through the *same WhatsApp socket*, so
 * letting them proceed in parallel doubles that number's real outbound rate
 * while each campaign politely observes its own pacing. Every anti-ban guarantee
 * in this module is per-account, so the account is what has to be serialized.
 */
const tenantLocks = new Set<string>();
const PLATFORM_LOCK = '__platform__';

function acquireTenantLock(key: string): boolean {
  if (tenantLocks.has(key)) return false;
  tenantLocks.add(key);
  return true;
}

function releaseTenantLock(key: string): void {
  tenantLocks.delete(key);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Interruptible sleep: wakes early if the campaign is no longer sending. */
async function pacedWait(ms: number, isStillRunning: () => Promise<boolean>): Promise<boolean> {
  const step = 2_000;
  let waited = 0;
  while (waited < ms) {
    await sleep(Math.min(step, ms - waited));
    waited += step;
    // Only re-check on the longer waits — a rest break can be four minutes, and
    // a user pressing Pause should not have to sit through it.
    if (ms > 15_000 && waited % 10_000 < step) {
      if (!(await isStillRunning())) return false;
    }
  }
  return true;
}

interface RecipientRow {
  id: string;
  phone: string;
  tier: string | null;
  variantIndex: number;
  attempts: number;
}

/** Persisted campaign fields the send loop needs. */
interface RunConfig {
  quietHours: QuietHoursWindow;
  timezone: string;
  profile: PacingProfile;
  throttlePerHour: number | null;
  variants: string[];
}

function readRunConfig(broadcast: {
  quietHoursEnabled: boolean;
  quietHoursStart: number;
  quietHoursEnd: number;
  timezone: string;
  pacingProfile: string;
  throttlePerHour: number | null;
  variants: unknown;
  message: string;
}): RunConfig {
  const rawVariants = Array.isArray(broadcast.variants)
    ? (broadcast.variants as unknown[]).filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];

  return {
    quietHours: {
      enabled: broadcast.quietHoursEnabled,
      start: broadcast.quietHoursStart,
      end: broadcast.quietHoursEnd,
    },
    timezone: broadcast.timezone || 'UTC',
    profile: (['CAREFUL', 'BALANCED', 'STEADY'].includes(broadcast.pacingProfile)
      ? broadcast.pacingProfile
      : 'BALANCED') as PacingProfile,
    throttlePerHour: broadcast.throttlePerHour,
    variants: rawVariants.length ? rawVariants : [broadcast.message],
  };
}

/** Reasons a slice ended, for the log and for deciding when to resume. */
type StopReason =
  | 'AUDIENCE_DRAINED'
  | 'BATCH_LIMIT'
  | 'JOB_TIME_LIMIT'
  | 'QUIET_HOURS'
  | 'DAILY_BUDGET'
  | 'HOURLY_THROTTLE'
  | 'PILOT_COMPLETE'
  | 'USER_STOPPED'
  | 'DISCONNECTED'
  | 'BREAKER';

let workerInitialized = false;

export function ensureBroadcastWorker() {
  if (workerInitialized) return;
  workerInitialized = true;

  broadcastQueue.process(WORKER_CONCURRENCY, async (job) => {
    const { broadcastId } = job.data as { broadcastId: string };

    // A Bull job runs detached from any request/boot scope. Resolve the owning
    // tenant unguarded, then run the whole job in that tenant's scope so every
    // query is fenced and the send uses the tenant's own WhatsApp socket.
    const owner = await prismaUnscoped.broadcast.findUnique({
      where: { id: broadcastId },
      select: { tenantId: true },
    });
    // The campaign was deleted before its job was picked up. That is a legitimate
    // outcome now that Delete doubles as Stop, so retire the job quietly instead
    // of throwing — a throw would burn the retry on a row that is never coming
    // back and leave noise in the failed set.
    if (!owner) {
      logger.info('broadcast.job_for_deleted_broadcast', { broadcastId });
      return { broadcastId, deleted: true };
    }

    const lockKey = owner.tenantId ?? PLATFORM_LOCK;
    if (!acquireTenantLock(lockKey)) {
      // Another campaign on this account is mid-flight. Re-arm this one for the
      // scheduler instead of running both through one socket at twice the rate.
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
 * A "slice" ends at whichever of these comes first: the audience is drained, the
 * smart-sending batch size is reached, the job time budget is spent, the
 * recipient's local quiet hours begin, the account's daily or hourly budget runs
 * out, the pilot completes, the user stops the run, or the circuit breaker trips.
 */
async function runSlice(broadcastId: string) {
  const broadcast = await prisma.broadcast.findUnique({ where: { id: broadcastId } });

  // Same race as the owner lookup, one step later: deleted in between.
  if (!broadcast) {
    logger.info('broadcast.job_for_deleted_broadcast', { broadcastId });
    return { broadcastId, deleted: true };
  }

  // The only status a job may run against is SENDING — the claim (manual send,
  // scheduler dispatch, or due-batch poll) sets it before the job is added. Any
  // other value means the row was claimed away: completed, cancelled, paused, or
  // reverted. Bail before touching anyone's WhatsApp, and never re-set SENDING
  // here (that would silently un-cancel a campaign the user just stopped).
  if (broadcast.status !== 'SENDING') {
    logger.info('broadcast.not_sending_skipping', { broadcastId, status: broadcast.status });
    return { broadcastId, sent: broadcast.totalSent, failed: broadcast.totalFailed, skipped: true };
  }

  const teamId = broadcast.teamId ?? undefined;
  const config = readRunConfig(broadcast);

  // ── Connection gate ────────────────────────────────────────────────────────
  //
  // A slice that starts with no live socket is not a failed slice — it is a
  // slice that has not happened yet. Parking keeps every recipient `pending`, so
  // when the number comes back the scheduler picks the campaign up and delivers
  // to them. Running it anyway would burn the whole remaining audience into
  // "failed" rows for messages WhatsApp never received.
  //
  // Short park: reconnection is usually seconds away, and there is no cost to
  // looking again.
  if (providerManager.getStatus().status !== 'connected') {
    await parkUntil(broadcastId, teamId, new Date(Date.now() + 60_000), 'DISCONNECTED');
    return { broadcastId, parked: 'DISCONNECTED' };
  }

  // ── Account gate ───────────────────────────────────────────────────────────
  // Re-read health at the top of every slice, not once per campaign. A campaign
  // running across three days is three days of new evidence, and the whole point
  // of the redesign is that a run started under good conditions does not keep
  // going under bad ones.
  const health = await getAccountHealth();

  if (health.blocked) {
    await parkForHealth(broadcastId, teamId, health.blockedReason ?? 'Account health is critical.');
    return { broadcastId, halted: 'ACCOUNT_BLOCKED' };
  }

  if (health.budget.remainingToday <= 0) {
    await parkUntil(broadcastId, teamId, startOfNextUtcDay(), 'DAILY_BUDGET');
    return { broadcastId, parked: 'DAILY_BUDGET' };
  }

  // ── Quiet hours ────────────────────────────────────────────────────────────
  const resumeAt = nextAllowedTime(config.quietHours, config.timezone);
  if (resumeAt.getTime() > Date.now() + 60_000) {
    await parkUntil(broadcastId, teamId, resumeAt, 'QUIET_HOURS');
    return { broadcastId, parked: 'QUIET_HOURS' };
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  // Derived from the recipient rows rather than the persisted counters: the
  // per-recipient status is written on every send, so this stays accurate even
  // if a crash killed a slice before its running total was saved.
  const [sentSoFar, failedSoFar, skippedSoFar, pendingCount] = await Promise.all([
    prisma.broadcastRecipient.count({ where: { broadcastId, status: 'sent' } }),
    prisma.broadcastRecipient.count({ where: { broadcastId, status: 'failed' } }),
    prisma.broadcastRecipient.count({ where: { broadcastId, status: 'skipped' } }),
    prisma.broadcastRecipient.count({ where: { broadcastId, status: 'pending' } }),
  ]);
  const total = sentSoFar + failedSoFar + skippedSoFar + pendingCount;

  let sent = sentSoFar;
  let failed = failedSoFar;
  let skipped = skippedSoFar;

  if (pendingCount === 0) {
    await finishCampaign(broadcastId, teamId, { sent, failed, skipped, total });
    return { broadcastId, sent, failed, done: true };
  }

  // ── Slice size ─────────────────────────────────────────────────────────────
  // The smallest of: what's left, the batch size, today's remaining budget, and
  // this hour's throttle. Whichever binds first is the one that ends the slice.
  const pacing = pacingConfig(config.profile);
  const hourlyCeiling = Math.min(config.throttlePerHour ?? pacing.maxPerHour, health.budget.hourlyLimit);
  const batchCeiling = broadcast.smartSending && broadcast.batchSize ? broadcast.batchSize : Number.MAX_SAFE_INTEGER;

  // The pilot is a hold point, not a size: deliver up to `pilotSize` and stop for
  // a health re-check before the rest of the audience is committed.
  const inPilot = broadcast.pilotSize != null && broadcast.pilotCompletedAt == null;
  const pilotCeiling = inPilot ? Math.max(0, (broadcast.pilotSize ?? 0) - sent) : Number.MAX_SAFE_INTEGER;

  const sliceLimit = Math.max(
    1,
    Math.min(pendingCount, batchCeiling, health.budget.remainingToday, hourlyCeiling, pilotCeiling),
  );

  // ── Media ──────────────────────────────────────────────────────────────────
  const mediaType = broadcast.mediaType;
  const isVoiceBroadcast = isAudioMediaType(mediaType);
  const media = broadcast.mediaUrl
    ? await loadMedia(broadcast.mediaUrl, mediaType, broadcast.mediaFilename)
    : null;

  if (broadcast.mediaUrl && !media) {
    // The attachment is gone. Sending the caption alone would silently turn an
    // image campaign into a text blast, so fail loudly instead.
    const message = 'Broadcast attachment could not be loaded — it may have been deleted from storage.';
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: 'FAILED', lastError: message, nextBatchAt: null },
    });
    emitRealtime('broadcast:complete', { broadcastId, sent, failed, total, status: 'FAILED' }, teamId);
    throw new Error(message);
  }

  // ── The slice's candidates, in delivery order ──────────────────────────────
  //
  // Over-fetched on purpose. Quiet hours are evaluated per recipient, so a slice
  // limited to exactly `sliceLimit` rows would stall completely whenever the
  // front of the delivery order happens to sit in a night-time region — those
  // rows get skipped, stay pending, and the next slice fetches the very same
  // ones, while perfectly reachable recipients further down are never considered.
  // Taking a wider candidate window and capping *deliveries* at `sliceLimit`
  // keeps the campaign moving through whoever is currently awake, without ever
  // exceeding the budget the slice was allowed.
  const candidateLimit = Math.min(config.quietHours.enabled ? sliceLimit * 4 : sliceLimit, 2_000);
  const batch: RecipientRow[] = await prisma.broadcastRecipient.findMany({
    where: { broadcastId, status: 'pending' },
    select: { id: true, phone: true, tier: true, variantIndex: true, attempts: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    take: Math.max(sliceLimit, candidateLimit),
  });

  if (!batch.length) {
    await finishCampaign(broadcastId, teamId, { sent, failed, skipped, total });
    return { broadcastId, sent, failed, done: true };
  }

  // ── Late suppression sweep ─────────────────────────────────────────────────
  // Someone in this slice may have replied STOP while an earlier slice was
  // running. Checking at audience-build time only is not enough for a campaign
  // that takes days — the whole reason a customer types STOP is that the
  // messages have already started.
  const { suppressed } = await partitionSuppressed(batch.map((recipient) => recipient.phone));
  const deliverable = batch.filter((recipient) => !suppressed.has(recipient.phone));

  if (suppressed.size) {
    await prisma.broadcastRecipient.updateMany({
      where: { broadcastId, phone: { in: Array.from(suppressed.keys()) } },
      data: { status: 'skipped', skipReason: 'OPTED_OUT' },
    });
    skipped += suppressed.size;
    logger.info('broadcast.skipped_opted_out_mid_run', { broadcastId, count: suppressed.size });
  }

  // Stamp the first-send time once, guarded so a cancel racing this instant wins.
  await prisma.broadcast.updateMany({
    where: { id: broadcastId, status: 'SENDING' },
    data: { sentAt: broadcast.sentAt ?? new Date(), lastError: null, healthPausedAt: null, healthPauseReason: null },
  });

  // ── Personalization inputs, one query ──────────────────────────────────────
  const contacts = await prisma.contact.findMany({
    where: { phone: { in: deliverable.map((recipient) => recipient.phone) } },
  });
  const contactByPhone = new Map(contacts.map((contact) => [contact.phone, contact]));
  const contactIdByPhone = new Map(contacts.map((contact) => [contact.phone, contact.id]));

  const interactiveContent = broadcast.interactiveContent as
    | { kind: string; [key: string]: unknown }
    | null
    | undefined;

  // ── Send loop ──────────────────────────────────────────────────────────────
  const breaker = new SendCircuitBreaker();
  const startedAt = Date.now();
  let slowdown = 1;
  let stopReason: StopReason = 'AUDIENCE_DRAINED';
  let breakerVerdict: BreakerVerdict | null = null;
  let deliveredThisSlice = 0;
  let coldThisSlice = 0;
  /**
   * Earliest moment any quiet-skipped recipient becomes reachable.
   *
   * Without this a campaign whose audience is entirely in a night-time region —
   * a Dubai business messaging Tokyo, say — passes the campaign-zone quiet check
   * at the top of the slice, then skips every single recipient inside the loop,
   * delivers nothing, and re-queues itself a minute later. Forever, until their
   * morning. Parking on the real wake-up time turns that spin into one wait.
   */
  let earliestQuietResume: Date | null = null;
  let quietSkips = 0;

  const isStillRunning = async (): Promise<boolean> => {
    const current = await prisma.broadcast.findUnique({ where: { id: broadcastId }, select: { status: true } });
    return current?.status === 'SENDING';
  };

  for (let i = 0; i < deliverable.length; i++) {
    const recipient = deliverable[i];

    // Re-check the campaign between sends. Anything other than SENDING — the
    // user pressed Pause or Cancel, or another process reverted it — stops this
    // slice. A row that is *gone* stops it just as firmly: Delete doubles as
    // Stop, so a missing campaign means the user pulled the plug mid-send and we
    // must not keep messaging people on behalf of something that no longer
    // exists.
    if (!(await isStillRunning())) {
      stopReason = 'USER_STOPPED';
      break;
    }

    // Quiet hours are per-recipient: a campaign that is fine to deliver in Dubai
    // at 8pm must not reach London at 4pm and then Los Angeles at 8am… or Tokyo
    // at 1am. A recipient whose local night has begun is left pending for the
    // next slice rather than skipped.
    if (config.quietHours.enabled) {
      const quiet = checkQuietHours(recipient.phone, config.quietHours, config.timezone);
      if (quiet.quiet) {
        quietSkips += 1;
        if (quiet.resumesAt && (!earliestQuietResume || quiet.resumesAt < earliestQuietResume)) {
          earliestQuietResume = quiet.resumesAt;
        }
        continue;
      }
    }

    // The slice's real budget: candidates were over-fetched to work around quiet
    // hours, but only `sliceLimit` of them may actually be delivered.
    if (deliveredThisSlice >= sliceLimit) {
      stopReason = 'BATCH_LIMIT';
      break;
    }

    // Time-box the job so a slow, humanised run does not hold a worker slot for
    // hours and stays resumable across a deploy.
    if (Date.now() - startedAt > MAX_JOB_MS) {
      stopReason = 'JOB_TIME_LIMIT';
      break;
    }

    const tier = (recipient.tier as ContactTier | null) ?? 'COOL';
    const variant = config.variants[recipient.variantIndex % config.variants.length] ?? broadcast.message;
    const vars = buildPersonalizationVars(contactByPhone.get(recipient.phone), recipient.phone);
    // The opt-out line is appended at send time, not stored on the campaign, so
    // it survives edits and applies to every variant without the user having to
    // remember it.
    const personalizedMessage = withOptOutFooter(personalize(variant, vars));

    // The CRM message id, captured so delivery/read receipts and replies can be
    // joined back to this recipient later. See engagement.service.ts.
    let messageId: string | null = null;

    try {
      if (interactiveContent?.kind) {
        const personalizedInteractive = {
          ...interactiveContent,
          // The opt-out line goes into the interactive body too. A campaign with
          // buttons is still a campaign, and the recipient's only alternative to
          // an unsubscribe route is still the Block button.
          body: withOptOutFooter(
            personalize(typeof interactiveContent.body === 'string' ? interactiveContent.body : '', vars),
          ),
        };
        try {
          const { getOrCreateConversationByPhone } = await import('../conversations/conversation-resolver');
          const { conversation } = await getOrCreateConversationByPhone(recipient.phone);
          const { sendInteractiveViaBaileys } = await import('../whatsapp/sender');
          const result = await sendInteractiveViaBaileys(
            recipient.phone,
            personalizedInteractive as any,
            conversation.id,
          );
          messageId = result?.id ?? null;
        } catch (interactiveErr) {
          // If native send fails, fall back to numbered-text so the message still goes out.
          logger.warn('broadcast.interactive_native_failed_using_text_fallback', {
            broadcastId,
            error: interactiveErr instanceof Error ? interactiveErr.message : String(interactiveErr),
          });
          await interactiveMessageService.send(recipient.phone, personalizedInteractive as any);
        }
      } else if (media) {
        // Image / video / document broadcast — the personalized text rides as the
        // caption. Voice notes ship as a WhatsApp audio message (ptt): no caption.
        const result = await providerManager.sendMessage({
          phone: recipient.phone,
          text: '',
          media: {
            buffer: media.buffer,
            mimetype: media.mimetype,
            filename: media.filename,
            caption: isVoiceBroadcast ? undefined : personalizedMessage,
            isVoiceNote: isVoiceBroadcast,
            url: resolveMediaUrl(broadcast.mediaUrl) ?? undefined,
          },
        });
        messageId = result?.messageId ?? null;
      } else {
        const result = await providerManager.sendMessage({ phone: recipient.phone, text: personalizedMessage });
        messageId = result?.messageId ?? null;
      }

      await prisma.broadcastRecipient.update({
        where: { id: recipient.id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          attempts: recipient.attempts + 1,
          contactId: contactIdByPhone.get(recipient.phone) ?? null,
          messageId,
          errorCode: null,
          lastError: null,
        },
      });
      sent += 1;
      deliveredThisSlice += 1;
      if (tier === 'COLD') coldThisSlice += 1;
      breaker.recordSuccess();
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const classified = classifySendError(error);

      logger.warn('broadcast.send_failed', {
        broadcastId,
        phone: recipient.phone,
        code: classified.code,
        error: raw,
      });

      // A transport-level pause (socket down, quota) is not the recipient's
      // fault. Leaving them `pending` is what lets the campaign resume and
      // deliver to them instead of reporting a delivery that never happened.
      const transient = classified.code === 'DISCONNECTED' || classified.code === 'QUOTA' || classified.code === 'RATE_LIMITED';

      if (!transient) {
        await prisma.broadcastRecipient.update({
          where: { id: recipient.id },
          data: {
            status: 'failed',
            attempts: recipient.attempts + 1,
            errorCode: classified.code,
            lastError: raw.slice(0, 500),
            contactId: contactIdByPhone.get(recipient.phone) ?? null,
          },
        });
        failed += 1;
      }

      // A number that is not on WhatsApp, or that has blocked us, must never be
      // retried by a future campaign. Every retry is another strike.
      if (classified.suppress) {
        await suppress(recipient.phone, classified.suppress, {
          detail: raw.slice(0, 200),
          source: 'send_error',
        }).catch(() => {});
      }

      breakerVerdict = breaker.recordFailure(classified.code);
      if (breakerVerdict.action === 'SLOW_DOWN') {
        slowdown = Math.max(slowdown, breakerVerdict.slowdown);
      } else if (breakerVerdict.action === 'PAUSE' || breakerVerdict.action === 'HALT') {
        stopReason = 'BREAKER';
        break;
      }
    }

    emitRealtime(
      'broadcast:progress',
      {
        broadcastId,
        sent,
        failed,
        skipped,
        total,
        rate: breaker.stats.failureRate,
        profile: config.profile,
      },
      teamId,
    );

    // Pace before the next recipient. The wait is interruptible so Pause and
    // Cancel land within a couple of seconds even inside a four-minute rest.
    // Skipped when this was the slice's last delivery — there is nothing after it
    // to space out, and a four-minute rest before parking is pure dead time.
    if (i < deliverable.length - 1 && deliveredThisSlice < sliceLimit) {
      const decision = nextDelay({
        config: pacing,
        index: i,
        messageLength: personalizedMessage.length,
        tier,
        slowdown,
      });
      const completed = await pacedWait(decision.delayMs, isStillRunning);
      if (!completed) {
        stopReason = 'USER_STOPPED';
        break;
      }
    }
  }

  // ── Health accounting ──────────────────────────────────────────────────────
  const stats = breaker.stats;
  await bumpHealthCounter({
    broadcastSent: deliveredThisSlice,
    broadcastFailed: stats.failures,
    coldSent: coldThisSlice,
    hardBlocks: stats.blockCount,
    coldReachoutBlocks: stats.coldReachoutCount,
  }).catch(() => {});

  // ── Decide what happens next ───────────────────────────────────────────────
  const remaining = await prisma.broadcastRecipient.count({ where: { broadcastId, status: 'pending' } });

  if (stopReason === 'USER_STOPPED') {
    const current = await prisma.broadcast.findUnique({ where: { id: broadcastId }, select: { status: true } });
    logger.info('broadcast.slice_stopped', { broadcastId, status: current?.status ?? 'DELETED', sent });
    await prisma.broadcast.updateMany({
      where: { id: broadcastId },
      data: { totalSent: sent, totalFailed: failed },
    });
    return { broadcastId, sent, failed, stopped: current?.status ?? 'DELETED' };
  }

  if (stopReason === 'BREAKER' && breakerVerdict) {
    if (breakerVerdict.action === 'HALT') {
      await haltCampaign(broadcastId, teamId, breakerVerdict.reason ?? 'Sending was stopped to protect the account.', {
        sent,
        failed,
        total,
      });
      return { broadcastId, sent, failed, halted: breakerVerdict.code };
    }
    await parkForHealth(broadcastId, teamId, breakerVerdict.reason ?? 'Sending was paused.', { sent, failed });
    return { broadcastId, sent, failed, paused: breakerVerdict.code };
  }

  if (remaining === 0) {
    await finishCampaign(broadcastId, teamId, { sent, failed, skipped, total });
    return { broadcastId, sent, failed, done: true };
  }

  // Pilot slice finished with audience left: hold for review rather than
  // releasing the rest automatically. This is the one deliberate stop in the
  // system — everything else resumes on its own.
  if (inPilot && sent >= (broadcast.pilotSize ?? 0)) {
    await completePilot(broadcastId, teamId, { sent, failed, total, remaining });
    return { broadcastId, sent, failed, pilot: 'COMPLETE' };
  }

  // Nothing went out and every candidate was inside someone's night: wait for the
  // first of those windows to open rather than re-running the same empty slice.
  if (deliveredThisSlice === 0 && quietSkips > 0 && earliestQuietResume) {
    await parkUntil(broadcastId, teamId, earliestQuietResume, 'QUIET_HOURS', { sent, failed });
    return { broadcastId, sent, failed, parked: 'QUIET_HOURS', nextBatchAt: earliestQuietResume };
  }

  // More to send. Park until the next window opens: the batch interval, the
  // hourly throttle refilling, quiet hours ending, or tomorrow's budget.
  const resumeAtNext = await computeResumeTime(broadcast, config, stopReason, deliveredThisSlice);
  await parkUntil(broadcastId, teamId, resumeAtNext, stopReason, { sent, failed });
  return { broadcastId, sent, failed, parked: stopReason, nextBatchAt: resumeAtNext };
}

// ─── State transitions ────────────────────────────────────────────────────────

function startOfNextUtcDay(): Date {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  // A minute past midnight, so the daily rollup has definitely rolled over.
  return new Date(next.getTime() + 60_000);
}

/** When should the next slice run? */
async function computeResumeTime(
  broadcast: { smartSending: boolean; batchIntervalMinutes: number | null },
  config: RunConfig,
  reason: StopReason,
  delivered: number,
): Promise<Date> {
  const now = Date.now();

  if (reason === 'DAILY_BUDGET') return startOfNextUtcDay();

  // Explicit batch interval always wins — the user asked for that cadence.
  if (broadcast.smartSending && broadcast.batchIntervalMinutes) {
    const candidate = new Date(now + broadcast.batchIntervalMinutes * 60_000);
    return nextAllowedTime(config.quietHours, config.timezone, candidate);
  }

  // Otherwise pace the *gap between slices* off how much of the hourly budget
  // this slice consumed, so throughput stays inside the ceiling instead of
  // sprinting to it and idling.
  const pacing = pacingConfig(config.profile);
  const hourly = Math.max(1, config.throttlePerHour ?? pacing.maxPerHour);
  const hoursConsumed = delivered / hourly;
  const gapMs = Math.max(60_000, Math.min(60 * 60_000, hoursConsumed * 3_600_000));
  return nextAllowedTime(config.quietHours, config.timezone, new Date(now + gapMs));
}

async function parkUntil(
  broadcastId: string,
  teamId: string | undefined,
  at: Date,
  reason: StopReason,
  totals?: { sent: number; failed: number },
): Promise<void> {
  // Guarded so a Pause/Cancel that landed during the slice is not overwritten.
  const parked = await prisma.broadcast.updateMany({
    where: { id: broadcastId, status: 'SENDING' },
    data: {
      nextBatchAt: at,
      queuedAt: null,
      lastError: null,
      ...(totals ? { totalSent: totals.sent, totalFailed: totals.failed } : {}),
    },
  });
  if (parked.count !== 1) return;

  logger.info('broadcast.slice_parked', { broadcastId, reason, nextBatchAt: at.toISOString() });
  emitRealtime(
    'broadcast:progress',
    { broadcastId, ...(totals ?? {}), nextBatchAt: at.toISOString(), pauseReason: reason },
    teamId,
  );
}

/** Auto-pause because the account, not the user, said stop. */
async function parkForHealth(
  broadcastId: string,
  teamId: string | undefined,
  reason: string,
  totals?: { sent: number; failed: number },
): Promise<void> {
  const paused = await prisma.broadcast.updateMany({
    where: { id: broadcastId, status: 'SENDING' },
    data: {
      status: 'PAUSED',
      nextBatchAt: null,
      queuedAt: null,
      healthPausedAt: new Date(),
      healthPauseReason: reason,
      ...(totals ? { totalSent: totals.sent, totalFailed: totals.failed } : {}),
    },
  });
  if (paused.count !== 1) return;

  logger.warn('broadcast.auto_paused', { broadcastId, reason });
  emitRealtime('broadcast:paused', { broadcastId, reason, automatic: true }, teamId);
}

/** Stop for good: WhatsApp is refusing this account's traffic. */
async function haltCampaign(
  broadcastId: string,
  teamId: string | undefined,
  reason: string,
  totals: { sent: number; failed: number; total: number },
): Promise<void> {
  await prisma.broadcast.updateMany({
    where: { id: broadcastId, status: 'SENDING' },
    data: {
      status: 'PAUSED',
      nextBatchAt: null,
      queuedAt: null,
      healthPausedAt: new Date(),
      healthPauseReason: reason,
      lastError: reason,
      totalSent: totals.sent,
      totalFailed: totals.failed,
    },
  });

  logger.error('broadcast.halted_for_account_safety', { broadcastId, reason, ...totals });
  emitRealtime('broadcast:halted', { broadcastId, reason, ...totals }, teamId);
}

/** Pilot delivered — hold and let the operator (and health) look. */
async function completePilot(
  broadcastId: string,
  teamId: string | undefined,
  totals: { sent: number; failed: number; total: number; remaining: number },
): Promise<void> {
  const held = await prisma.broadcast.updateMany({
    where: { id: broadcastId, status: 'SENDING' },
    data: {
      status: 'PAUSED',
      pilotCompletedAt: new Date(),
      nextBatchAt: null,
      queuedAt: null,
      totalSent: totals.sent,
      totalFailed: totals.failed,
      healthPauseReason:
        `Pilot batch delivered to ${totals.sent} contact(s). Check for replies and blocks, then resume to send to ` +
        `the remaining ${totals.remaining}.`,
    },
  });
  if (held.count !== 1) return;

  logger.info('broadcast.pilot_complete', { broadcastId, ...totals });
  emitRealtime('broadcast:pilot', { broadcastId, ...totals }, teamId);
}

async function finishCampaign(
  broadcastId: string,
  teamId: string | undefined,
  totals: { sent: number; failed: number; skipped: number; total: number },
): Promise<void> {
  // A campaign where everything was skipped (all opted out) is not a failure —
  // it did exactly what it should. Only a campaign that tried and never
  // succeeded is FAILED.
  const attempted = totals.sent + totals.failed;
  const finalStatus = attempted > 0 && totals.sent === 0 ? 'FAILED' : 'SENT';

  await prisma.broadcast.updateMany({
    where: { id: broadcastId, status: 'SENDING' },
    data: {
      status: finalStatus,
      totalSent: totals.sent,
      totalFailed: totals.failed,
      nextBatchAt: null,
      queuedAt: null,
      lastError:
        finalStatus === 'FAILED'
          ? 'Every recipient failed. Check the WhatsApp connection and the campaign report.'
          : null,
    },
  });

  emitRealtime('broadcast:complete', { broadcastId, ...totals, status: finalStatus }, teamId);
}
