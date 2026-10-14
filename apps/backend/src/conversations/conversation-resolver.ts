import type { Contact } from '@prisma/client';
import { prisma, type GuardedPrisma } from '../lib/prisma';
import { normalizePhone, phoneFingerprint } from '../lib/phone';

// The tenant-guarded client. Every query it runs is scoped to the tenant in the
// ambient context (lib/tenant-context.ts). This resolver is always called with
// the shared `prisma` instance (directly or as the default), never a bare
// transaction client, so a single client type keeps the payload types clean.
type DbClient = GuardedPrisma;

async function resolveDefaultTeamId(db: DbClient) {
  const explicitTeamId = process.env.WHATSAPP_TEAM_ID?.trim();
  if (explicitTeamId) return explicitTeamId;

  const firstUser = await db.user.findFirst({
    where: { teamId: { not: null } },
    select: { teamId: true },
    orderBy: { createdAt: 'asc' },
  });

  return firstUser?.teamId ?? null;
}

function buildPhoneVariants(phone: string) {
  const normalized = normalizePhone(phone) || '';
  const digits = phoneFingerprint(phone);
  const variants = new Set<string>([normalized, digits, normalized.replace(/^\+/, '')].filter(Boolean));

  if (digits.length > 7) {
    variants.add(digits.slice(-8));
    variants.add(digits.slice(-9));
  }

  return [...variants];
}

/**
 * Collapse duplicate conversations for one contact onto a primary, KEEPING the
 * history.
 *
 * This used to `deleteMany` the duplicates' messages and internal notes. It ran
 * on the inbound path — every arriving message resolves a conversation — so any
 * contact that had ever ended up with two conversation rows silently lost one
 * of them, permanently, the next time they wrote in. There is no soft delete and
 * no audit trail on Message, so the history was simply gone. Merging is what
 * "collapse duplicates" was always supposed to mean.
 *
 * `Message` carries `@@unique([clientId, conversationId])`. Re-parenting can
 * therefore collide when two duplicates hold the same caller-issued idempotency
 * key, which only happens if the same outbound message was recorded twice — so
 * the loser's `clientId` is dropped rather than the message.
 */
async function mergeDuplicateConversations(db: DbClient, primaryId: string, duplicateIds: string[]) {
  await db.internalNote.updateMany({
    where: { conversationId: { in: duplicateIds } },
    data: { conversationId: primaryId },
  });

  try {
    await db.message.updateMany({
      where: { conversationId: { in: duplicateIds } },
      data: { conversationId: primaryId },
    });
  } catch {
    // Unique collision on (clientId, conversationId): move what we can one at a
    // time and clear the key on the ones that clash.
    const stragglers = await db.message.findMany({
      where: { conversationId: { in: duplicateIds } },
      select: { id: true },
    });
    for (const message of stragglers) {
      try {
        await db.message.update({
          where: { id: message.id },
          data: { conversationId: primaryId },
        });
      } catch {
        await db.message.update({
          where: { id: message.id },
          data: { conversationId: primaryId, clientId: null },
        });
      }
    }
  }

  // Safe now: the duplicates own no rows that would RESTRICT the delete.
  await db.conversation.deleteMany({ where: { id: { in: duplicateIds } } });
}

async function findMatchingContact(db: DbClient, phone: string, teamId?: string | null) {
  const variants = buildPhoneVariants(phone);
  const contacts = await db.contact.findMany({
    where: {
      ...(teamId ? { teamId } : {}),
      OR: variants.flatMap((variant) => [
        { phone: variant },
        { phone: { endsWith: variant } },
      ]),
    },
  });

  return contacts[0] || null;
}

export async function getOrCreateConversationByPhone(
  phone: string,
  teamId?: string | null,
  db: DbClient = prisma,
) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    throw new Error('Invalid phone number');
  }

  const resolvedTeamId = teamId ?? await resolveDefaultTeamId(db);

  // Phone is unique per (tenantId, phone) now, so we can't upsert by phone alone.
  // Find-or-create instead: the tenant-guard scopes the lookup and stamps the
  // tenantId on create. A concurrent create loses the unique race and is
  // recovered by re-reading.
  let contact: Contact | null = await findMatchingContact(db, phone, resolvedTeamId);
  if (!contact) {
    try {
      contact = await db.contact.create({
        data: {
          phone: normalizedPhone,
          teamId: resolvedTeamId ?? undefined,
        },
      });
    } catch {
      contact = await db.contact.findFirst({ where: { phone: normalizedPhone } });
    }
  }
  if (!contact) {
    throw new Error('Failed to resolve contact');
  }

  const customFields = (contact.customFields as Record<string, unknown> | null | undefined) || {};
  // Contact avatars are not available on the Cloud API: Meta deliberately
  // exposes no endpoint for a customer's WhatsApp profile photo. The UI falls
  // back to initials. (The old Baileys socket could read them, which is
  // precisely the kind of access an unofficial client should not have had.)

  const conversations = await db.conversation.findMany({
    where: {
      contactId: contact.id,
      ...(resolvedTeamId ? { teamId: resolvedTeamId } : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });

  if (conversations.length > 0) {
    const [primary, ...duplicates] = conversations;
    if (duplicates.length > 0) {
      await mergeDuplicateConversations(db, primary.id, duplicates.map((c) => c.id));
    }
    return { contact, conversation: primary, isNew: false };
  }

  const conversation = await db.conversation.create({
    data: {
      contactId: contact.id,
      teamId: resolvedTeamId ?? undefined,
      lastMessagePreview: null,
    },
  });

  return { contact, conversation, isNew: true };
}
