import { Router, type Request } from 'express';
import { AnalyticsService } from '../../analytics/analytics.service';
import { authMiddleware, checkPermission } from '../../auth/auth.middleware';
import type { AuthActor } from '../../auth/authorize';

const router = Router();

router.use(authMiddleware);

/**
 * The caller, as the authorization helpers want it. Every endpoint here scopes
 * by team — a KPI card links to a list, so counting rows the list would not
 * show makes the card wrong rather than merely generous.
 */
function actorOf(req: Request): AuthActor {
  const u = (req as any).user ?? {};
  return { id: u.id, role: u.role, teamId: u.teamId ?? null };
}

/**
 * The viewer's IANA zone, so "today" means their today. Validated in the
 * service (it reaches `AT TIME ZONE`), falling back to UTC.
 */
function tzOf(req: Request): string | undefined {
  const tz = req.query.tz;
  return typeof tz === 'string' && tz.length > 0 && tz.length <= 64 ? tz : undefined;
}

router.get('/overview', checkPermission('read', 'dashboard'), async (req, res) => {
  try {
    const overview = await AnalyticsService.getOverview(actorOf(req), tzOf(req));
    res.json(overview);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : 'Unknown error') });
  }
});

router.get('/messages', checkPermission('read', 'dashboard'), async (req, res) => {
  try {
    const days = Number(req.query.days);
    const messages = await AnalyticsService.getMessagesChart(
      actorOf(req),
      tzOf(req),
      Number.isFinite(days) ? days : 7,
    );
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : 'Unknown error') });
  }
});

router.get('/agents', checkPermission('read', 'dashboard'), async (req, res) => {
  try {
    const stats = await AnalyticsService.getAgentStats(actorOf(req));
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : 'Unknown error') });
  }
});

router.get('/pipeline', checkPermission('read', 'dashboard'), async (req, res) => {
  try {
    const stats = await AnalyticsService.getPipelineStats(actorOf(req));
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : 'Unknown error') });
  }
});

export default router;
