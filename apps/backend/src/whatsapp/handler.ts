import { prisma } from '../lib/prisma';
import { processIncomingMessage } from '../workflow/inbound-workflow';
import { emitRealtime } from '../realtime/socket';
import { emitEvent } from '../realtime/event-bus';
import { logger } from '../lib/logger';
import type { MessageStatus } from '@crm/messaging-schema';

export async function handleIncomingMessages(upsert: any, sock: any) {
  if (!Array.isArray(upsert?.messages)) return;
  if (upsert?.type !== 'notify' && upsert?.type !== 'append') return;
  const sessionId = String(sock?.user?.id || process.env.WHATSAPP_SESSION_ID || 'default').trim();
  await Promise.allSettled(upsert.messages.map((message: any) => processIncomingMessage(message, { sessionId })));
}

/**
 * WhatsApp ack/receipt codes that mean "this send did not work", mapped to a
 * human explanation. `messages.update` carries the raw code in
 * `messageStubParameters`.
 *
 * 463 is the one that matters in practice: WhatsApp time-locks an account from
 * "reaching out" to contacts it considers cold, and Baileys does not attach the
 * tctoken/cstoken privacy fields that would mark a contact as trusted — so a
 * freshly linked number gets its outbound traffic refused even though the socket
 * is perfectly healthy.
 */
const ACK_ERROR_REASONS: Record<string, string> = {
  '403': 'WhatsApp refused the message (403) — the recipient may have blocked this number.',
  '404': 'WhatsApp could not find the recipient (404).',
  '408': 'The message timed out before WhatsApp accepted it (408).',
  '421': 'WhatsApp rejected the recipient (421).',
  '463': 'WhatsApp blocked this as a "cold reachout" (463). A newly linked number is rate-limited from messaging people who have not messaged it first.',
  '475': 'WhatsApp rejected the message payload (475).',
};

/**
 * Record a send that WhatsApp refused, and tell the UI.
 *
 * Without this the row keeps whatever optimistic status the send path wrote
 * (PROVIDER_ACCEPTED — "Baileys queued it"), which reads as success. The whole
 * point is that a refused message must stop looking like a delivered one.
 */
async function markSendFailed(externalId: string, reason: string, errorCode: string): Promise<void> {
  const messages = await prisma.message.findMany({
    where: { externalId } as any,
    select: { id: true, conversationId: true },
  });
  if (messages.length === 0) return;

  logger.warn('whatsapp.send_rejected', { externalId, errorCode, reason });

  await prisma.message.updateMany({
    where: { externalId } as any,
    data: { status: 'FAILED', errorReason: reason },
  });

  const at = new Date().toISOString();
  for (const msg of messages) {
    const conv = await prisma.conversation.findUnique({
      where: { id: msg.conversationId },
      select: { teamId: true },
    });

    emitRealtime('message:status', {
      messageId: msg.id,
      conversationId: msg.conversationId,
      status: 'FAILED',
      error: reason,
    }, conv?.teamId ?? null);

    if (conv?.teamId) {
      emitEvent('message.status_changed', {
        messageId: msg.id,
        conversationId: msg.conversationId,
        status: 'failed',
        at,
      }, conv.teamId);
    }
  }
}

export async function handleMessageStatusUpdates(updates: any[]) {
  for (const update of updates || []) {
    const id = update?.key?.id;
    if (!id) continue;

    // Two different shapes arrive here. `messages.update` nests its payload
    // under `.update` ({ key, update: { status, messageStubParameters } }),
    // while the receipt handler in session-manager hands us a pre-flattened
    // { key, status }. Reading only the flat form silently dropped EVERY
    // `messages.update` event — which is why no outbound message ever recorded a
    // deliveredAt, and why server-side rejections went unnoticed.
    const payload = update?.update ?? update;
    const code: number | undefined = payload?.status;

    // Status 0 is ERROR: WhatsApp actively refused the message. This used to
    // fall through to `undefined` and get skipped, so a refused message sat at
    // PROVIDER_ACCEPTED forever while the UI reported a successful send.
    if (code === 0) {
      const errorCode = String(payload?.messageStubParameters?.[0] ?? '').trim();
      const reason = ACK_ERROR_REASONS[errorCode]
        ?? `WhatsApp rejected the message${errorCode ? ` (error ${errorCode})` : ''}.`;
      await markSendFailed(id, reason, errorCode);
      continue;
    }

    const legacyStatus =
      code === 2 ? 'DELIVERED' :
      code === 3 ? 'READ' :
      code === 1 ? 'SENT' :
      undefined;

    if (!legacyStatus) continue;

    // Normalised schema status for crm:event
    const schemaStatus: MessageStatus =
      legacyStatus === 'DELIVERED' ? 'delivered' :
      legacyStatus === 'READ' ? 'read' :
      'server_confirmed';

    const messages = await prisma.message.findMany({
      where: { externalId: id } as any,
      select: { id: true, conversationId: true },
    });

    if (messages.length === 0) continue;

    const now = new Date();
    await prisma.message.updateMany({
      where: { externalId: id } as any,
      data: {
        status: legacyStatus,
        ...(legacyStatus === 'DELIVERED' ? { deliveredAt: now } : {}),
        ...(legacyStatus === 'READ' ? { readAt: now } : {}),
      },
    });

    for (const msg of messages) {
      const conv = await prisma.conversation.findUnique({
        where: { id: msg.conversationId },
        select: { teamId: true },
      });
      const at = now.toISOString();

      // Legacy event (existing UI subscribers)
      emitRealtime('message:status', {
        messageId: msg.id,
        conversationId: msg.conversationId,
        status: legacyStatus,
      }, conv?.teamId ?? null);

      // New envelope event (Zustand store)
      if (conv?.teamId) {
        emitEvent('message.status_changed', {
          messageId: msg.id,
          conversationId: msg.conversationId,
          status: schemaStatus,
          at,
        }, conv.teamId);
      }
    }
  }
}
