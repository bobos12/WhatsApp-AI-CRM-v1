import { Router } from 'express';
import { providerManager } from '../../providers/manager';
import { handleMetaWebhook, handleVerification } from '../../providers/meta/webhook';
import { authMiddleware, checkPermission } from '../../auth/auth.middleware';
import { logger } from '../../lib/logger';
import { getTenantId } from '../../lib/tenant-context';
import { getChannel } from '../../providers/channel.service';
import { HttpError } from '../../auth/authorize';

/**
 * WhatsApp connection status and Meta's inbound webhook.
 *
 * Everything to do with QR codes, pairing codes and auth-state resets is gone
 * along with the unofficial WhatsApp Web transport. On the official Cloud API a
 * number is not "linked" by scanning anything — it is registered to a WhatsApp
 * Business Account, and this CRM connects to it with credentials. Connecting is
 * therefore a Settings task (see channel.routes.ts), not a modal with a
 * rotating image in it.
 */

const router = Router();

// The webhook is Meta calling us, not a signed-in user. It authenticates by
// HMAC signature instead (see providers/meta/webhook.ts), so it must bypass the
// session middleware.
router.use((req, res, next) => {
  if (req.path === '/meta-webhook') return next();
  return authMiddleware(req, res, next);
});

// ── Status ───────────────────────────────────────────────────────────────────

/**
 * Connection status for the header/sidebar indicator.
 *
 * Cheap by construction: the channel row is cached for 30s in the channel
 * service, so the frequent poll this endpoint receives costs nothing. There is
 * no socket state to inspect and no QR to generate.
 */
router.get('/status', checkPermission('read', 'whatsapp'), async (_req, res) => {
  try {
    // WhatsApp is per-client. The platform operator's own session has no tenant,
    // so there is nothing to report — tell the client so it hides the connect UI
    // rather than prompting to link a number that has nowhere to live.
    if (!getTenantId()) {
      return res.json({
        status: 'disconnected',
        connectedPhone: null,
        error: null,
        tenantless: true,
      });
    }

    const [status, channel] = await Promise.all([providerManager.getStatus(), getChannel()]);

    res.json({
      status: status.status,
      connectedPhone: status.connectedPhone,
      error: status.error,
      // Meta's own view of the number, so the UI can warn about a falling
      // quality rating before Meta acts on it.
      health: status.health,
      verifiedName: channel.cloud?.verifiedName ?? null,
      configured: Boolean(channel.cloud),
      lastSyncedAt: channel.lastSyncedAt,
      lastSyncError: channel.lastSyncError,
    });
  } catch (error) {
    logger.error('whatsapp_status_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.json({ status: 'disconnected', connectedPhone: null, error: null });
  }
});

/** Re-verify stored credentials and refresh Meta's health signals. */
router.post('/connect', checkPermission('update', 'whatsapp'), async (_req, res) => {
  try {
    if (!getTenantId()) {
      return res.status(409).json({
        error: 'WhatsApp is managed per client. Open a client from the operator console to connect their number.',
        code: 'NO_TENANT',
      });
    }
    await providerManager.connect();
    res.json({ success: true, status: await providerManager.getStatus() });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Direct send ──────────────────────────────────────────────────────────────

router.post('/send', checkPermission('create', 'messages'), async (req, res) => {
  try {
    const { phone, message, contactId } = req.body ?? {};
    if (!message) return res.status(400).json({ error: 'Message is required' });

    let target = phone;
    if (!target && contactId) {
      const { prisma } = await import('../../lib/prisma');
      const contact = await prisma.contact.findUnique({
        where: { id: contactId },
        select: { phone: true },
      });
      if (!contact) return res.status(404).json({ error: 'Contact not found' });
      target = contact.phone;
    }
    if (!target) return res.status(400).json({ error: 'A phone number or contact is required' });

    const result = await providerManager.sendMessage({ phone: target, text: message });
    res.json({ success: true, messageId: result.messageId });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Meta Cloud API webhook ───────────────────────────────────────────────────

router.get('/meta-webhook', (req, res) => {
  const result = handleVerification(req.query as Record<string, unknown>);
  if (result.ok) return res.status(200).send(result.challenge);
  res.status(403).json({ error: 'Forbidden' });
});

router.post('/meta-webhook', async (req, res) => {
  // Meta retries any non-2xx for up to 7 days and disables the subscription if
  // failures persist. A payload we cannot attribute or verify is not something a
  // retry will fix, so it is acknowledged and dropped — the log is the record.
  // Only genuine server faults return 500, where a retry actually helps.
  try {
    if (req.body?.object !== 'whatsapp_business_account') {
      return res.status(200).json({ ignored: 'not a whatsapp_business_account payload' });
    }

    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!raw) {
      logger.error('meta_webhook.raw_body_missing');
      return res.status(500).json({ error: 'Webhook body was not captured' });
    }

    const outcome = await handleMetaWebhook({
      body: req.body,
      rawBody: raw,
      signatureHeader: req.headers['x-hub-signature-256'] as string | undefined,
    });

    if (!outcome.handled) {
      return res.status(200).json({ ignored: outcome.reason });
    }
    res.status(200).json({ success: true });
  } catch (err) {
    logger.error('meta_webhook.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
