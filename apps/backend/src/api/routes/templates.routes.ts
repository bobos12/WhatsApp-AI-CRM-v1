import { Router } from 'express';
import { authMiddleware, checkPermission } from '../../auth/auth.middleware';
import { prisma } from '../../lib/prisma';
import { resolveMediaUrl, toStorageRef } from '../../lib/media';
import { renderTemplate, sendTemplate } from '../../services/template.service';

const router = Router();

router.use(authMiddleware);

const MEDIA_TYPES = new Set(['IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO']);

/**
 * A template's attachment must survive the round trip: whatever media the client
 * sends is written to *both* the dedicated columns and `payload.media`, and any
 * absolute URL is collapsed to a storage-relative ref first. Previously only
 * `mediaUrl` was persisted (with no type or filename), so reloading a template
 * produced a caption with no attachment — the "media files are lost" bug.
 */
function normalizeMedia(body: any) {
  const payloadMedia = body?.payload?.media;
  const type = body.mediaType ?? payloadMedia?.type ?? null;
  const url = toStorageRef(body.mediaUrl ?? payloadMedia?.url ?? null);

  if (!url || !type || !MEDIA_TYPES.has(type)) {
    return { mediaUrl: null, mediaType: null, mediaFilename: null, mediaMimeType: null };
  }

  return {
    mediaUrl: url,
    mediaType: type,
    mediaFilename: body.mediaFilename ?? payloadMedia?.filename ?? null,
    mediaMimeType: body.mediaMimeType ?? payloadMedia?.mimeType ?? null,
  };
}

/** Keep `payload.media` consistent with the columns so both readers agree. */
function syncPayload(payload: any, media: ReturnType<typeof normalizeMedia>) {
  if (!payload || typeof payload !== 'object') return payload ?? undefined;
  if (!media.mediaUrl) {
    const { media: _dropped, ...rest } = payload;
    return rest;
  }
  return {
    ...payload,
    media: {
      type: media.mediaType,
      url: media.mediaUrl,
      ...(media.mediaFilename ? { filename: media.mediaFilename } : {}),
      ...(media.mediaMimeType ? { mimeType: media.mediaMimeType } : {}),
    },
  };
}

/** Media leaves the API as a loadable URL; it is stored as a portable ref. */
function serializeTemplate(template: any) {
  const payload = template.payload;
  return {
    ...template,
    mediaUrl: resolveMediaUrl(template.mediaUrl),
    payload:
      payload && typeof payload === 'object' && payload.media?.url
        ? { ...payload, media: { ...payload.media, url: resolveMediaUrl(payload.media.url) } }
        : payload,
  };
}

/** TEXT vs MEDIA is derived from the attachment, never trusted from the client. */
function deriveType(media: ReturnType<typeof normalizeMedia>): 'TEXT' | 'MEDIA' {
  return media.mediaUrl ? 'MEDIA' : 'TEXT';
}

// ── List ────────────────────────────────────────────────────────────────────
router.get('/', checkPermission('read', 'templates'), async (req, res) => {
  try {
    const teamId = (req as any).user?.teamId;
    const where = teamId ? { OR: [{ teamId }, { teamId: null }] } : {};
    const templates = await prisma.messageTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json(templates.map(serializeTemplate));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Create ──────────────────────────────────────────────────────────────────
router.post('/', checkPermission('create', 'templates'), async (req, res) => {
  try {
    const teamId = (req as any).user?.teamId;
    const { name, content, status, payload, variables, language, category } = req.body;
    const media = normalizeMedia(req.body);

    // A media-only template (an image with no caption) is legitimate.
    if (!name?.trim() || !(content?.trim() || payload || media.mediaUrl)) {
      return res.status(400).json({ error: 'name and content, payload, or media are required' });
    }

    const template = await prisma.messageTemplate.create({
      data: {
        name: name.trim(),
        content: content?.trim() ?? '',
        teamId,
        ...media,
        type: deriveType(media),
        status: status || undefined,
        payload: syncPayload(payload, media),
        variables: variables || undefined,
        language: language || 'en_US',
        category: category || null,
      },
    });
    res.status(201).json(serializeTemplate(template));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Update ──────────────────────────────────────────────────────────────────
router.put('/:id', checkPermission('update', 'templates'), async (req, res) => {
  try {
    const teamId = (req as any).user?.teamId;
    const { name, content, status, payload, variables, language, category } = req.body;
    const existing = await prisma.messageTemplate.findFirst({
      where: { id: req.params.id, ...(teamId ? { OR: [{ teamId }, { teamId: null }] } : {}) },
    });
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    // An update that mentions no media at all leaves the existing attachment
    // alone; one that sends `mediaUrl: null` removes it.
    const touchesMedia = 'mediaUrl' in req.body || 'mediaType' in req.body || 'payload' in req.body;
    const media = touchesMedia ? normalizeMedia(req.body) : null;

    const template = await prisma.messageTemplate.update({
      where: { id: req.params.id },
      data: {
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(content !== undefined ? { content: content?.trim() ?? '' } : {}),
        ...(media ? { ...media, type: deriveType(media) } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(payload !== undefined ? { payload: syncPayload(payload, media ?? normalizeMedia(existing)) } : {}),
        ...(variables !== undefined ? { variables } : {}),
        ...(language !== undefined ? { language } : {}),
        ...(category !== undefined ? { category } : {}),
      },
    });
    res.json(serializeTemplate(template));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Delete ──────────────────────────────────────────────────────────────────
router.delete('/:id', checkPermission('delete', 'templates'), async (req, res) => {
  try {
    const teamId = (req as any).user?.teamId;
    const existing = await prisma.messageTemplate.findFirst({
      where: { id: req.params.id, ...(teamId ? { OR: [{ teamId }, { teamId: null }] } : {}) },
    });
    if (!existing) return res.status(404).json({ error: 'Template not found' });
    await prisma.messageTemplate.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Render (variable preview) ───────────────────────────────────────────────
router.post('/:id/render', checkPermission('read', 'templates'), async (req, res) => {
  try {
    const teamId = (req as any).user?.teamId;
    const vars = req.body?.variables || {};
    const template = await prisma.messageTemplate.findFirst({
      where: { id: req.params.id, ...(teamId ? { OR: [{ teamId }, { teamId: null }] } : {}) },
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    const rendered = renderTemplate(template, vars);
    res.json(rendered);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Send via Baileys (single phone / test send) ─────────────────────────────
router.post('/:id/send', checkPermission('create', 'messages'), async (req, res) => {
  try {
    const { phone, variables } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    const teamId = (req as any).user?.teamId;
    const template = await prisma.messageTemplate.findFirst({
      where: { id: req.params.id, ...(teamId ? { OR: [{ teamId }, { teamId: null }] } : {}) },
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const result = await sendTemplate(phone, template, variables ?? {});
    res.json({ success: true, messageId: result.messageId });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Send to selected conversations (bulk, personalized per contact) ─────────
const AUTO_DELAY_MIN_MS = 500;
const AUTO_DELAY_MAX_MS = 1500;
const MAX_BULK_RECIPIENTS = 100;

router.post('/:id/send-bulk', checkPermission('create', 'messages'), async (req, res) => {
  try {
    const { conversationIds, variables } = req.body as {
      conversationIds?: string[];
      variables?: Record<string, string>;
    };
    if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
      return res.status(400).json({ error: 'conversationIds is required' });
    }
    if (conversationIds.length > MAX_BULK_RECIPIENTS) {
      return res.status(400).json({
        error: `Maximum ${MAX_BULK_RECIPIENTS} recipients per send — use Broadcasts for larger audiences`,
      });
    }

    const teamId = (req as any).user?.teamId;
    const template = await prisma.messageTemplate.findFirst({
      where: { id: req.params.id, ...(teamId ? { OR: [{ teamId }, { teamId: null }] } : {}) },
    });
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const conversations = await prisma.conversation.findMany({
      where: { id: { in: conversationIds } },
      include: { contact: true },
    });
    const byId = new Map(conversations.map(c => [c.id, c]));

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < conversationIds.length; i++) {
      const conv = byId.get(conversationIds[i]);
      if (!conv?.contact?.phone) { failed += 1; continue; }

      // Contact fields (including custom ones) win over manually entered values.
      const { buildPersonalizationVars } = await import('../../broadcasts/personalization');
      const perContactVars: Record<string, string> = {
        ...(variables ?? {}),
        ...buildPersonalizationVars(conv.contact, conv.contact.phone),
      };

      try {
        await sendTemplate(conv.contact.phone, template, perContactVars, { conversationId: conv.id });
        sent += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (errors.length < 5) errors.push(message);
        // Stop the whole batch on connection loss or warm-up limit — the rest would fail too.
        if (message.includes('not connected') || (error as any)?.code === 'WARMUP_DAILY_LIMIT') {
          return res.status((error as any)?.code === 'WARMUP_DAILY_LIMIT' ? 429 : 503).json({
            error: message, sent, failed: failed + (conversationIds.length - i - 1),
          });
        }
      }

      // Anti-ban: small randomized delay between recipients
      if (i < conversationIds.length - 1) {
        const ms = AUTO_DELAY_MIN_MS + Math.floor(Math.random() * (AUTO_DELAY_MAX_MS - AUTO_DELAY_MIN_MS));
        await new Promise(r => setTimeout(r, ms));
      }
    }

    res.json({ success: failed === 0, sent, failed, errors: errors.length ? errors : undefined });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * Submit a template to Meta for review.
 *
 * Until a template is APPROVED it cannot reach anyone outside the 24-hour
 * customer service window, which is essentially the whole audience of a
 * campaign — so this endpoint is the gate on the product being usable at all,
 * not an optional extra.
 */
router.post('/:id/submit', checkPermission('update', 'templates'), async (req, res) => {
  try {
    const { getChannel } = await import('../../providers/channel.service');
    const channel = await getChannel();

    if (!channel.cloud) {
      return res.status(409).json({
        error: 'Connect the WhatsApp Business API in Settings before submitting templates.',
        code: 'CLOUD_API_NOT_CONFIGURED',
      });
    }

    const { submitTemplate } = await import('../../providers/meta/templates');
    const result = await submitTemplate(req.params.id, channel.cloud);
    res.json(result);
  } catch (error) {
    const { HttpError } = await import('../../auth/authorize');
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
