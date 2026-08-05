import { prisma } from '../../lib/prisma';

/**
 * ─── Contact quality ─────────────────────────────────────────────────────────
 *
 * Not every recipient carries the same risk. Messaging someone who wrote to you
 * yesterday is a conversation; messaging a number scraped into a spreadsheet
 * eight months ago is what error 463 exists to punish. The old module treated
 * both identically — a phone string in an array.
 *
 * Each recipient is scored and bucketed into a tier, which then drives three
 * things:
 *
 *   • **Send order.** Warm contacts go first. If a run has to stop early — the
 *     circuit breaker trips, the daily budget runs out, the user cancels — it
 *     stopped having sent to the safest slice of the audience, and the riskiest
 *     names are the ones left unsent.
 *   • **Pacing.** Cold recipients get longer gaps between messages.
 *   • **Pre-flight risk.** An audience that is 95% cold is the single clearest
 *     predictor of a restriction, and the user is told before they send.
 */

export type ContactTier = 'HOT' | 'WARM' | 'COOL' | 'COLD';

export const TIER_ORDER: ContactTier[] = ['HOT', 'WARM', 'COOL', 'COLD'];

export interface ScoredRecipient {
  phone: string;
  contactId: string | null;
  name: string | null;
  tier: ContactTier;
  /** 0–100. Higher means safer and likelier to engage. */
  score: number;
  /** Never wrote to us. The riskiest category regardless of score. */
  isCold: boolean;
  /** Days since the contact last messaged us; null if they never have. */
  daysSinceInbound: number | null;
  /** Days since we last sent this phone a broadcast; null if never. */
  daysSinceLastBroadcast: number | null;
  /** Set when the recipient must be skipped, with the reason why. */
  skipReason: string | null;
}

export interface AudienceQuality {
  recipients: ScoredRecipient[];
  counts: Record<ContactTier, number>;
  /** Deliverable after skips are removed. */
  deliverable: number;
  skipped: ScoredRecipient[];
  coldRatio: number;
  averageScore: number;
  /** Contacts with no CRM record at all — raw numbers pasted into the form. */
  unknownContacts: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A contact who received a broadcast inside this window is skipped.
 *
 * Fatigue is the mechanism behind most opt-outs and blocks: three campaigns in
 * one week from a shop you bought socks from once reads as spam no matter how
 * polite each message is. 48h is deliberately conservative and configurable.
 */
const COOLDOWN_HOURS = Number(process.env.BROADCAST_CONTACT_COOLDOWN_HOURS ?? 48);

function tierFor(daysSinceInbound: number | null, hasConversation: boolean): ContactTier {
  if (daysSinceInbound == null) return hasConversation ? 'COOL' : 'COLD';
  if (daysSinceInbound <= 7) return 'HOT';
  if (daysSinceInbound <= 45) return 'WARM';
  return 'COOL';
}

function scoreFor(input: {
  daysSinceInbound: number | null;
  inboundCount: number;
  hasConversation: boolean;
  daysSinceLastBroadcast: number | null;
  hasName: boolean;
  consented: boolean;
}): number {
  let score = 20; // floor: a valid, non-suppressed number is worth something

  if (input.daysSinceInbound != null) {
    // Recency is the dominant term and decays over roughly three months.
    score += Math.round(45 * Math.max(0, 1 - input.daysSinceInbound / 90));
  }
  // Depth of relationship, saturating — 10 messages is not 10× better than 1.
  score += Math.min(15, input.inboundCount * 3);
  if (input.hasConversation) score += 5;
  if (input.hasName) score += 5;
  if (input.consented) score += 10;

  // Recently messaged by a campaign: still deliverable (the cooldown skip is a
  // separate decision), but lower priority in the send order.
  if (input.daysSinceLastBroadcast != null && input.daysSinceLastBroadcast < 14) {
    score -= Math.round(15 * (1 - input.daysSinceLastBroadcast / 14));
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Score an audience.
 *
 * Three bulk queries regardless of audience size: contacts, their conversations,
 * and the most recent broadcast send per phone. Everything else is arithmetic in
 * memory. A 50,000-recipient campaign costs the same three round trips as a
 * fifty-recipient one.
 */
export async function scoreAudience(
  phones: string[],
  options: { respectCooldown?: boolean } = {},
): Promise<AudienceQuality> {
  const respectCooldown = options.respectCooldown !== false;
  const unique = Array.from(new Set(phones));

  if (!unique.length) {
    return {
      recipients: [],
      counts: { HOT: 0, WARM: 0, COOL: 0, COLD: 0 },
      deliverable: 0,
      skipped: [],
      coldRatio: 0,
      averageScore: 0,
      unknownContacts: 0,
    };
  }

  const now = Date.now();
  const cooldownCutoff = new Date(now - COOLDOWN_HOURS * 60 * 60 * 1000);

  const [contacts, recentSends] = await Promise.all([
    prisma.contact.findMany({
      where: { phone: { in: unique } },
      select: {
        id: true,
        phone: true,
        name: true,
        consentAt: true,
        conversations: {
          select: { id: true, lastInboundAt: true, _count: { select: { messages: true } } },
          orderBy: { lastInboundAt: 'desc' },
          take: 1,
        },
      },
    }),
    // Latest broadcast send per phone. `distinct` + ordered `sentAt` gives one
    // row per number without a correlated subquery.
    prisma.broadcastRecipient.findMany({
      where: { phone: { in: unique }, status: 'sent', sentAt: { not: null } },
      select: { phone: true, sentAt: true },
      orderBy: { sentAt: 'desc' },
      distinct: ['phone'],
    }),
  ]);

  // Inbound evidence, one grouped query rather than a per-contact `_count`.
  //
  // Both the count AND the most recent timestamp, because `lastInboundAt` on the
  // conversation cannot be trusted on its own: it is maintained by the live
  // pipeline and backfilled at migration time, so older conversations routinely
  // carry real inbound messages with a null cursor. Tiering on that column alone
  // classified people who have been talking to this business for months as
  // never having written — which inflates the cold ratio, which raises the risk
  // score, which throttles the campaign. The actual messages are the ground
  // truth, and we are already reading them.
  const conversationIds = contacts.flatMap((contact) => contact.conversations.map((conv) => conv.id));
  const inboundByConversation = new Map<string, { count: number; lastAt: Date | null }>();
  if (conversationIds.length) {
    const grouped = await prisma.message.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: conversationIds }, fromMe: false },
      _count: { _all: true },
      _max: { timestamp: true },
    });
    for (const row of grouped) {
      inboundByConversation.set(row.conversationId, {
        count: row._count._all,
        lastAt: row._max.timestamp ?? null,
      });
    }
  }

  const contactByPhone = new Map(contacts.map((contact) => [contact.phone, contact]));
  const lastBroadcastByPhone = new Map(recentSends.map((row) => [row.phone, row.sentAt as Date]));

  const recipients: ScoredRecipient[] = unique.map((phone) => {
    const contact = contactByPhone.get(phone);
    const conversation = contact?.conversations[0];
    const evidence = conversation ? inboundByConversation.get(conversation.id) : undefined;
    // The later of the two signals wins. A stale null cursor must never be able
    // to overrule an actual message sitting in the database.
    const lastInbound = conversation?.lastInboundAt ?? evidence?.lastAt ?? null;
    const daysSinceInbound = lastInbound ? Math.floor((now - lastInbound.getTime()) / DAY_MS) : null;
    const lastBroadcast = lastBroadcastByPhone.get(phone) ?? null;
    const daysSinceLastBroadcast = lastBroadcast ? Math.floor((now - lastBroadcast.getTime()) / DAY_MS) : null;
    const hasConversation = Boolean(conversation);
    const inboundCount = evidence?.count ?? 0;

    const tier = tierFor(daysSinceInbound, hasConversation);
    const score = scoreFor({
      daysSinceInbound,
      inboundCount,
      hasConversation,
      daysSinceLastBroadcast,
      hasName: Boolean(contact?.name),
      consented: Boolean(contact?.consentAt),
    });

    const inCooldown = respectCooldown && lastBroadcast != null && lastBroadcast > cooldownCutoff;

    return {
      phone,
      contactId: contact?.id ?? null,
      name: contact?.name ?? null,
      tier,
      score,
      isCold: daysSinceInbound == null,
      daysSinceInbound,
      daysSinceLastBroadcast,
      skipReason: inCooldown ? 'COOLDOWN' : null,
    };
  });

  const deliverableList = recipients.filter((recipient) => !recipient.skipReason);
  const counts: Record<ContactTier, number> = { HOT: 0, WARM: 0, COOL: 0, COLD: 0 };
  for (const recipient of deliverableList) counts[recipient.tier] += 1;

  const coldCount = deliverableList.filter((recipient) => recipient.isCold).length;
  const totalScore = deliverableList.reduce((sum, recipient) => sum + recipient.score, 0);

  return {
    recipients,
    counts,
    deliverable: deliverableList.length,
    skipped: recipients.filter((recipient) => recipient.skipReason),
    coldRatio: deliverableList.length ? coldCount / deliverableList.length : 0,
    averageScore: deliverableList.length ? Math.round(totalScore / deliverableList.length) : 0,
    unknownContacts: recipients.filter((recipient) => !recipient.contactId).length,
  };
}

/**
 * Order recipients for delivery: warmest first, and inside a tier, highest score
 * first. Ties break on phone so the order is deterministic — a resumed run
 * continues from where it stopped rather than re-shuffling the remainder.
 */
export function orderForDelivery(recipients: ScoredRecipient[]): ScoredRecipient[] {
  const rank = new Map(TIER_ORDER.map((tier, index) => [tier, index]));
  return [...recipients].sort((a, b) => {
    const tierDelta = (rank.get(a.tier) ?? 9) - (rank.get(b.tier) ?? 9);
    if (tierDelta !== 0) return tierDelta;
    if (b.score !== a.score) return b.score - a.score;
    return a.phone.localeCompare(b.phone);
  });
}

export { COOLDOWN_HOURS };
