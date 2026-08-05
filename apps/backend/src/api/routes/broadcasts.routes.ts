import { Router } from 'express';
import { z } from 'zod';
import { BroadcastsService } from '../../broadcasts/broadcasts.service';
import { AUDIENCE_OPERATORS } from '../../broadcasts/audience';
import { authMiddleware, checkPermission } from '../../auth/auth.middleware';
import { HttpError } from '../../auth/authorize';
import { validateBody } from '../validate';

const router = Router();

router.use(authMiddleware);

function sendError(res: any, error: unknown) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  }
  return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
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
 * `scheduledAtLocal` is the wall clock the user literally picked
 * ("2026-07-10T14:30"), paired with the IANA zone they picked it in. The pair is
 * unambiguous; an ISO instant alone is not, because it has already thrown away
 * which zone the user meant. `scheduledAt` stays accepted for API clients and is
 * only consulted when `scheduledAtLocal` is absent.
 */
const broadcastFields = z.object({
  name: z.string().trim().min(1, 'Campaign name is required').max(200),
  message: z.string().max(4096).default(''),
  recipients: z.array(z.string().trim().min(1)).max(50_000).optional(),
  tag: z.string().trim().max(100).optional(),
  filter: audienceFilterSchema.nullish(),
  scheduledAtLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/, 'Pick a valid date and time')
    .nullish(),
  scheduledAt: z.union([z.string().datetime({ offset: true }), z.date()]).nullish(),
  timezone: z.string().trim().max(64).nullish(),
  interactiveContent: z.record(z.unknown()).optional(),
  mediaUrl: z.string().trim().max(2048).nullish(),
  mediaType: z.enum(['IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO', 'VOICE']).nullish(),
  mediaFilename: z.string().trim().max(255).nullish(),
  mediaMimeType: z.string().trim().max(128).nullish(),
  // Smart Sending: batch the audience with a wait between each batch.
  smartSending: z.boolean().optional(),
  batchSize: z.coerce.number().int().min(1).max(5000).nullish(),
  batchIntervalMinutes: z.coerce.number().int().min(1).max(1440).nullish(),
  // ── Deliverability controls ────────────────────────────────────────────────
  // The server clamps `pacingProfile` to whatever account health allows, so a
  // client asking for STEADY on a three-day-old number gets CAREFUL and is told
  // why in the pre-flight report. Accepting the field is not the same as
  // honouring it.
  pacingProfile: z.enum(['CAREFUL', 'BALANCED', 'STEADY']).nullish(),
  quietHoursEnabled: z.boolean().nullish(),
  quietHoursStart: z.coerce.number().int().min(0).max(23).nullish(),
  quietHoursEnd: z.coerce.number().int().min(0).max(23).nullish(),
  pilotSize: z.coerce.number().int().min(1).max(1000).nullish(),
  ignoreCooldown: z.boolean().optional(),
  // Audience exclusions applied by the safety report's one-tap fixes. Resolved
  // server-side because only the server knows which numbers are cold.
  excludeCold: z.boolean().optional(),
  excludeReceivedFrom: z.string().trim().max(64).nullish(),
});

const broadcastSchema = broadcastFields
  // A broadcast with neither text nor an attachment has nothing to deliver.
  .refine((body) => body.message.trim().length > 0 || Boolean(body.mediaUrl), {
    message: 'Add a message or an attachment.',
    path: ['message'],
  })
  // Storing a wall clock without its zone is exactly the bug this replaces.
  .refine((body) => !body.scheduledAtLocal || Boolean(body.timezone), {
    message: 'A scheduled broadcast must include the time zone it was scheduled in.',
    path: ['timezone'],
  })
  // Smart Sending is meaningless without both numbers; require them together.
  .refine((body) => !body.smartSending || (body.batchSize != null && body.batchIntervalMinutes != null), {
    message: 'Smart Sending needs a batch size and a wait interval.',
    path: ['batchSize'],
  });

/**
 * Pre-flight runs against a half-written draft — the composer calls it while the
 * user is still choosing an audience — so the completeness rules that guard a
 * *save* would make it useless. Same fields, none of the "you must finish first"
 * refinements.
 */
const preflightSchema = broadcastFields.partial({ name: true });

router.get('/', checkPermission('read', 'broadcasts'), async (req, res) => {
  try {
    const broadcasts = await BroadcastsService.getBroadcasts((req as any).user?.teamId);
    res.json(broadcasts);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * ── GET /api/broadcasts/health ────────────────────────────────────────────────
 * Account-level sending health: the score, the signals behind it, and today's
 * remaining budget. Mounted before `/:id` so "health" is never read as an id.
 */
router.get('/health', checkPermission('read', 'broadcasts'), async (_req, res) => {
  try {
    res.json(await BroadcastsService.getHealth());
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * ── POST /api/broadcasts/preflight ────────────────────────────────────────────
 * Analyse a draft without saving it. The composer calls this as the user edits,
 * so the report they act on comes from the same code that gates the send.
 */
router.post('/preflight', checkPermission('create', 'broadcasts'), validateBody(preflightSchema), async (req, res) => {
  try {
    const report = await BroadcastsService.preflight(
      { ...req.body, name: req.body.name ?? 'Draft', teamId: (req as any).user?.teamId },
      typeof req.query.exclude === 'string' ? req.query.exclude : undefined,
    );
    res.json(report);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * `?recipients=none` returns the campaign without its audience array. The edit
 * form needs every phone to repopulate its picker; the detail view does not, and
 * pages the audience separately.
 */
router.get('/:id', checkPermission('read', 'broadcasts'), async (req, res) => {
  try {
    const broadcast = await BroadcastsService.getBroadcastById(
      req.params.id,
      (req as any).user?.teamId,
      { includeRecipients: req.query.recipients !== 'none' },
    );
    res.json(broadcast);
  } catch (error) {
    sendError(res, error);
  }
});

const recipientQuerySchema = z.object({
  status: z.enum(['pending', 'sent', 'failed', 'skipped']).optional(),
  search: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

router.get('/:id/recipients', checkPermission('read', 'broadcasts'), async (req, res) => {
  const query = recipientQuerySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: query.error.issues[0]?.message ?? 'Invalid query' });
  }

  try {
    const result = await BroadcastsService.getRecipients(req.params.id, {
      ...query.data,
      teamId: (req as any).user?.teamId,
    });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/', checkPermission('create', 'broadcasts'), validateBody(broadcastSchema), async (req, res) => {
  try {
    const broadcast = await BroadcastsService.createBroadcast({
      ...req.body,
      teamId: (req as any).user?.teamId,
    });
    res.json(broadcast);
  } catch (error) {
    sendError(res, error);
  }
});

router.put('/:id', checkPermission('update', 'broadcasts'), validateBody(broadcastSchema), async (req, res) => {
  try {
    const broadcast = await BroadcastsService.updateBroadcast(req.params.id, {
      ...req.body,
      teamId: (req as any).user?.teamId,
    });
    res.json(broadcast);
  } catch (error) {
    sendError(res, error);
  }
});

/**
 * `acknowledged: true` is the user confirming they have read a CRITICAL safety
 * report. Without it a critical campaign is refused with 428, which the UI turns
 * into "open the report" rather than a dead end.
 */
router.post('/:id/send', checkPermission('create', 'broadcasts'), async (req, res) => {
  try {
    const broadcast = await BroadcastsService.sendBroadcast(req.params.id, (req as any).user?.teamId, {
      acknowledged: req.body?.acknowledged === true,
    });
    res.json(broadcast);
  } catch (error) {
    sendError(res, error);
  }
});

/** Re-assess a saved campaign against current account health. */
router.post('/:id/preflight', checkPermission('read', 'broadcasts'), async (req, res) => {
  try {
    const report = await BroadcastsService.refreshPreflight(req.params.id, (req as any).user?.teamId);
    res.json(report);
  } catch (error) {
    sendError(res, error);
  }
});

/** Record that the safety report has been read and accepted. */
router.post('/:id/acknowledge', checkPermission('update', 'broadcasts'), async (req, res) => {
  try {
    const broadcast = await BroadcastsService.acknowledgeReview(req.params.id, (req as any).user?.teamId);
    res.json(broadcast);
  } catch (error) {
    sendError(res, error);
  }
});

/** Cheap, pollable live status for the campaign monitor. */
router.get('/:id/live', checkPermission('read', 'broadcasts'), async (req, res) => {
  try {
    const status = await BroadcastsService.getLiveStatus(req.params.id, (req as any).user?.teamId);
    res.json(status);
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/:id/duplicate', checkPermission('create', 'broadcasts'), async (req, res) => {
  try {
    const broadcast = await BroadcastsService.duplicateBroadcast(req.params.id, (req as any).user?.teamId);
    res.status(201).json(broadcast);
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/:id/unschedule', checkPermission('update', 'broadcasts'), async (req, res) => {
  try {
    const broadcast = await BroadcastsService.cancelSchedule(req.params.id, (req as any).user?.teamId);
    res.json(broadcast);
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/:id/cancel', checkPermission('update', 'broadcasts'), async (req, res) => {
  try {
    const broadcast = await BroadcastsService.cancelBroadcast(req.params.id, (req as any).user?.teamId);
    res.json(broadcast);
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/:id/pause', checkPermission('update', 'broadcasts'), async (req, res) => {
  try {
    const broadcast = await BroadcastsService.pauseBroadcast(req.params.id, (req as any).user?.teamId);
    res.json(broadcast);
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/:id/resume', checkPermission('update', 'broadcasts'), async (req, res) => {
  try {
    const broadcast = await BroadcastsService.resumeBroadcast(req.params.id, (req as any).user?.teamId, {
      acknowledged: req.body?.acknowledged === true,
    });
    res.json(broadcast);
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/:id', checkPermission('delete', 'broadcasts'), async (req, res) => {
  try {
    await BroadcastsService.deleteBroadcast(req.params.id, (req as any).user?.teamId);
    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/:id/stats', checkPermission('read', 'broadcasts'), async (req, res) => {
  try {
    const stats = await BroadcastsService.getBroadcastStats(req.params.id, (req as any).user?.teamId);
    res.json(stats);
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
