import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, checkPermission, type AuthRequest } from '../../auth/auth.middleware';
import { isManager } from '../../auth/authorize';
import { asMetaError } from '../../providers/meta/graph';
import {
  configureWebhook,
  discoverNumbers,
  getWebhookState,
  inspectToken,
  numberHealth,
  probeSendPermission,
  registerNumber,
  runHealthChecks,
  subscribeApp,
  webhookCallbackUrl,
  type HealthReport,
  type TokenInfo,
} from '../../providers/meta/onboarding';
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

/**
 * Every response that hands the client a channel uses this shape, so the
 * webhook setup step after a save still knows the callback URL and token state.
 */
async function channelView() {
  return {
    ...(await getChannelForDisplay()),
    // Surfaced so Settings can explain *why* saving credentials is refused,
    // rather than showing an opaque failure the tenant cannot act on.
    encryptionReady: isCredentialEncryptionConfigured(),
    webhookUrl: `${process.env.PUBLIC_API_URL ?? ''}/api/whatsapp/meta-webhook`,
    verifyTokenSet: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
  };
}

router.get('/', checkPermission('read', 'whatsapp'), async (_req, res) => {
  try {
    requireTenant();
    res.json(await channelView());
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
      invalidateHealth();

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

      res.json({ saved: true, verified: true, channel: await channelView() });
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
    res.json({ verified: true, channel: await channelView() });
  } catch (err) {
    handle(res, err);
  }
});

router.delete('/cloud', checkPermission('update', 'whatsapp'), async (_req, res) => {
  try {
    requireTenant();
    await disconnectCloud();
    invalidateHealth();
    res.json({ success: true, channel: await channelView() });
  } catch (err) {
    handle(res, err);
  }
});

// ── Guided setup ─────────────────────────────────────────────────────────────
//
// The setup screen needs only a token and the app secret: everything else is
// read from Meta. These routes are the steps of that flow, and each failure
// carries a stable `code` the UI explains in the user's language.

/** The credentials a request supplies, falling back to the stored ones for a "change number" run. */
async function resolveSecrets(body: { accessToken?: string; appSecret?: string | null }) {
  const stored = (await getChannel()).cloud;
  return {
    accessToken: body.accessToken?.trim() || stored?.accessToken || '',
    appSecret: body.appSecret?.trim() || stored?.appSecret || null,
    stored,
  };
}

const discoverSchema = z.object({
  accessToken: z.string().trim().optional(),
  appSecret: z.string().trim().optional().nullable(),
  businessId: z.string().trim().regex(/^\d+$/, 'Business ID is digits only').optional().nullable(),
});

router.post('/discover', checkPermission('update', 'whatsapp'), validateBody(discoverSchema), async (req, res) => {
  try {
    requireTenant();
    const { accessToken, appSecret, stored } = await resolveSecrets(req.body);
    if (!accessToken) throw new HttpError(400, 'Paste your access token to continue.', 'TOKEN_REQUIRED');

    let token: TokenInfo;
    try {
      token = await inspectToken(accessToken, appSecret);
    } catch (err) {
      throw new HttpError(400, asMetaError(err).userMessage, 'TOKEN_INVALID');
    }
    if (!token.valid) throw new HttpError(400, 'Meta says this token is not valid.', 'TOKEN_INVALID');
    if (token.missingScopes.length) {
      throw new HttpError(400, `This token is missing: ${token.missingScopes.join(', ')}.`, 'TOKEN_SCOPES');
    }
    if (token.appSecretValid === false) {
      throw new HttpError(400, 'That App Secret does not belong to the app this token was made for.', 'APP_SECRET_INVALID');
    }

    const businessId = req.body.businessId || stored?.businessId || null;
    if (!token.wabaIds.length && !businessId) {
      return res.json({ token, needsBusinessId: true, numbers: [] });
    }

    const numbers = await discoverNumbers(accessToken, { wabaIds: token.wabaIds, businessId });
    res.json({ token, needsBusinessId: false, numbers });
  } catch (err) {
    handle(res, err);
  }
});

const connectSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d+$/, 'Pick a number to connect'),
  accessToken: z.string().trim().optional(),
  appSecret: z.string().trim().optional().nullable(),
});

type StepResult = { id: string; status: 'ok' | 'warn' | 'fail'; code: string; detail?: string };

router.post('/connect', checkPermission('update', 'whatsapp'), validateBody(connectSchema), async (req, res) => {
  try {
    requireTenant();
    if (!isCredentialEncryptionConfigured()) {
      throw new HttpError(503, 'This server cannot store credentials securely yet.', 'ENCRYPTION_NOT_CONFIGURED');
    }

    const { accessToken, appSecret } = await resolveSecrets(req.body);
    if (!accessToken) throw new HttpError(400, 'Paste your access token to continue.', 'TOKEN_REQUIRED');
    // Without the secret no webhook can be verified, so inbound messages would be
    // refused silently. Better to stop here than to "connect" a one-way number.
    if (!appSecret) throw new HttpError(400, 'Paste your App Secret to continue.', 'APP_SECRET_REQUIRED');

    const token = await inspectToken(accessToken, appSecret).catch((err) => {
      throw new HttpError(400, asMetaError(err).userMessage, 'TOKEN_INVALID');
    });
    if (!token.valid) throw new HttpError(400, 'Meta says this token is not valid.', 'TOKEN_INVALID');
    if (token.appSecretValid === false) {
      throw new HttpError(400, 'That App Secret does not belong to the app this token was made for.', 'APP_SECRET_INVALID');
    }

    // The number's own health check names the account that holds it. Taking the
    // account from here, not from the user, is what prevents saving a sibling
    // account that can read the number but not send from it.
    const number = await numberHealth(accessToken, req.body.phoneNumberId).catch((err) => {
      throw new HttpError(400, asMetaError(err).userMessage, 'NUMBER_UNREACHABLE');
    });

    await saveCloudCredentials({
      phoneNumberId: number.phoneNumberId,
      wabaId: number.wabaId,
      businessId: number.businessId,
      appId: token.appId,
      accessToken: req.body.accessToken?.trim() || undefined,
      appSecret: req.body.appSecret?.trim() || null,
    });
    invalidateHealth();

    const steps: StepResult[] = [];
    try {
      await providerByName('meta').connect();
      steps.push({ id: 'verify', status: 'ok', code: 'VERIFIED', detail: number.displayPhoneNumber });
    } catch (err) {
      steps.push({ id: 'verify', status: 'fail', code: 'VERIFY_FAILED', detail: err instanceof Error ? err.message : String(err) });
    }

    if (number.wabaId) {
      try {
        await subscribeApp(accessToken, number.wabaId);
        steps.push({ id: 'subscribe', status: 'ok', code: 'SUBSCRIBED' });
      } catch (err) {
        steps.push({ id: 'subscribe', status: 'fail', code: 'SUBSCRIBE_FAILED', detail: asMetaError(err).userMessage });
      }
    }

    let manualWebhook: { callbackUrl: string | null; verifyToken: string | null } | null = null;
    try {
      const state = await getWebhookState(token.appId!, appSecret);
      if (!state.matches) await configureWebhook(token.appId!, appSecret);
      steps.push({ id: 'webhook', status: 'ok', code: 'WEBHOOK_OK' });
    } catch (err) {
      // Usually PUBLIC_API_URL is not reachable from the internet (local dev).
      // Hand the manager the two values to paste instead of a dead end.
      manualWebhook = {
        callbackUrl: webhookCallbackUrl(),
        verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? null,
      };
      steps.push({ id: 'webhook', status: 'fail', code: 'WEBHOOK_AUTO_FAILED', detail: err instanceof Error ? err.message : String(err) });
    }

    const probe = await probeSendPermission(accessToken, number.phoneNumberId);
    steps.push(
      probe === 'ok' ? { id: 'sending', status: 'ok', code: 'SENDING_OK' }
      : probe === 'not_registered' ? { id: 'sending', status: 'fail', code: 'NOT_REGISTERED_HERE' }
      : probe === 'token' ? { id: 'sending', status: 'fail', code: 'TOKEN_INVALID' }
      : { id: 'sending', status: 'warn', code: 'SENDING_UNKNOWN' },
    );
    if (number.issues[0]) {
      steps.push({ id: 'account', status: number.canSend === false ? 'fail' : 'warn', code: number.issues[0].code, detail: number.issues[0].message });
    }

    // Approved templates already in Meta become usable immediately. Not awaited:
    // a large catalogue must not hold the setup screen.
    void (async () => {
      try {
        const channel = await getChannel();
        if (channel.cloud) await syncTemplates(channel.cloud);
      } catch (err) {
        logger.warn('channel.initial_template_sync_failed', { error: err instanceof Error ? err.message : String(err) });
      }
    })();

    res.json({ steps, manualWebhook, channel: await channelView() });
  } catch (err) {
    handle(res, err);
  }
});

const registerSchema = z.object({ pin: z.string().trim().regex(/^\d{6}$/, 'The PIN is 6 digits') });

/** Move a number registered with another provider (or app) to this one. */
router.post('/register', checkPermission('update', 'whatsapp'), validateBody(registerSchema), async (req, res) => {
  try {
    requireTenant();
    const cloud = (await getChannel()).cloud;
    if (!cloud) throw new HttpError(409, 'Connect a number first.', 'CLOUD_API_NOT_CONFIGURED');
    try {
      await registerNumber(cloud.accessToken, cloud.phoneNumberId, req.body.pin);
    } catch (err) {
      const meta = asMetaError(err);
      // 133005 is Meta's "PIN mismatch"; worth naming, since it is the usual outcome of a guess.
      const code = meta.code === 133005 ? 'PIN_MISMATCH' : meta.code === 133016 ? 'REGISTER_RATE_LIMITED' : 'REGISTER_FAILED';
      throw new HttpError(400, meta.userMessage, code);
    }
    invalidateHealth();
    const probe = await probeSendPermission(cloud.accessToken, cloud.phoneNumberId);
    res.json({ registered: true, canSend: probe === 'ok' });
  } catch (err) {
    handle(res, err);
  }
});

/** Point the Meta app's webhook at this server again (after a domain change, say). */
router.post('/webhook', checkPermission('update', 'whatsapp'), async (_req, res) => {
  try {
    requireTenant();
    const cloud = (await getChannel()).cloud;
    if (!cloud?.appId || !cloud.appSecret) {
      throw new HttpError(409, 'Reconnect with your App Secret first.', 'NO_APP_SECRET');
    }
    try {
      await configureWebhook(cloud.appId, cloud.appSecret);
    } catch (err) {
      return res.json({
        configured: false,
        error: err instanceof Error ? err.message : String(err),
        manualWebhook: { callbackUrl: webhookCallbackUrl(), verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? null },
      });
    }
    invalidateHealth();
    res.json({ configured: true });
  } catch (err) {
    handle(res, err);
  }
});

/**
 * Plain-language health of the connection. Several Graph calls deep, so results
 * are cached briefly per tenant; managers can force a fresh run.
 */
const healthCache = new Map<string, { at: number; report: HealthReport }>();
const HEALTH_TTL_MS = 60_000;
function invalidateHealth() {
  const tenantId = getTenantId();
  if (tenantId) healthCache.delete(tenantId);
}

/**
 * Is Meta letting this number send right now? Read by the app-wide banner for
 * every signed-in user (not only managers): a salesperson whose sends fail
 * should see why and where to pay, instead of waiting on the admin. Cheap — the
 * underlying Meta probe runs at most every 10 minutes.
 */
router.get('/sending-status', async (req: AuthRequest, res) => {
  try {
    requireTenant();
    const tenantId = getTenantId()!;
    const channel = await getChannel();
    if (!channel.cloud) return res.json({ blocked: false, connected: false });
    const { getSendingStatus, owningBusinessId } = await import('../../providers/meta/sending-status');
    const [status, businessId] = await Promise.all([
      getSendingStatus(tenantId, channel.cloud, { fresh: req.query.fresh === '1' }),
      owningBusinessId(channel.cloud),
    ]);
    res.json({ ...status, connected: true, wabaId: channel.cloud.wabaId ?? null, businessId });
  } catch (err) {
    handle(res, err);
  }
});

router.get('/health', checkPermission('read', 'whatsapp'), async (req: AuthRequest, res) => {
  try {
    requireTenant();
    const tenantId = getTenantId()!;
    const fresh = req.query.fresh === '1' && isManager(req.user?.role);
    const hit = healthCache.get(tenantId);
    if (!fresh && hit && Date.now() - hit.at < HEALTH_TTL_MS) return res.json(hit.report);

    const cloud = (await getChannel()).cloud;
    if (!cloud) throw new HttpError(409, 'WhatsApp is not connected yet.', 'CLOUD_API_NOT_CONFIGURED');
    const report = await runHealthChecks(cloud);
    healthCache.set(tenantId, { at: Date.now(), report });
    res.json(report);
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
