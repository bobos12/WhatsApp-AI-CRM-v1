import Queue from 'bull';
import { prisma, prismaUnscoped } from '../lib/prisma';
import { runWithTenant, runAsPlatform } from '../lib/tenant-context';
import { providerManager } from '../providers/manager';
import { emitRealtime } from '../realtime/socket';
import { logger } from '../lib/logger';
import { loadMedia, isAudioMediaType, resolveMediaUrl } from '../lib/media';
import { buildPersonalizationVars, personalize } from './personalization';
import interactiveMessageService from '../services/interactive-message.service';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const broadcastQueue = new Queue('broadcast-sends', redisUrl, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100,
  },
});

// Min and max ms to wait between each recipient send (anti-ban)
const SEND_DELAY_MIN = Number(process.env.BROADCAST_DELAY_MIN_MS ?? 1500);
const SEND_DELAY_MAX = Number(process.env.BROADCAST_DELAY_MAX_MS ?? 4000);

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let workerInitialized = false;

export function ensureBroadcastWorker() {
  if (workerInitialized) return;
  workerInitialized = true;

  broadcastQueue.process(async (job) => {
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
    // of throwing — a throw would burn three retries on a row that is never
    // coming back and leave noise in the failed set.
    if (!owner) {
      logger.info('broadcast.job_for_deleted_broadcast', { broadcastId });
      return { broadcastId, deleted: true };
    }
    const runScoped = <T>(fn: () => Promise<T>): Promise<T> =>
      owner.tenantId ? runWithTenant(owner.tenantId, fn) : runAsPlatform(fn);

    return runScoped(async () => {
    const broadcast = await prisma.broadcast.findUnique({
      where: { id: broadcastId },
      include: { recipients: true },
    });

    // Same race as above, one step later: deleted between resolving the owner and
    // reading the campaign.
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

    // Stamp the first-send time once, guarded so a cancel racing this instant wins.
    await prisma.broadcast.updateMany({
      where: { id: broadcastId, status: 'SENDING' },
      data: { sentAt: broadcast.sentAt ?? new Date(), lastError: null },
    });

    // Totals are cumulative across batches. Derive them from the recipient rows
    // rather than the persisted counters: the per-recipient status is written on
    // every send, so this stays accurate even if a crash killed a batch before its
    // running total was saved.
    let sent = broadcast.recipients.filter((r) => r.status === 'sent').length;
    let failed = broadcast.recipients.filter((r) => r.status === 'failed').length;
    const total = broadcast.recipients.length;

    // One batch per job. For a plain (non-smart) send the batch is the whole
    // remaining audience, so the loop below drains it in a single run exactly as
    // before. For smart sending it is the next `batchSize` untried recipients.
    const pending = broadcast.recipients.filter((r) => r.status === 'pending');
    const batchLimit = broadcast.smartSending && broadcast.batchSize ? broadcast.batchSize : pending.length;
    const batch = pending.slice(0, batchLimit);
    const remainingAfterBatch = pending.length - batch.length;

    const mediaType = broadcast.mediaType;
    const isVoiceBroadcast = isAudioMediaType(mediaType);

    // The same file goes to every recipient — read it once, reuse the buffer.
    // Reading happens off disk for local storage, so a send never depends on the
    // API being able to reach its own public URL.
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
      emitRealtime('broadcast:complete', { broadcastId, sent: 0, failed: total, total, status: 'FAILED' }, broadcast.teamId ?? undefined);
      throw new Error(message);
    }

    // One query for every recipient's contact record, instead of one per send.
    // Also feeds custom-field personalization tokens like {{cf_city}}.
    const contacts = await prisma.contact.findMany({
      where: { phone: { in: broadcast.recipients.map((r) => r.phone) } },
    });
    const contactByPhone = new Map(contacts.map((contact) => [contact.phone, contact]));

    const interactiveContent = broadcast.interactiveContent as
      | { kind: string; [key: string]: unknown }
      | null
      | undefined;

    for (let i = 0; i < batch.length; i++) {
      const recipient = batch[i];

      // Re-check the campaign between sends. Anything other than SENDING — the
      // user pressed Pause or Cancel, or another process reverted it — stops this
      // batch. A row that is *gone* stops it just as firmly: Delete doubles as
      // Stop, so a missing campaign means the user pulled the plug mid-send and
      // we must not keep messaging people on behalf of something that no longer
      // exists. (Treating null as "carry on" was the bug that made deleting a
      // live broadcast impossible to do safely.)
      //
      // We persist the running totals but never write the status here, so the
      // user's choice stands.
      const current = await prisma.broadcast.findUnique({
        where: { id: broadcastId },
        select: { status: true },
      });
      if (!current || current.status !== 'SENDING') {
        const stoppedAs = current?.status ?? 'DELETED';
        logger.info('broadcast.batch_stopped', { broadcastId, status: stoppedAs, sentSoFar: sent });
        // updateMany, not update: the row may already be deleted, and a
        // missing-row throw here would fail the job and retry into the same void.
        await prisma.broadcast.updateMany({
          where: { id: broadcastId },
          data: { totalSent: sent, totalFailed: failed },
        });
        return { broadcastId, sent, failed, stopped: stoppedAs };
      }

      const vars = buildPersonalizationVars(contactByPhone.get(recipient.phone), recipient.phone);
      const personalizedMessage = personalize(broadcast.message, vars);

      try {
        if (interactiveContent?.kind) {
          // Personalize the body field inside the interactive payload
          const personalizedInteractive = {
            ...interactiveContent,
            body: personalize(
              typeof interactiveContent.body === 'string' ? interactiveContent.body : '',
              vars,
            ),
          };
          // Use native Baileys interactive send (real buttons/list/CTA) instead of text fallback.
          // We need a conversationId — resolve or create one for this phone.
          try {
            const { getOrCreateConversationByPhone } = await import('../conversations/conversation-resolver');
            const { conversation } = await getOrCreateConversationByPhone(recipient.phone);
            const { sendInteractiveViaBaileys } = await import('../whatsapp/sender');
            await sendInteractiveViaBaileys(recipient.phone, personalizedInteractive as any, conversation.id);
          } catch (interactiveErr) {
            // If native send fails, fall back to numbered-text so the message still goes out.
            logger.warn('broadcast.interactive_native_failed_using_text_fallback', {
              broadcastId,
              phone: recipient.phone,
              error: interactiveErr instanceof Error ? interactiveErr.message : String(interactiveErr),
            });
            await interactiveMessageService.send(recipient.phone, personalizedInteractive as any);
          }
        } else if (media) {
          // Image / video / document broadcast — the personalized text rides as the
          // caption. Voice notes ship as a WhatsApp audio message (ptt): no caption.
          // Pass `url` so the persisted CRM message points at the stored file and
          // renders/plays in chat (without it, media shows as "unavailable").
          await providerManager.sendMessage({
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
        } else {
          await providerManager.sendMessage({ phone: recipient.phone, text: personalizedMessage });
        }
        await prisma.broadcastRecipient.updateMany({
          where: { broadcastId, phone: recipient.phone },
          data: { status: 'sent' },
        });
        sent += 1;
      } catch (error) {
        logger.warn('broadcast.send_failed', {
          broadcastId,
          phone: recipient.phone,
          error: error instanceof Error ? error.message : String(error),
        });
        await prisma.broadcastRecipient.updateMany({
          where: { broadcastId, phone: recipient.phone },
          data: { status: 'failed' },
        });
        failed += 1;
      }

      emitRealtime('broadcast:progress', { broadcastId, sent, failed, total }, broadcast.teamId ?? undefined);

      // Anti-ban: randomized delay between sends (skip after the last in the batch)
      if (i < batch.length - 1) {
        await randomDelay(SEND_DELAY_MIN, SEND_DELAY_MAX);
      }
    }

    // ── Batch finished ──────────────────────────────────────────────────────
    // More audience left and smart sending is on: park the campaign until the
    // interval elapses. `nextBatchAt` is the only thing that has to persist for
    // the scheduler to resume this on the next tick — even across a restart. The
    // status stays SENDING so the list still reads "Sending…", now waiting.
    if (remainingAfterBatch > 0 && broadcast.smartSending) {
      const intervalMinutes = broadcast.batchIntervalMinutes ?? 30;
      const nextBatchAt = new Date(Date.now() + intervalMinutes * 60_000);
      // Guarded so a Pause/Cancel that landed during this batch is not overwritten.
      const parked = await prisma.broadcast.updateMany({
        where: { id: broadcastId, status: 'SENDING' },
        data: { totalSent: sent, totalFailed: failed, nextBatchAt, queuedAt: null, lastError: null },
      });
      if (parked.count === 1) {
        logger.info('broadcast.batch_parked', { broadcastId, sent, failed, remaining: remainingAfterBatch, nextBatchAt });
        emitRealtime(
          'broadcast:progress',
          { broadcastId, sent, failed, total, nextBatchAt: nextBatchAt.toISOString() },
          broadcast.teamId ?? undefined,
        );
      }
      return { broadcastId, sent, failed, parked: true, nextBatchAt };
    }

    // ── Campaign finished ───────────────────────────────────────────────────
    const finalStatus = sent === 0 ? 'FAILED' : 'SENT';
    await prisma.broadcast.updateMany({
      where: { id: broadcastId, status: 'SENDING' },
      data: {
        status: finalStatus,
        totalSent: sent,
        totalFailed: failed,
        nextBatchAt: null,
        queuedAt: null,
        lastError: finalStatus === 'FAILED' ? 'Every recipient failed. Check the WhatsApp connection.' : null,
      },
    });

    emitRealtime('broadcast:complete', { broadcastId, sent, failed, total, status: finalStatus }, broadcast.teamId ?? undefined);
    return { broadcastId, sent, failed };
    });
  });
}
