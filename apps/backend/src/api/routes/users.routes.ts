import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { authMiddleware, requireAdmin } from '../../auth/auth.middleware';
import { excludeDevSuperuser, isDevSuperuserEmail, isManager } from '../../auth/authorize';

const router = Router();

router.use(authMiddleware);

/**
 * The protected owner accounts (the permanent platform owner and the env
 * developer super-account) cannot be touched by any other administrator: no
 * delete, role change, password reset, rename, email change or team move. The
 * owner may still rename themselves and set their own password, but never
 * demote themselves, change their email, or join a team (which would reveal
 * them in member lists). They are also hidden from every user listing — see
 * `excludeDevSuperuser`.
 */
function isProtectedDevSuperuser(user: { email?: string | null } | null | undefined): boolean {
  return isDevSuperuserEmail(user?.email);
}

const PROTECTED_MESSAGE = 'This account is protected and cannot be changed by another administrator.';

// List users — admin sees all, others see only their team
router.get('/', async (req, res) => {
  try {
    const user = (req as any).user;
    const canSeeAll = isManager(user?.role);

    const users = await prisma.user.findMany({
      // Hide the developer super-account from everyone.
      where: canSeeAll ? excludeDevSuperuser() : { teamId: user?.teamId, ...excludeDevSuperuser() },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        teamId: true,
        createdAt: true,
        team: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Create user — admin only
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role, teamId } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (isDevSuperuserEmail(email)) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const validRoles = ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD', 'AGENT', 'ANALYST', 'VIEWER'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    if (teamId) {
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) return res.status(404).json({ error: 'Team not found' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role || 'AGENT',
        teamId: teamId || null,
      },
      select: { id: true, name: true, email: true, role: true, teamId: true, createdAt: true, team: { select: { id: true, name: true } } },
    });

    res.status(201).json(newUser);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Update user — admin only
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { name, email, role, teamId, password } = req.body;
    const validRoles = ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD', 'AGENT', 'ANALYST', 'VIEWER'];

    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const requestingUser = (req as any).user;
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true } });
    if (email && isDevSuperuserEmail(email) && !isProtectedDevSuperuser(target)) {
      return res.status(409).json({ error: 'Email already in use' });
    }
    if (isProtectedDevSuperuser(target)) {
      if (target!.id !== requestingUser?.id) {
        return res.status(403).json({ error: PROTECTED_MESSAGE });
      }
      if (role && role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'The developer super-account cannot be demoted.' });
      }
      if (email && email.toLowerCase() !== target!.email!.toLowerCase()) {
        return res.status(403).json({ error: "The developer super-account's email cannot be changed." });
      }
      if (teamId) {
        return res.status(403).json({ error: 'The developer super-account cannot be added to a team.' });
      }
    }

    const updateData: any = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (role) updateData.role = role;
    if (teamId !== undefined) updateData.teamId = teamId || null;
    if (password) updateData.password = await bcrypt.hash(password, 12);

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      select: { id: true, name: true, email: true, role: true, teamId: true, team: { select: { id: true, name: true } } },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Delete user — admin only
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const requestingUser = (req as any).user;
    if (req.params.id === requestingUser.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { email: true } });
    if (isProtectedDevSuperuser(target)) {
      return res.status(403).json({ error: 'The developer super-account cannot be deleted.' });
    }

    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Update role — admin only (kept for backward compat)
router.put('/:id/role', requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD', 'AGENT', 'ANALYST', 'VIEWER'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { email: true } });
    if (isProtectedDevSuperuser(target)) {
      return res.status(403).json({ error: PROTECTED_MESSAGE });
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
      select: { id: true, name: true, email: true, role: true, teamId: true },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Move to team — admin only (kept for backward compat)
router.put('/:id/team', requireAdmin, async (req, res) => {
  try {
    const { teamId } = req.body;
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { email: true } });
    if (isProtectedDevSuperuser(target)) {
      return res.status(403).json({ error: PROTECTED_MESSAGE });
    }
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { teamId: teamId || null },
      select: { id: true, name: true, email: true, role: true, teamId: true },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
