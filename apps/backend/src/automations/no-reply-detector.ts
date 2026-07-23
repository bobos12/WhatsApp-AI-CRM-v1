import { prisma } from '../lib/prisma';
import { triggerFlows } from './flow-executor';
import { forEachActiveTenant } from '../tenants/for-each-tenant';
import { logger } from '../lib/logger';

// How long (ms) with no agent reply before triggering NO_RESPONSE_TIME flows
const NO_REPLY_THRESHOLD_MS = Number(process.env.NO_REPLY_THRESHOLD_MS ?? 30 * 60 * 1000); // 30 min default
const CHECK_INTERVAL_MS = Number(process.env.NO_REPLY_CHECK_INTERVAL_MS ?? 5 * 60 * 1000); // check every 5 min

let timer: ReturnType<typeof setInterval> | null = null;

async function checkNoReplyConversations() {
  // Sweep every tenant in its own scope: the guard fences each query to the
  // tenant, and triggerFlows sends via that tenant's own WhatsApp socket.
  await forEachActiveTenant(async () => {
    const cutoff = new Date(Date.now() - NO_REPLY_THRESHOLD_MS);

    // Find OPEN conversations where last message is INBOUND and older than threshold
    const conversations = await prisma.conversation.findMany({
      where: {
        status: 'OPEN',
        lastMessageAt: { lte: cutoff },
      },
      select: {
        id: true,
        teamId: true,
        contact: { select: { phone: true } },
        messages: {
          where: { direction: 'OUTBOUND' },
          orderBy: { timestamp: 'desc' },
          take: 1,
          select: { timestamp: true },
        },
      },
    });

    for (const conv of conversations) {
      const phone = conv.contact?.phone;
      if (!phone) continue;

      // Skip if there has been an outbound reply after the threshold
      const lastOutbound = conv.messages[0]?.timestamp;
      if (lastOutbound && lastOutbound > cutoff) continue;

      logger.info('no_reply_detector.triggering', { conversationId: conv.id, phone });
      void triggerFlows(phone, '', 'NO_RESPONSE_TIME' as any, conv.teamId ?? undefined).catch(() => {});
    }
  });
}

export function startNoReplyDetector() {
  if (timer) return;
  // Run once immediately, then on interval
  void checkNoReplyConversations();
  timer = setInterval(checkNoReplyConversations, CHECK_INTERVAL_MS);
  logger.info('no_reply_detector.started', { thresholdMs: NO_REPLY_THRESHOLD_MS, checkIntervalMs: CHECK_INTERVAL_MS });
}

export function stopNoReplyDetector() {
  if (timer) { clearInterval(timer); timer = null; }
}
