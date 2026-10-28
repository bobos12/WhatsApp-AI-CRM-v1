import { Router } from 'express';
import { authMiddleware } from '../../auth/auth.middleware';
import { notificationsService } from '../../notifications/notifications.service';
import { pushService } from '../../notifications/push.service';

const router = Router();
router.use(authMiddleware);

function userId(req: any): string {
  return req.user?.id;
}

// ── POST /api/notifications/test — send myself a test on every registered device ──
// Always delivered: bypasses switched-off categories and the "own action" rule.
router.post('/test', async (req, res) => {
  try {
    const devices = await pushService.deviceCount(userId(req));
    await notificationsService.notify({
      type: 'TEST',
      recipients: [userId(req)],
      title: { en: 'Notifications are working', ar: 'الإشعارات تعمل' },
      body: {
        en: 'This is a test. You will get alerts like this for new messages and assignments.',
        ar: 'هذا إشعار تجريبي. ستصلك تنبيهات مثله عند وصول رسائل جديدة أو إسناد محادثات إليك.',
      },
      url: '/settings?section=notifications',
    });
    res.json({ success: true, devices, pushEnabled: pushService.isEnabled() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── GET/PUT /api/notifications/preferences — categories I switched off ───────────
router.get('/preferences', async (req, res) => {
  try {
    res.json(await notificationsService.getPreferences(userId(req)));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.put('/preferences', async (req, res) => {
  try {
    const off = Array.isArray(req.body?.off) ? req.body.off.filter((x: unknown) => typeof x === 'string') : [];
    res.json(await notificationsService.setPreferences(userId(req), off));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── POST /api/notifications/conversation/:id/read — opened that chat ────────────
router.post('/conversation/:conversationId/read', async (req, res) => {
  try {
    const cleared = await notificationsService.markConversationRead(userId(req), req.params.conversationId);
    res.json({ success: true, cleared });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── GET /api/notifications — recent notifications for the current user ──────────
router.get('/', async (req, res) => {
  try {
    const unreadOnly = (req.query.unreadOnly as string) === 'true';
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const items = await notificationsService.list(userId(req), { unreadOnly, limit });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── GET /api/notifications/unread-count ────────────────────────────────────────
router.get('/unread-count', async (req, res) => {
  try {
    const count = await notificationsService.unreadCount(userId(req));
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── POST /api/notifications/read-all ───────────────────────────────────────────
router.post('/read-all', async (req, res) => {
  try {
    await notificationsService.markAllRead(userId(req));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ── POST /api/notifications/:id/read ───────────────────────────────────────────
router.post('/:id/read', async (req, res) => {
  try {
    await notificationsService.markRead(userId(req), req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
