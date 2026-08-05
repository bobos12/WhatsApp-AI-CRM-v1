import { Router } from 'express';
import { providerManager } from '../../providers/manager';
import { handleMetaWebhook } from '../../providers/meta-webhook.handler';
import qrcode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { authMiddleware, checkPermission } from '../../auth/auth.middleware';
import { processIncomingMessage } from '../../workflow/inbound-workflow';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import {
  getSessionId,
  getAuthSessionId,
  getSock,
  isPairingIdle,
  requestPairingCode,
  getPairingCode,
} from '../../whatsapp/client';
import { getTenantId } from '../../lib/tenant-context';
import { clearDbAuthState } from '../../whatsapp/db-auth-state';
import { getWarmupPhase, startOfToday } from '../../whatsapp/warmup';
import { getFromCache, setInCache, invalidateCache } from '../../lib/status-cache';

const router = Router();

router.use((req, res, next) => {
  if (req.path === '/webhook' || req.path === '/meta-webhook') {
    return next();
  }
  return authMiddleware(req, res, next);
});

router.post('/connect', checkPermission('update', 'whatsapp'), async (req, res) => {
  try {
    // WhatsApp is per-client. The platform operator's own session has no tenant,
    // so there is nothing to connect — return a clear message instead of a 500.
    if (!getTenantId()) {
      return res.status(409).json({
        error: 'WhatsApp is managed per client. Open a client from the operator console to connect their WhatsApp.',
        code: 'NO_TENANT',
      });
    }
    // The auth ROW key, not the live JID — clearing the JID-named key would
    // leave the real credentials behind and the re-scan would resurrect them.
    const authId = getAuthSessionId();
    if (authId) await clearDbAuthState(authId);
    await providerManager.connect();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/reset-auth', checkPermission('update', 'whatsapp'), async (req, res) => {
  try {
    if (!getTenantId()) {
      return res.status(409).json({ error: 'WhatsApp is managed per client.', code: 'NO_TENANT' });
    }
    await providerManager.disconnect();
    const authId = getAuthSessionId();
    if (authId) await clearDbAuthState(authId);
    const authDir = path.resolve(process.cwd(), 'auth_info_baileys');
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/status', checkPermission('read', 'whatsapp'), async (req, res) => {
  try {
    // A tenant-less identity (a pure platform operator) has no WhatsApp of its
    // own. Tell the client so it hides the connect UI instead of prompting to
    // link a number that has nowhere to live.
    if (!getTenantId()) {
      return res.json({ status: 'disconnected', connectedPhone: null, error: null, queueDepth: 0, session: null, tenantless: true });
    }

    // Get connection status immediately (from memory, no DB queries)
    const { status, connectedPhone, error } = providerManager.getStatus();
    // Pairing having given up is a distinct state from "not connected yet": the
    // former needs a button, the latter needs patience. Read live, never cached.
    const pairingIdle = isPairingIdle();
    // A live "link with phone number" code, so a refresh mid-entry doesn't lose
    // it. Read live and never cached — it expires on a clock of its own.
    const live = getPairingCode();
    const pairing = live
      ? { code: live.code, phone: live.phone, expiresAt: live.expiresAt.toISOString() }
      : null;

    // Check in-memory cache first (30-second TTL)
    const sessionId = getAuthSessionId();
    const cacheKey = `whatsapp_session_${sessionId}`;
    const cachedSession = getFromCache(cacheKey);

    if (cachedSession !== null) {
      return res.json({
        status,
        connectedPhone,
        error,
        pairingIdle,
        pairing,
        queueDepth: 0,
        session: cachedSession,
      });
    }

    // Fetch session data (parallel queries for speed)
    let session: any = null;

    if (sessionId && sessionId !== 'default') {
      try {
        // Fetch both session creation date and daily count in parallel
        const [whatsappSession, dailySent] = await Promise.all([
          prisma.whatsAppSession.findUnique({
            where: { sessionId },
            select: { createdAt: true, warmupEnabled: true },
          }).catch(() => null),
          // Fast path: Analytics table has pre-aggregated daily counts
          (async () => {
            try {
              const today = startOfToday();
              const analytics = await prisma.analytics.findFirst({
                where: { date: today },
                select: { outgoingMessages: true },
              });
              return analytics?.outgoingMessages ?? 0;
            } catch {
              // If Analytics unavailable, return 0 (don't block response)
              return 0;
            }
          })(),
        ]);

        // Self-heal: if the number is connected but has no session row yet
        // (e.g. it connected before this feature existed), create it now so the
        // dashboard's warm-up card populates without requiring a reconnect.
        let sessionRow = whatsappSession;
        if (!sessionRow && status === 'connected') {
          sessionRow = await prisma.whatsAppSession
            .upsert({ where: { sessionId }, create: { sessionId, data: {}, warmupEnabled: false }, update: {}, select: { createdAt: true, warmupEnabled: true } })
            .catch(() => null);
        }

        if (sessionRow) {
          const warmup = getWarmupPhase(sessionRow.createdAt);

          // Report the EFFECTIVE warm-up state, not the raw age-derived one.
          //
          // `getWarmupPhase()` only knows how old the session is, so it reports
          // `active: true` for any young number regardless of whether the
          // operator actually switched warm-up on. Every consumer then had to
          // remember to AND it with `warmupEnabled`, and the dashboard did not —
          // so a session with warm-up OFF still displayed a ramp and a daily
          // limit that nothing was enforcing. Collapsing the two here means a
          // disabled warm-up is uniformly invisible and no caller can get it
          // wrong. (Sending was never gated: `checkWarmupGate` in sender.ts
          // returns early when `warmupEnabled` is false.)
          const enabled = sessionRow.warmupEnabled;
          const dailyLimit = enabled ? warmup.dailyLimit : null;
          const dailyRemaining = dailyLimit ? Math.max(0, dailyLimit - dailySent) : null;

          session = {
            createdAt: sessionRow.createdAt.toISOString(),
            dayNumber: warmup.dayNumber,
            warmupEnabled: enabled,
            warmup: {
              active: enabled && warmup.active,
              phaseName: warmup.phaseName,
              dailyLimit,
              dailySent,
              dailyRemaining,
              fullyUnlockedAt: enabled ? (warmup.fullyUnlockedAt?.toISOString() || null) : null,
              perMinuteCap: warmup.perMinuteCap,
            },
          };

          // Cache for 30 seconds to avoid repeated queries
          setInCache(cacheKey, session);
        }
      } catch (err) {
        logger.warn('whatsapp_status_session_fetch_failed', { error: err instanceof Error ? err.message : String(err) });
        // Session stays null, that's ok
      }
    }

    // Always respond immediately (no timeouts)
    res.json({
      status,
      connectedPhone,
      error,
      pairingIdle,
      pairing,
      queueDepth: 0,
      session,
    });
  } catch (err) {
    logger.error('whatsapp_status_error', { error: err instanceof Error ? err.message : String(err) });
    const { status, connectedPhone, error } = providerManager.getStatus();
    res.json({
      status,
      connectedPhone,
      error,
      queueDepth: 0,
      session: null,
    });
  }
});

router.patch('/session-settings', checkPermission('update', 'whatsapp'), async (req, res) => {
  try {
    const { warmupEnabled } = req.body;
    if (typeof warmupEnabled !== 'boolean') {
      return res.status(400).json({ error: 'warmupEnabled must be a boolean' });
    }
    // Must be the auth row key: keyed by the live JID this would create a
    // SECOND, credential-less session row instead of updating the real one.
    const sessionId = getAuthSessionId();
    if (!sessionId) return res.status(409).json({ error: 'No tenant in scope', code: 'NO_TENANT' });
    await prisma.whatsAppSession.upsert({
      where: { sessionId },
      create: { sessionId, data: {}, warmupEnabled },
      update: { warmupEnabled },
    });
    invalidateCache(`whatsapp_session_${sessionId}`);
    res.json({ success: true, warmupEnabled });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * Link by phone number instead of by QR.
 *
 * The QR route assumes a second screen: you cannot scan a code with the same
 * phone that is displaying it. Anyone running this CRM from their phone — which
 * is most of them — has no way through that flow at all. WhatsApp's "Link with
 * phone number" issues an 8-character code they type in instead.
 */
router.post('/pairing-code', checkPermission('update', 'whatsapp'), async (req, res) => {
  if (!getTenantId()) {
    return res.status(409).json({ error: 'WhatsApp is managed per client.', code: 'NO_TENANT' });
  }
  try {
    const pairing = await requestPairingCode(String(req.body?.phone ?? ''));
    res.json({
      code: pairing.code,
      phone: pairing.phone,
      expiresAt: pairing.expiresAt.toISOString(),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN';
    // These are all user-actionable states, not server faults — a 500 would make
    // the client show "something went wrong" for "check the number you typed".
    const known: Record<string, { status: number; error: string }> = {
      INVALID_PHONE: { status: 400, error: 'Enter the full number including its country code.' },
      ALREADY_CONNECTED: { status: 409, error: 'WhatsApp is already connected.' },
      PAIRING_TIMEOUT: { status: 504, error: 'WhatsApp did not respond in time. Please try again.' },
    };
    const mapped = known[code];
    if (mapped) return res.status(mapped.status).json({ error: mapped.error, code });
    logger.error('whatsapp_pairing_code_failed', { error: code });
    res.status(500).json({ error: 'Could not get a pairing code. Please try again.' });
  }
});

router.get('/qr', checkPermission('read', 'whatsapp'), (req, res) => {
  const { qr } = providerManager.getStatus();
  if (qr) {
    qrcode.toDataURL(qr, (err, url) => {
      if (err) return res.status(500).json({ error: 'Failed to generate QR' });
      res.json({ qr: url });
    });
  } else {
    res.json({ qr: null });
  }
});

router.post('/disconnect', checkPermission('update', 'whatsapp'), async (req, res) => {
  if (providerManager.getStatus().status === 'disconnected') {
    return res.status(400).json({ error: 'Not connected' });
  }

  await providerManager.disconnect();
  res.json({ success: true });
});

/**
 * TEMPORARY DIAGNOSTIC — asks WhatsApp itself whether this account is under a
 * reachout restriction. Error 463 is ambiguous (`MessageAccountRestriction` and
 * `SenderReachoutTimelocked` are the same code), so it cannot distinguish "this
 * account is restricted" from "Baileys failed to attach a privacy token". This
 * endpoint settles it from the authoritative source. Remove once answered.
 */
router.get('/restriction-status', checkPermission('read', 'whatsapp'), async (_req, res) => {
  try {
    const sock: any = getSock();
    if (!sock) return res.status(409).json({ error: 'No live socket' });

    const timelock = await sock.fetchAccountReachoutTimelock?.().catch((e: any) => ({ queryFailed: e?.message }));
    const chatCap = await sock.fetchNewChatMessageCap?.().catch((e: any) => ({ queryFailed: e?.message }));

    res.json({
      me: sock?.user?.id ?? null,
      reachoutTimelock: timelock ?? 'unsupported by this Baileys build',
      newChatMessageCap: chatCap ?? 'unsupported by this Baileys build',
      connectionStateTimelock: sock?.authState?.creds?.reachoutTimeLock ?? null,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/send', checkPermission('create', 'messages'), async (req, res) => {
  const { phone, contactId, message } = req.body;
  try {
    if (contactId) {
      const contact = await (await import('../../lib/prisma')).prisma.contact.findUnique({
        where: { id: contactId },
      });
      if (!contact) {
        return res.status(404).json({ error: 'Contact not found' });
      }
      await providerManager.sendMessage({ phone: contact.phone, text: message });
    } else {
      await providerManager.sendMessage({ phone, text: message });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
    if (secret && req.headers['x-webhook-secret'] !== secret) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const sessionId = String(req.body?.sessionId || process.env.WHATSAPP_SESSION_ID || 'default').trim();
    const result = await processIncomingMessage(req.body, { sessionId });
    res.json({ success: true, result });
  } catch (error) {
    logger.error('Webhook ingestion failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── Meta Cloud API webhook ──────────────────────────────────────────────────

router.get('/meta-webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.status(403).json({ error: 'Forbidden' });
});

router.post('/meta-webhook', async (req, res) => {
  try {
    if (req.body?.object !== 'whatsapp_business_account') {
      return res.status(400).json({ error: 'Invalid webhook object' });
    }
    const sessionId = process.env.META_PHONE_NUMBER_ID ?? 'meta-default';
    await handleMetaWebhook(req.body, sessionId);
    res.status(200).json({ success: true });
  } catch (err) {
    logger.error('meta_webhook.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
