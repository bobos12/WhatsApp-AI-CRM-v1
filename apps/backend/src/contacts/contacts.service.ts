import { prisma } from '../lib/prisma';
import { normalizePhone } from '../lib/phone';
import { assertTeamAccess, HttpError, NotFoundError, type AuthActor } from '../auth/authorize';
import {
  coerceCustomFieldValues,
  listDefinitions,
  mergeCustomFields,
} from './custom-fields.service';
import { matchesFilter, type AudienceFilter } from '../broadcasts/audience';
import { RESERVED_CUSTOM_FIELD_KEYS } from './custom-fields.constants';

export interface ContactWriteInput {
  phone?: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  notes?: string | null;
  status?: string;
  lifecycleStage?: string;
  source?: string | null;
  customFields?: Record<string, unknown> | null;
  teamId?: string;
}

/** Base columns a caller may write. Anything else has to be a custom field. */
function baseColumns(input: ContactWriteInput) {
  const columns: Record<string, unknown> = {};
  if (input.name !== undefined) columns.name = input.name?.toString().trim() || null;
  if (input.email !== undefined) columns.email = input.email?.toString().trim().toLowerCase() || null;
  if (input.company !== undefined) columns.company = input.company?.toString().trim() || null;
  if (input.notes !== undefined) columns.notes = input.notes?.toString() || null;
  if (input.status !== undefined) columns.status = input.status;
  if (input.lifecycleStage !== undefined) columns.lifecycleStage = input.lifecycleStage;
  if (input.source !== undefined) columns.source = input.source?.toString().trim() || null;
  return columns;
}

/**
 * Validate the custom-field half of a write and fold it into the contact's
 * stored JSON. Throws a 400 listing every bad field at once rather than failing
 * on the first — a form should light up all its errors in one round trip.
 */
async function resolveCustomFields(
  input: ContactWriteInput,
  existing: { customFields: unknown } | null,
  opts: { partial: boolean },
): Promise<Record<string, unknown> | undefined> {
  if (input.customFields === undefined) return undefined;

  const definitions = await listDefinitions(input.teamId ?? null);
  const coerced = coerceCustomFieldValues(definitions, input.customFields, { partial: opts.partial });

  if (coerced.errors.length) {
    throw new HttpError(400, coerced.errors.map((error) => error.message).join(' '));
  }

  return mergeCustomFields(existing?.customFields ?? null, coerced, definitions, { partial: opts.partial });
}

export class ContactsService {
  static async getContacts(filters?: { search?: string; tag?: string; filter?: AudienceFilter | null }) {
    const conditions: any[] = [
      { NOT: { phone: { contains: '@g.us' } } },
      { NOT: { phone: { contains: '@broadcast' } } },
    ];

    if (filters?.search) {
      const search = filters.search;

      // Custom-field values live in a JSONB document, so a free-text search has
      // to reach inside it. One narrow id lookup is cheaper and far simpler than
      // teaching Prisma a per-field JSON path for every definition a business has.
      const customMatches = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Contact"
        WHERE "customFields" IS NOT NULL
          AND "customFields"::text ILIKE ${`%${search}%`}
        LIMIT 5000
      `;

      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
          { company: { contains: search, mode: 'insensitive' } },
          ...(customMatches.length ? [{ id: { in: customMatches.map((row) => row.id) } }] : []),
        ],
      });
    }

    // A tag narrows the result set. It used to be OR-ed into the search clause,
    // which meant "search=ali OR tag=vip" — every VIP contact showed up under
    // any search term.
    if (filters?.tag) {
      conditions.push({
        contactTags: { some: { tag: { name: { equals: filters.tag, mode: 'insensitive' } } } },
      });
    }

    const contacts = await prisma.contact.findMany({
      where: { AND: conditions },
      orderBy: { createdAt: 'desc' },
      include: { contactTags: { include: { tag: true } } },
    });

    // Structured conditions (including custom fields) are applied in memory —
    // see broadcasts/audience.ts for why.
    const filter = filters?.filter;
    if (!filter?.conditions?.length) return contacts;
    return contacts.filter((contact) => matchesFilter(contact as any, filter));
  }

  /**
   * The distinct values each filterable field actually holds, so the filter
   * builder can offer them as choices. A business keeps its towers, cities and
   * unit types in plain text fields; making the user retype "Tower A" exactly as
   * it was imported is how a broadcast silently reaches nobody.
   *
   * Fields with more distinct values than `MAX_VALUES` are omitted rather than
   * truncated — a half-list of names reads as the whole list and hides the rest.
   * Free-text columns (name, notes, email, phone) are never offered: their values
   * are unique per contact, so a choice list of them is meaningless.
   */
  static async getFieldValues(teamId?: string | null): Promise<Record<string, string[]>> {
    const MAX_VALUES = 100;

    const contacts = await prisma.contact.findMany({
      where: teamId ? { teamId } : {},
      select: {
        company: true,
        source: true,
        status: true,
        lifecycleStage: true,
        customFields: true,
      },
    });

    const buckets = new Map<string, Set<string>>();
    const overflowed = new Set<string>();

    const record = (key: string, raw: unknown) => {
      if (overflowed.has(key)) return;
      // A MULTI_SELECT holds several values at once; each is a choice on its own.
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) {
        if (value == null || typeof value === 'object') continue;
        const text = String(value).trim();
        if (!text) continue;

        const bucket = buckets.get(key) ?? new Set<string>();
        bucket.add(text);
        if (bucket.size > MAX_VALUES) {
          overflowed.add(key);
          buckets.delete(key);
          return;
        }
        buckets.set(key, bucket);
      }
    };

    for (const contact of contacts) {
      record('company', contact.company);
      record('source', contact.source);
      record('status', contact.status);
      record('lifecycleStage', contact.lifecycleStage);

      const custom = (contact.customFields ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(custom)) {
        if (RESERVED_CUSTOM_FIELD_KEYS.has(key)) continue;
        record(key, value);
      }
    }

    const result: Record<string, string[]> = {};
    for (const [key, values] of buckets) {
      result[key] = Array.from(values).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
      );
    }
    return result;
  }

  static async getContactById(id: string, actor?: AuthActor) {
    const contact = await prisma.contact.findUnique({
      where: { id },
      include: { contactTags: { include: { tag: true } } },
    });
    if (!contact) throw new NotFoundError('Contact not found');
    if (actor) assertTeamAccess(actor, contact);
    return contact;
  }

  static async createContact(data: ContactWriteInput & { phone: string }) {
    const phone = normalizePhone(data.phone);
    if (!phone) {
      throw new HttpError(400, 'Invalid phone number');
    }

    // Phone is unique per (tenant, phone); the guard scopes this to the tenant.
    const existing = await prisma.contact.findFirst({ where: { phone } });
    const customFields = await resolveCustomFields(data, existing, { partial: Boolean(existing) });

    if (existing) {
      return await prisma.contact.update({
        where: { id: existing.id },
        data: {
          ...baseColumns(data),
          ...(customFields !== undefined ? { customFields: customFields as any } : {}),
          teamId: data.teamId ?? existing.teamId,
        },
      });
    }

    return await prisma.contact.create({
      data: {
        phone,
        ...baseColumns(data),
        ...(customFields !== undefined ? { customFields: customFields as any } : {}),
        teamId: data.teamId,
      },
    });
  }

  static async updateContact(id: string, data: ContactWriteInput, actor: AuthActor) {
    const contact = await prisma.contact.findUnique({ where: { id } });
    if (!contact) throw new NotFoundError('Contact not found');
    assertTeamAccess(actor, contact);

    const customFields = await resolveCustomFields(
      { ...data, teamId: data.teamId ?? contact.teamId ?? undefined },
      contact,
      { partial: true },
    );

    const phone = data.phone !== undefined ? normalizePhone(data.phone) : undefined;
    if (data.phone !== undefined && !phone) throw new HttpError(400, 'Invalid phone number');

    return await prisma.contact.update({
      where: { id: contact.id },
      data: {
        ...(phone ? { phone } : {}),
        ...baseColumns(data),
        ...(customFields !== undefined ? { customFields: customFields as any } : {}),
      },
      include: { contactTags: { include: { tag: true } } },
    });
  }

  static async deleteContact(id: string, actor: AuthActor) {
    const contact = await prisma.contact.findUnique({ where: { id } });
    if (!contact) throw new NotFoundError('Contact not found');
    assertTeamAccess(actor, contact);

    return await prisma.$transaction(async (tx) => {
      const conversations = await tx.conversation.findMany({
        where: { contactId: contact.id },
        select: { id: true },
      });

      if (conversations.length > 0) {
        const conversationIds = conversations.map((conversation) => conversation.id);

        // Children first, and only these three relations need clearing by hand.
        // Everything else hanging off a Contact cleans itself up: ContactTag,
        // Deal, LeadQualification and Notification cascade, Task nulls out, and
        // MessageReaction cascades from Message. But Message→Conversation,
        // InternalNote→Conversation and Conversation→Contact are declared with no
        // `onDelete`, so Postgres defaults to RESTRICT and the delete fails.
        // InternalNote was the one missing here — deleting a contact whose
        // conversation had a single internal note blew up on
        // `InternalNote_conversationId_fkey`.
        await tx.internalNote.deleteMany({ where: { conversationId: { in: conversationIds } } });
        await tx.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
        await tx.conversation.deleteMany({ where: { id: { in: conversationIds } } });
      }

      return await tx.contact.delete({
        where: { id: contact.id },
      });
    });
  }
}
