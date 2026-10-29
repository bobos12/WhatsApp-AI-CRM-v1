import { Router, type NextFunction, type Request, type Response } from 'express';
import { ContactsService } from '../../contacts/contacts.service';
import { enrichContactAvatar } from '../../conversations/conversations.service';
import multer from 'multer';
import csv from 'csv-parser';
import { Readable } from 'stream';
import { z } from 'zod';
import { authMiddleware, checkPermission } from '../../auth/auth.middleware';
import { prisma } from '../../lib/prisma';
import { HttpError, type AuthActor } from '../../auth/authorize';
import { validateBody } from '../validate';
import { AUDIENCE_OPERATORS } from '../../broadcasts/audience';
import { getChannelOrDefault } from '../../providers/channel.service';
import { readPhoneStrict, regionOfPhone } from '../../lib/phone';
import {
  DUPLICATE_STRATEGIES,
  detectMapping,
  importRows,
  listImportTargets,
  validateRows,
  type ImportRow,
  type ImportOptions,
} from '../../contacts/import.service';

const router = Router();
const upload = multer();

/**
 * Fill in the default region for local (country-code-less) numbers when the
 * caller didn't pin one. Numbers already in international form auto-detect their
 * own country and ignore this; only bare local numbers fall back to it. We infer
 * it from the connected business number — imported contacts almost always share
 * the business's country — and leave it unset otherwise so `normalizePhone`'s env
 * default applies.
 */
async function withResolvedRegion<T extends { defaultCountry?: string }>(options: T): Promise<T> {
  if (options.defaultCountry) return options;
  // Default dialling region follows the business's own connected number.
  const channel = await getChannelOrDefault();
  const region = regionOfPhone(channel.cloud?.displayPhoneNumber || '');
  return region ? { ...options, defaultCountry: region } : options;
}

// Import bodies are large; the 12 MB parser for `/api/contacts/import` is mounted
// in index.ts, ahead of the global 2 MB one. A parser added here would be dead
// code — `express.json` skips a request whose body another parser already read.

router.use(authMiddleware);

const contactSchema = z.object({
  phone: z.string().min(1).max(32),
  /** The country picked next to the number; required unless it starts with + or 00. */
  phoneCountry: z.string().length(2).optional(),
  name: z.string().max(200).nullish(),
  email: z.string().max(200).nullish(),
  company: z.string().max(200).nullish(),
  notes: z.string().max(5000).nullish(),
  source: z.string().max(100).nullish(),
  lifecycleStage: z.string().max(50).optional(),
  status: z.string().max(50).optional(),
  customFields: z.record(z.unknown()).nullish(),
  tagIds: z.array(z.string()).optional(),
});

const updateContactSchema = contactSchema.partial();

/**
 * Typed numbers are accepted only when their country is certain — written with
 * + / 00, or sent with the country chosen beside the field. The number is
 * stored in its full international form; anything ambiguous is refused with a
 * reason the form can show, never guessed.
 */
function strictPhone(req: Request, res: Response, next: NextFunction) {
  const { phone, phoneCountry } = req.body ?? {};
  delete req.body?.phoneCountry;
  if (phone === undefined) return next();
  const result = readPhoneStrict(String(phone), phoneCountry);
  if (!result.ok) {
    return res.status(400).json(
      result.reason === 'COUNTRY_REQUIRED'
        ? { error: 'Choose the country for this number, or write it with its country code (for example +966…).', code: 'PHONE_COUNTRY_REQUIRED' }
        : { error: 'This is not a valid phone number for the chosen country. Check the digits.', code: 'PHONE_INVALID' },
    );
  }
  req.body.phone = result.e164;
  next();
}

const importOptionsSchema = z.object({
  duplicateStrategy: z.enum(DUPLICATE_STRATEGIES).default('SKIP'),
  defaultCountry: z.string().length(2).optional(),
  createMissingTags: z.boolean().optional(),
  source: z.string().max(100).optional(),
});

const importRowsSchema = z.object({
  rows: z
    .array(
      z.object({
        row: z.number().int().min(1),
        values: z.record(z.unknown()),
      }),
    )
    .min(1)
    .max(1000),
  options: importOptionsSchema,
});

function actorOf(req: any): AuthActor {
  return { id: req.user?.id, role: req.user?.role, teamId: req.user?.teamId ?? null };
}

function sendError(res: any, error: unknown) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message });
  }
  return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
}

async function ensurePhase2Tables() {
  // Postgres rejects multiple statements in one prepared statement, so each
  // CREATE TABLE must be issued as its own query.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Deal" (
      id TEXT PRIMARY KEY,
      "teamId" TEXT NULL,
      "contactId" TEXT NOT NULL,
      title TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'NEW',
      value DOUBLE PRECISION NOT NULL DEFAULT 0,
      "ownerId" TEXT NULL,
      notes TEXT NULL,
      "closedAt" TIMESTAMP(3) NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Task" (
      id TEXT PRIMARY KEY,
      "teamId" TEXT NULL,
      "contactId" TEXT NULL,
      title TEXT NOT NULL,
      description TEXT NULL,
      "dueDate" TIMESTAMP(3) NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      "assigneeId" TEXT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

const audienceFilterSchema = z.object({
  tags: z.array(z.string()).optional(),
  match: z.enum(['all', 'any']).optional(),
  conditions: z
    .array(
      z.object({
        field: z.string().min(1).max(64),
        operator: z.enum(AUDIENCE_OPERATORS),
        value: z.unknown().optional(),
      }),
    )
    .max(20)
    .optional(),
});

/**
 * `?filter=` carries a JSON-encoded AudienceFilter. A malformed one is ignored,
 * not fatal — a stale bookmark should show an unfiltered list, not an error.
 * The shape is validated rather than trusted: `evaluateCondition` throws on an
 * operator it does not know, so an unvetted string here would be a 500.
 */
function parseFilterQuery(raw: unknown) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = audienceFilterSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

router.get('/', async (req, res) => {
  try {
    const { search, tag } = req.query;
    // Pickers only need who the contact is — a fraction of the full rows.
    if (req.query.fields === 'basic') {
      const limit = Number(req.query.limit);
      return res.json(await ContactsService.getContactOptions(Number.isFinite(limit) && limit > 0 ? limit : undefined));
    }
    const contacts = await ContactsService.getContacts({
      search: search as string,
      tag: tag as string,
      filter: parseFilterQuery(req.query.filter),
    });
    res.json(contacts);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * The values that actually occur in the data, per filterable field — so the
 * filter builder can offer "tower is any of A, B" as chips instead of asking the
 * user to remember and type the tower names. Declared before `/:id` so
 * "field-values" is never read as a contact id.
 */
router.get('/field-values', async (_req, res) => {
  try {
    res.json(await ContactsService.getFieldValues());
  } catch (error) {
    sendError(res, error);
  }
});

// ── Import ───────────────────────────────────────────────────────────────────
// Declared before `/:id/...` so "import" is never mistaken for a contact id.

/** Every column an import can target: built-ins plus this team's custom fields. */
router.get('/import/targets', checkPermission('create', 'contacts'), async (req, res) => {
  try {
    const targets = await listImportTargets((req as any).user?.teamId);
    res.json(targets);
  } catch (error) {
    sendError(res, error);
  }
});

/** Server-side column detection, so the wizard's guess matches the importer's rules. */
router.post('/import/detect', checkPermission('create', 'contacts'), async (req, res) => {
  try {
    const headers = Array.isArray(req.body?.headers) ? req.body.headers.map(String) : [];
    const targets = await listImportTargets((req as any).user?.teamId);
    res.json({ mapping: detectMapping(headers, targets), targets });
  } catch (error) {
    sendError(res, error);
  }
});

/** Dry run — the same checks the import performs, with nothing written. */
router.post(
  '/import/validate',
  checkPermission('create', 'contacts'),
  validateBody(importRowsSchema),
  async (req, res) => {
    try {
      const { rows, options } = req.body as { rows: ImportRow[]; options: any };
      const result = await validateRows(rows, await withResolvedRegion(options), (req as any).user?.teamId);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  },
);

/** Apply one batch. The wizard streams batches so progress is real, not simulated. */
router.post(
  '/import/batch',
  checkPermission('create', 'contacts'),
  validateBody(importRowsSchema),
  async (req, res) => {
    try {
      const { rows, options } = req.body as { rows: ImportRow[]; options: any };
      const summary = await importRows(rows, await withResolvedRegion(options), (req as any).user?.teamId);
      res.json(summary);
    } catch (error) {
      sendError(res, error);
    }
  },
);

/**
 * Legacy endpoint: a bare CSV upload with no mapping step. Kept working for any
 * existing caller, but routed through the same importer so its behaviour (phone
 * normalization, custom fields, duplicate handling) matches the wizard's.
 */
router.post('/import', checkPermission('create', 'contacts'), upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const teamId = (req as any).user?.teamId;
    const targets = await listImportTargets(teamId);

    const parsed: Array<Record<string, string>> = [];
    await new Promise<void>((resolve, reject) => {
      Readable.from(file.buffer)
        .pipe(csv())
        .on('data', (row) => parsed.push(row))
        .on('error', reject)
        .on('end', resolve);
    });

    if (!parsed.length) return res.json({ imported: 0, total: 0, failed: 0 });

    const headers = Object.keys(parsed[0]);
    const mapping = detectMapping(headers, targets);

    const rows: ImportRow[] = parsed.map((raw, index) => {
      const values: Record<string, unknown> = {};
      headers.forEach((header, column) => {
        const target = mapping[column];
        if (target) values[target] = raw[header];
      });
      return { row: index + 2, values }; // +2: 1-based, and row 1 is the header
    });

    const legacyOptions: ImportOptions = { duplicateStrategy: 'SKIP' };
    const summary = await importRows(rows, await withResolvedRegion(legacyOptions), teamId);
    const imported = summary.created + summary.updated + summary.merged;
    res.json({ imported, total: rows.length, failed: summary.failed, skipped: summary.skipped });
  } catch (error) {
    sendError(res, error);
  }
});

// ── CRUD ─────────────────────────────────────────────────────────────────────

router.post('/', checkPermission('create', 'contacts'), validateBody(contactSchema), strictPhone, async (req, res) => {
  try {
    const { tagIds, ...data } = req.body;
    const contact = await ContactsService.createContact({
      ...data,
      teamId: (req as any).user?.teamId,
    });

    if (Array.isArray(tagIds) && tagIds.length) {
      await prisma.contactTag.createMany({
        data: tagIds.map((tagId: string) => ({ contactId: contact.id, tagId })),
        skipDuplicates: true,
      });
    }

    res.json(contact);
  } catch (error) {
    sendError(res, error);
  }
});

router.put('/:id', checkPermission('update', 'contacts'), validateBody(updateContactSchema), strictPhone, async (req, res) => {
  try {
    const { tagIds: _tagIds, ...data } = req.body;
    const contact = await ContactsService.updateContact(req.params.id, data, actorOf(req));
    res.json(contact);
  } catch (error) {
    sendError(res, error);
  }
});

// Clear a stale/expired avatar URL — called by the frontend when an avatar image 404s
router.delete('/:id/avatar', async (req, res) => {
  try {
    const contact = await prisma.contact.findUnique({ where: { id: req.params.id }, select: { customFields: true } });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    const cf = (contact.customFields as Record<string, unknown> | null) ?? {};
    const { avatarUrl: _removed, avatarUrlAt: _removedAt, ...rest } = cf as any;
    await prisma.contact.update({ where: { id: req.params.id }, data: { customFields: rest } });
    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/:id', checkPermission('delete', 'contacts'), async (req, res) => {
  try {
    await ContactsService.deleteContact(req.params.id, actorOf(req));
    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/:id/details', async (req, res) => {
  try {
    await ensurePhase2Tables();
    const contactRow = await prisma.contact.findFirst({
      where: { id: req.params.id },
      include: { contactTags: { include: { tag: true } } },
    });

    if (!contactRow) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Fetch/refresh the WhatsApp profile picture (cached with a TTL).
    const contact = await enrichContactAvatar(contactRow);

    const deals = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        d.*,
        u.id AS "owner__id",
        u.name AS "owner__name",
        u.email AS "owner__email"
      FROM "Deal" d
      LEFT JOIN "User" u ON u.id = d."ownerId"
      WHERE d."contactId" = $1
      ORDER BY d."updatedAt" DESC
      `,
      contact.id,
    );
    const tasks = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        t.*,
        u.id AS "assignee__id",
        u.name AS "assignee__name",
        u.email AS "assignee__email"
      FROM "Task" t
      LEFT JOIN "User" u ON u.id = t."assigneeId"
      WHERE t."contactId" = $1
      ORDER BY t."updatedAt" DESC
      `,
      contact.id,
    );
    const conversations = await prisma.conversation.findMany({
      where: { contactId: contact.id },
      select: {
        id: true,
        status: true,
        lastMessage: true,
        lastMessageAt: true,
        assignedTo: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ contact, deals, tasks, conversations });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/:id/timeline', async (req, res) => {
  try {
    const contactId = req.params.id;

    const [conversations, deals, tasks, notes] = await Promise.all([
      prisma.conversation.findMany({
        where: { contactId },
        select: { id: true, status: true, createdAt: true, lastMessage: true, lastMessageAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.deal.findMany({
        where: { contactId },
        include: { owner: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.task.findMany({
        where: { contactId },
        include: { assignee: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.internalNote.findMany({
        where: { conversation: { contactId } },
        include: { author: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    type TimelineEvent = { type: string; at: Date; data: unknown };

    const events: TimelineEvent[] = [
      ...conversations.map((c) => ({ type: 'conversation', at: c.createdAt, data: c })),
      ...deals.map((d) => ({ type: 'deal', at: (d as any).createdAt, data: d })),
      ...tasks.map((t) => ({ type: 'task', at: (t as any).createdAt, data: t })),
      ...notes.map((n) => ({ type: 'note', at: n.createdAt, data: n })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    res.json(events);
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
