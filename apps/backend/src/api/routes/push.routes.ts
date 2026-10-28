import { Router } from 'express';
import { authMiddleware } from '../../auth/auth.middleware';
import { pushService } from '../../notifications/push.service';

const router = Router();
router.use(authMiddleware);

function userId(req: any): string {
  return req.user?.id;
}

// ── GET /api/push/public-key — VAPID public key + whether push is enabled ──────
router.get('/public-key', (_req, res) => {
  res.json({ enabled: pushService.isEnabled(), publicKey: pushService.publicKey });
});

// ── POST /api/push/status — is this device registered to me? ──────────────────
router.post('/status', async (req, res) => {
  try {
    const endpoint = req.body?.endpoint;
    const registered = typeof endpoint === 'string' && endpoint ? await pushService.hasDevice(userId(req), endpoint) : false;
    res.json({ enabled: pushService.isEnabled(), registered, devices: await pushService.deviceCount(userId(req)) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── POST /api/push/subscribe — register this device for push ───────────────────
// Whoever signs in on a device takes it over: the endpoint is re-pointed to them.
router.post('/subscribe', async (req, res) => {
  try {
    const subscription = req.body?.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: 'Invalid push subscription' });
    }
    await pushService.saveSubscription(
      userId(req),
      subscription,
      req.get('user-agent') || undefined,
      typeof req.body?.locale === 'string' ? req.body.locale : undefined,
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── POST /api/push/unsubscribe — drop this device's subscription ───────────────
router.post('/unsubscribe', async (req, res) => {
  try {
    const endpoint = req.body?.endpoint;
    if (endpoint) await pushService.removeSubscription(userId(req), endpoint);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
