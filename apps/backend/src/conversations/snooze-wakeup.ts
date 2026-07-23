import { prisma } from '../lib/prisma';
import { emitRealtime } from '../realtime/socket';
import { forEachActiveTenant } from '../tenants/for-each-tenant';
import { logger } from '../lib/logger';

/**
 * Runs every minute. Finds conversations whose snooze has expired and reopens
 * them — swept per tenant so the guard fences each query and the realtime event
 * only reaches that tenant's sockets.
 */
export function startSnoozeWakeupScheduler(): NodeJS.Timeout {
  return setInterval(async () => {
    await forEachActiveTenant(async () => {
      const now = new Date();
      const expired = await prisma.conversation.findMany({
        where: { snoozedUntil: { lte: now }, status: 'ON_HOLD' },
        select: { id: true, teamId: true },
      });

      for (const conv of expired) {
        await prisma.conversation.update({
          where: { id: conv.id },
          data: { status: 'OPEN', snoozedUntil: null },
        });
        emitRealtime(
          'conversation:updated',
          { conversationId: conv.id, status: 'OPEN', snoozedUntil: null },
          conv.teamId,
        );
        logger.info('snooze.wakeup', { conversationId: conv.id });
      }
    });
  }, 60_000); // every 60 seconds
}
