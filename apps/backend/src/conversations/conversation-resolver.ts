import type { Contact } from '@prisma/client';
import { prisma, type GuardedPrisma } from '../lib/prisma';
import { normalizePhone, phoneFingerprint } from '../lib/phone';
import { getWhatsAppProfilePictureUrl } from '../whatsapp/client';

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
  if (!customFields.avatarUrl) {
    void getWhatsAppProfilePictureUrl(contact.phone).then(async (avatarUrl) => {
      if (!avatarUrl) return;
      await db.contact.update({
        where: { id: contact.id },
        data: {
          customFields: {
            ...customFields,
            avatarUrl,
          },
        },
      });
    });
  }

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
      const duplicateIds = duplicates.map((conversation) => conversation.id);
      // InternalNote→Conversation has no `onDelete`, so it RESTRICTs. Without
      // this, collapsing duplicates threw a foreign-key error the moment one of
      // them carried a note — and this runs on the inbound path, so it would
      // have rejected the incoming message too.
      await db.internalNote.deleteMany({ where: { conversationId: { in: duplicateIds } } });
      await db.message.deleteMany({ where: { conversationId: { in: duplicateIds } } });
      await db.conversation.deleteMany({ where: { id: { in: duplicateIds } } });
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
