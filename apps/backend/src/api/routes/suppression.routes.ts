import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { normalizePhone } from '../../lib/phone';
import { authMiddleware, checkPermission } from '../../auth/auth.middleware';
import { HttpError } from '../../auth/authorize';
import { validateBody } from '../validate';
import {
  recordOptOut,
  suppress,
  unsuppress,
  HARD_SUPPRESSION_REASONS,
  SOFT_SUPPRESSION_REASONS,
} from '../../broadcasts/safety/suppression';

/**
 * ─── Suppression list API ────────────────────────────────────────────────────
 *
 * The do-not-message list, exposed so an operator can see it, add to it, and
 * (carefully) remove from it. Most entries arrive automatically — a customer
 * typing STOP, a send refused because the number blocked us — but a business
 * also needs to honour a request made over the phone, and needs to be able to
 * show an auditor that it did.
 */

const router = Router();
router.use(authMiddleware);

function sendError(res: any, error: unknown) {
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
}

const listQuerySchema = z.object({
  search: z.string().trim().max(64).optional(),
  reason: z.enum([...HARD_SUPPRESSION_REASONS, ...SOFT_SUPPRESSION_REASONS]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

router.get('/', checkPermission('read', 'contacts'), async (req, res) => {
  const query = listQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: query.error.issues[0]?.message ?? 'Invalid query' });
  }
  const { search, reason, page, pageSize } = query.data;

  try {
    const where = {
      ...(reason ? { reason } : {}),
      ...(search ? { phone: { contains: search } } : {}),
    };

    const [rows, total, grouped] = await Promise.all([
      prisma.suppressionEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.suppressionEntry.count({ where }),
      prisma.suppressionEntry.groupBy({ by: ['reason'], _count: { _all: true } }),
    ]);

    res.json({
      rows,
      total,
      page,
      pageSize,
      byReason: Object.fromEntries(grouped.map((row) => [row.reason, row._count._all])),
    });
  } catch (error) {
    sendError(res, error);
  }
});

const addSchema = z.object({
  phone: z.string().trim().min(4).max(32),
  reason: z.enum(HARD_SUPPRESSION_REASONS).default('MANUAL'),
  detail: z.string().trim().max(280).optional(),
});

router.post('/', checkPermission('update', 'contacts'), validateBody(addSchema), async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) throw new HttpError(400, 'That is not a valid phone number.');

    // An operator-recorded opt-out flips the contact flag too, so agents see the
    // same state the sender enforces.
    if (req.body.reason === 'OPTED_OUT' || req.body.reason === 'MANUAL') {
      await recordOptOut(phone, req.body.detail ?? 'Added to the do-not-message list by an agent', 'manual');
    } else {
      await suppress(phone, req.body.reason, { detail: req.body.detail, source: 'manual' });
    }

    res.status(201).json({ success: true, phone });
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * Removing a suppression is deliberately narrow: it clears the list entry and the
 * contact flag together. Leaving one behind is how a number ends up "unsuppressed"
 * but still silently filtered out of every audience.
 */
router.delete('/:phone', checkPermission('update', 'contacts'), async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    if (!phone) throw new HttpError(400, 'That is not a valid phone number.');

    await unsuppress(phone);
    await prisma.contact.updateMany({
      where: { phone },
      data: { marketingOptOut: false, optOutAt: null, optOutReason: null },
    });

    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
