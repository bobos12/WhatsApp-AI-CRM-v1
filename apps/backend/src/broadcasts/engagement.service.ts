import { prisma } from '../lib/prisma';
import { runAsPlatform, runWithTenant } from '../lib/tenant-context';
import { logger } from '../lib/logger';
import { bumpHealthCounter } from './safety/account-health';

/**
 * ─── Engagement reconciliation ───────────────────────────────────────────────
 *
 * Turns "we handed the message to WhatsApp" into "the person read it and wrote
 * back". Three things depend on knowing the difference:
 *
 *   • **Account health.** Reply rate is the clearest evidence that a campaign was
 *     welcome. A number whose broadcasts get answered looks nothing, to WhatsApp,
 *     like one whose broadcasts vanish into silence.
 *   • **Contact quality.** A reply promotes a contact to HOT, which moves them to
 *     the front of the next campaign and shortens their pacing.
 *   • **The campaign report.** "4,812 sent" is vanity. "4,812 sent, 61 replies"
 *     is the number that tells a user whether to run the campaign again.
 *
 * Delivery and read receipts arrive asynchronously on the `messages.update`
 * stream and land on the CRM `Message` row; this joins them back to the
 * broadcast recipient by the message id captured at send time.
 */

/** How far back to look for receipts and replies on each pass. */
const LOOKBACK_HOURS = Number(process.env.BROADCAST_ENGAGEMENT_LOOKBACK_HOURS ?? 72);
/** A reply this long after the message is no longer plausibly a reply to it. */
const REPLY_WINDOW_HOURS = Number(process.env.BROADCAST_REPLY_WINDOW_HOURS ?? 48);
/** Rows touched per pass, so a large backlog is drained over several ticks. */
const PASS_LIMIT = 2_000;

/**
 * Copy delivery/read timestamps from the CRM message onto the recipient row.
 *
 * Only rows that were actually linked at send time participate — a send whose
 * message id was never captured simply has no receipts, which is honest.
 */
async function reconcileReceipts(since: Date): Promise<number> {
  const pending = await prisma.broadcastRecipient.findMany({
    where: {
      status: 'sent',
      messageId: { not: null },
      sentAt: { gte: since },
      OR: [{ deliveredAt: null }, { readAt: null }],
    },
    select: { id: true, messageId: true, deliveredAt: true, readAt: true },
    take: PASS_LIMIT,
  });
  if (!pending.length) return 0;

  const messages = await prisma.message.findMany({
    where: { id: { in: pending.map((row) => row.messageId as string) } },
    select: { id: true, deliveredAt: true, readAt: true },
  });
  const byId = new Map(messages.map((message) => [message.id, message]));

  let updated = 0;
  for (const row of pending) {
    const message = byId.get(row.messageId as string);
    if (!message) continue;

    const data: { deliveredAt?: Date; readAt?: Date } = {};
    if (!row.deliveredAt && message.deliveredAt) data.deliveredAt = message.deliveredAt;
    if (!row.readAt && message.readAt) data.readAt = message.readAt;
    if (!Object.keys(data).length) continue;

    await prisma.broadcastRecipient.update({ where: { id: row.id }, data });
    updated += 1;
  }
  return updated;
}

/**
 * Mark recipients who wrote back after receiving a campaign message.
 *
 * The join is phone → conversation → first inbound message after `sentAt`. Doing
 * it as a sweep rather than inline on the inbound path keeps the hot message
 * pipeline free of broadcast bookkeeping, and a reply that arrives while the
 * campaign is still running is picked up on the next tick either way.
 */
async function reconcileReplies(since: Date): Promise<number> {
  const candidates = await prisma.broadcastRecipient.findMany({
    where: { status: 'sent', repliedAt: null, sentAt: { gte: since } },
    select: { id: true, phone: true, sentAt: true, tenantId: true },
    take: PASS_LIMIT,
  });
  if (!candidates.length) return 0;

  const phones = Array.from(new Set(candidates.map((row) => row.phone)));
  const earliest = candidates.reduce(
    (min, row) => (row.sentAt && row.sentAt < min ? row.sentAt : min),
    new Date(),
  );

  // One query for every inbound message that could possibly match, then paired
  // up in memory. The alternative — a query per recipient — is thousands of round
  // trips for a single campaign.
  const inbound = await prisma.message.findMany({
    where: { phone: { in: phones }, fromMe: false, timestamp: { gte: earliest } },
    select: { phone: true, timestamp: true },
    orderBy: { timestamp: 'asc' },
  });

  const inboundByPhone = new Map<string, Date[]>();
  for (const message of inbound) {
    const list = inboundByPhone.get(message.phone) ?? [];
    list.push(message.timestamp);
    inboundByPhone.set(message.phone, list);
  }

  let replies = 0;
  // Health counters are per-tenant, and this sweep runs across all of them —
  // so the tallies are collected here and applied inside each tenant's own scope
  // below. Bumping from platform scope would write one tenant's replies onto
  // whichever AccountHealthDay row happened to match first.
  const repliesByTenant = new Map<string | null, number>();

  for (const row of candidates) {
    if (!row.sentAt) continue;
    const windowEnd = row.sentAt.getTime() + REPLY_WINDOW_HOURS * 60 * 60 * 1000;
    const match = (inboundByPhone.get(row.phone) ?? []).find(
      (at) => at.getTime() > row.sentAt!.getTime() && at.getTime() <= windowEnd,
    );
    if (!match) continue;

    await prisma.broadcastRecipient.update({ where: { id: row.id }, data: { repliedAt: match } });
    replies += 1;
    repliesByTenant.set(row.tenantId, (repliesByTenant.get(row.tenantId) ?? 0) + 1);
  }

  for (const [tenantId, count] of repliesByTenant) {
    const bump = () => bumpHealthCounter({ broadcastReplies: count });
    await (tenantId ? runWithTenant(tenantId, bump) : runAsPlatform(bump)).catch(() => {});
  }

  return replies;
}

/**
 * One reconciliation pass across every tenant.
 *
 * Runs from the scheduler tick in platform scope, which is what lets a single
 * sweep cover all tenants; the only tenant-scoped write it performs (the health
 * counter) is explicitly re-scoped per tenant above. Cheap enough for every tick
 * because both queries are bounded by `PASS_LIMIT` and an indexed `sentAt` range.
 */
export async function reconcileBroadcastEngagement(): Promise<void> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  try {
    // Sequential, not parallel: both passes write to BroadcastRecipient, and
    // running them together would have two updates racing for the same row.
    const receipts = await reconcileReceipts(since);
    const replies = await reconcileReplies(since);
    if (receipts || replies) {
      logger.info('broadcast.engagement_reconciled', { receipts, replies });
    }
  } catch (error) {
    logger.warn('broadcast.engagement_reconcile_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
