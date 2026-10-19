import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authMiddleware, requireAdmin } from '../../auth/auth.middleware';
import { excludeDevSuperuser, isDevSuperuserEmail, isManager } from '../../auth/authorize';

const router = Router();

router.use(authMiddleware);

// List all teams — admin only
router.get('/all', requireAdmin, async (req, res) => {
  try {
    const teams = await prisma.team.findMany({
      include: {
        owner: { select: { id: true, name: true, email: true } },
        members: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(teams);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// All agents/users available for assignment (scoped to requester's team or all for admin)
router.get('/agents', async (req, res) => {
  try {
    const user = (req as any).user;
    const isAdmin = isManager(user?.role);

    const agents = await prisma.user.findMany({
      where: isAdmin
        ? { role: { in: ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD', 'AGENT'] }, ...excludeDevSuperuser() }
        : { teamId: user?.teamId, role: { in: ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD', 'AGENT'] }, ...excludeDevSuperuser() },
      select: { id: true, name: true, email: true, role: true, teamId: true },
      orderBy: { name: 'asc' },
    });
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get the current user's team
router.get('/', async (req, res) => {
  try {
    const user = (req as any).user;
    const team = user?.teamId
      ? await prisma.team.findUnique({
          where: { id: user.teamId },
          include: {
            members: { select: { id: true, name: true, email: true, role: true } },
            owner: { select: { id: true, name: true, email: true } },
          },
        })
      : null;

    res.json({ team });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Create team — admin only
router.post('/', requireAdmin, async (req, res) => {
  try {
    const user = (req as any).user;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Team name is required' });

    const team = await prisma.team.create({
      data: { name, ownerId: user.id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        members: { select: { id: true, name: true, email: true, role: true } },
      },
    });
    res.status(201).json(team);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Update team name — admin only
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Team name is required' });

    const team = await prisma.team.update({
      where: { id: req.params.id },
      data: { name },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        members: { select: { id: true, name: true, email: true, role: true } },
      },
    });
    res.json(team);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Delete team — admin only
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    // Unlink all members before deleting
    await prisma.user.updateMany({ where: { teamId: req.params.id }, data: { teamId: null } });
    await prisma.team.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Add member to team — admin only
router.post('/:id/members', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (isDevSuperuserEmail(target?.email)) {
      return res.status(403).json({ error: 'The developer super-account cannot be added to a team.' });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { teamId: req.params.id },
      select: { id: true, name: true, email: true, role: true },
    });
    res.status(201).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Toggle auto-assign for team — admin only
router.put('/:id/auto-assign', requireAdmin, async (req, res) => {
  try {
    const { autoAssign } = req.body;
    const team = await prisma.team.update({
      where: { id: req.params.id },
      data: { autoAssign: Boolean(autoAssign) },
      select: { id: true, autoAssign: true },
    });
    res.json(team);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Remove member from team — admin only
router.delete('/:id/members/:userId', requireAdmin, async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.params.userId },
      data: { teamId: null },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
