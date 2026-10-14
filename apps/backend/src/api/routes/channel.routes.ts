import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, checkPermission } from '../../auth/auth.middleware';
import { validateBody } from '../validate';
import { getTenantId } from '../../lib/tenant-context';
import { isCredentialEncryptionConfigured } from '../../lib/crypto';
import { HttpError } from '../../auth/authorize';
import { logger } from '../../lib/logger';
import {
  disconnectCloud,
  getChannelForDisplay,
  saveCloudCredentials,
} from '../../providers/channel.service';
import { providerByName } from '../../providers/manager';
import { syncTemplates } from '../../providers/meta/templates';
import { getChannel } from '../../providers/channel.service';

/**
 * Per-tenant WhatsApp channel configuration: the tenant's Meta credentials and
 * the health Meta reports back about their number.
 *
 * Credentials are write-only across this boundary. A saved token is never
 * returned, only a masked hint, so a compromised session cannot exfiltrate the
 * credential that sends as the customer's business.
 */

const router = Router();

router.use(authMiddleware);

/** WhatsApp configuration is a per-client concern; the operator console has no channel. */
function requireTenant() {
  if (!getTenantId()) {
    throw new HttpError(
      409,
      'WhatsApp is configured per client. Open a client from the operator console to manage their connection.',
      'NO_TENANT',
    );
  }
}

function handle(res: any, err: unknown) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  logger.error('channel.route_error', { error: err instanceof Error ? err.message : String(err) });
  return res.status(500).json({ error: 'Something went wrong' });
}

// ── Read ─────────────────────────────────────────────────────────────────────

router.get('/', checkPermission('read', 'whatsapp'), async (_req, res) => {
  try {
    requireTenant();
    const channel = await getChannelForDisplay();
    res.json({
      ...channel,
      // Surfaced so Settings can explain *why* saving credentials is refused,
      // rather than showing an opaque failure the tenant cannot act on.
      encryptionReady: isCredentialEncryptionConfigured(),
      webhookUrl: `${process.env.PUBLIC_API_URL ?? ''}/api/whatsapp/meta-webhook`,
      verifyTokenSet: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
    });
  } catch (err) {
    handle(res, err);
  }
});

// ── Credentials ──────────────────────────────────────────────────────────────

const credentialsSchema = z.object({
  phoneNumberId: z.string().trim().min(1, 'Phone Number ID is required'),
  // Optional on update: the token is write-only, so the form cannot pre-fill it
  // and a tenant changing only their App Secret has nothing to re-paste. The
  // service rejects a blank token when none is stored yet.
  accessToken: z.string().trim().optional(),
  wabaId: z.string().trim().optional().nullable(),
  businessId: z.string().trim().optional().nullable(),
  appId: z.string().trim().optional().nullable(),
  appSecret: z.string().trim().optional().nullable(),
});

router.put(
  '/credentials',
  checkPermission('update', 'whatsapp'),
  validateBody(credentialsSchema),
  async (req, res) => {
    try {
      requireTenant();

      if (!isCredentialEncryptionConfigured()) {
        throw new HttpError(
          503,
          'This server cannot store WhatsApp credentials securely yet: CREDENTIAL_ENCRYPTION_KEY is not configured. Ask your administrator to set it.',
          'ENCRYPTION_NOT_CONFIGURED',
        );
      }

      await saveCloudCredentials(req.body);

      // Verify immediately. Saving credentials that do not work, and only
      // finding out at the first send, is the single most confusing failure in
      // this setup flow — so the round trip happens while the user is still
      // looking at the form.
      try {
        await providerByName('meta').connect();
      } catch (verifyErr) {
        const message = verifyErr instanceof HttpError ? verifyErr.message : 'Could not verify these credentials.';
        return res.status(200).json({
          saved: true,
          verified: false,
          error: message,
        });
      }

      res.json({ saved: true, verified: true, channel: await getChannelForDisplay() });
    } catch (err) {
      handle(res, err);
    }
  },
);

/** Re-verify stored credentials and refresh Meta's quality/limit signals. */
router.post('/verify', checkPermission('update', 'whatsapp'), async (_req, res) => {
  try {
    requireTenant();
    await providerByName('meta').connect();
    res.json({ verified: true, channel: await getChannelForDisplay() });
  } catch (err) {
    handle(res, err);
  }
});

router.delete('/cloud', checkPermission('update', 'whatsapp'), async (_req, res) => {
  try {
    requireTenant();
    await disconnectCloud();
    res.json({ success: true, channel: await getChannelForDisplay() });
  } catch (err) {
    handle(res, err);
  }
});

// ── Template sync ────────────────────────────────────────────────────────────

/**
 * Pull template review status from Meta.
 *
 * The status webhook is the primary signal; this is the manual recovery for
 * deliveries that were missed, which is why it is a user-visible button rather
 * than only a background job.
 */
router.post('/templates/sync', checkPermission('update', 'templates'), async (_req, res) => {
  try {
    requireTenant();
    const channel = await getChannel();
    if (!channel.cloud) {
      throw new HttpError(409, 'Connect the WhatsApp Business API first.', 'CLOUD_API_NOT_CONFIGURED');
    }
    const result = await syncTemplates(channel.cloud);
    res.json(result);
  } catch (err) {
    handle(res, err);
  }
});

export default router;
