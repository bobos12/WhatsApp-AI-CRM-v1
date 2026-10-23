import { prisma } from '../lib/prisma';
import { runAsPlatform, runWithTenant } from '../lib/tenant-context';
import { logger } from '../lib/logger';

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

/**
 * How far back the receipt sweep looks. The webhook applies receipts as they
 * arrive, so only rows linked in the last moments can have missed one. A long
 * window re-read every unread recipient on every tick for days — that alone
 * spent over 1 GB of database egress a day.
 */
const RECEIPT_LOOKBACK_HOURS = Number(process.env.BROADCAST_RECEIPT_LOOKBACK_HOURS ?? 1);
/** A reply this long after the message is no longer plausibly a reply to it. */
const REPLY_WINDOW_HOURS = Number(process.env.BROADCAST_REPLY_WINDOW_HOURS ?? 48);
/** Inbound messages can be stamped slightly before they reach us; re-scan this much. */
const REPLY_SCAN_OVERLAP_MS = 5 * 60 * 1000;
/** Rows touched per pass, so a large backlog is drained over several ticks. */
const PASS_LIMIT = 2_000;

/** Inbound messages up to here have been checked for campaign replies. */
let replyScanWatermark: Date | null = null;

/**
 * Copy delivery/read timestamps from the CRM message onto the recipient row.
 *
 * Receipts are normally applied the moment Meta's webhook arrives; this sweep
 * catches any that arrived before the recipient row was linked. Only rows that
 * were linked at send time participate.
 */
async function reconcileReceipts(since: Date): Promise<number> {
  const pending = await prisma.broadcastRecipient.findMany({
    where: {
      status: 'sent',
      messageId: { not: null },
      sentAt: { gte: since },
      deliveredAt: null,
    },
    select: { id: true, messageId: true, deliveredAt: true, readAt: true },
    take: PASS_LIMIT,
  });
  if (!pending.length) return 0;

  // `messageId` holds the WhatsApp message id (wamid), which the CRM message
  // row stores as `externalId` — matching it against `id` found nothing, so
  // every campaign reported 0 delivered and 0 read.
  const messages = await prisma.message.findMany({
    where: { externalId: { in: pending.map((row) => row.messageId as string) } },
    select: { externalId: true, deliveredAt: true, readAt: true },
  });
  const byId = new Map(messages.map((message) => [message.externalId, message]));

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
 * campaign is still running is picked up on the next pass either way.
 *
 * Starts from the inbound messages that arrived since the last pass, not from
 * the recipients still waiting: most never reply, and re-reading all of them on
 * every pass is what made this sweep expensive.
 */
async function reconcileReplies(): Promise<number> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - REPLY_WINDOW_HOURS * 60 * 60 * 1000);
  const scanFrom = replyScanWatermark
    ? new Date(Math.max(replyScanWatermark.getTime() - REPLY_SCAN_OVERLAP_MS, windowStart.getTime()))
    : windowStart;

  const inbound = await prisma.message.findMany({
    where: { fromMe: false, timestamp: { gt: scanFrom, lte: now } },
    select: { phone: true, timestamp: true },
    orderBy: { timestamp: 'asc' },
    take: PASS_LIMIT,
  });
  // A full page means more is waiting: resume from its last message next pass.
  replyScanWatermark = inbound.length === PASS_LIMIT ? inbound[inbound.length - 1].timestamp : now;
  if (!inbound.length) return 0;

  const phones = Array.from(new Set(inbound.map((message) => message.phone)));
  const candidates = await prisma.broadcastRecipient.findMany({
    where: { status: 'sent', repliedAt: null, phone: { in: phones }, sentAt: { gte: windowStart } },
    select: { id: true, phone: true, sentAt: true, tenantId: true },
  });
  if (!candidates.length) return 0;

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
    const bump = async () => { /* reply counters fed the Baileys health model, which is gone */ };
    await (tenantId ? runWithTenant(tenantId, bump) : runAsPlatform(bump)).catch(() => {});
  }

  return replies;
}

/**
 * One reconciliation pass across every tenant.
 *
 * Runs from the scheduler tick in platform scope, which is what lets a single
 * sweep cover all tenants; the only tenant-scoped write it performs (the health
 * counter) is explicitly re-scoped per tenant above. Each pass reads only what
 * is new: rows sent in the last hour and messages since the previous pass.
 */
export async function reconcileBroadcastEngagement(): Promise<void> {
  const since = new Date(Date.now() - RECEIPT_LOOKBACK_HOURS * 60 * 60 * 1000);
  try {
    // Sequential, not parallel: both passes write to BroadcastRecipient, and
    // running them together would have two updates racing for the same row.
    const receipts = await reconcileReceipts(since);
    const replies = await reconcileReplies();
    if (receipts || replies) {
      logger.info('broadcast.engagement_reconciled', { receipts, replies });
    }
  } catch (error) {
    logger.warn('broadcast.engagement_reconcile_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
