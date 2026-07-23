import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { env } from '../lib/env';
import { isManager, type Role } from './authorize';
import { runAsPlatform, runWithContext } from '../lib/tenant-context';

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: Role;
    teamId: string | null;
    tenantId: string | null;
  };
}

/**
 * Platform identities have no owning tenant (tenantId === null): the PLATFORM_OWNER
 * and the developer super-account. They run with the tenant-guard bypassed so they
 * can see across every tenant. Every ordinary tenant user carries a tenantId and is
 * fenced to it.
 */
function isPlatformIdentity(user: { role: string; tenantId: string | null }): boolean {
  return user.role === 'PLATFORM_OWNER' || user.tenantId == null;
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(token, env.jwtSecret) as { id: string };
    // The user lookup precedes knowing the tenant, so it runs in platform scope;
    // the request itself is then scoped to the user's tenant below. NOTE: the
    // `await` must be INSIDE runAsPlatform — a Prisma query is lazy, so returning
    // it unawaited would execute it after the scope has already exited.
    const user = await runAsPlatform(async () => {
      return await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, name: true, role: true, teamId: true, tenantId: true },
      });
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // A suspended tenant's users cannot use the app; their data is preserved.
    if (user.tenantId) {
      const tenant = await runAsPlatform(async () => {
        return await prisma.tenant.findUnique({ where: { id: user.tenantId! }, select: { status: true } });
      });
      if (tenant?.status === 'SUSPENDED') {
        return res.status(403).json({ error: 'This account is suspended. Please contact support.' });
      }
    }

    req.user = user;

    // Establish the tenant scope for the entire downstream request. Because
    // Express invokes the next handler synchronously inside this call, the
    // AsyncLocalStorage context flows through every awaited DB call in the route.
    const platform = isPlatformIdentity(user);
    runWithContext(
      { tenantId: user.tenantId ?? null, userId: user.id, role: user.role, platform },
      () => next(),
    );
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

/** Gate a route to System Managers (full-access tier) only. */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  return authMiddleware(req, res, () => {
    if (!req.user || !isManager(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

/**
 * Resources that any authenticated user may delete (they own the content).
 * Critical data (contacts, conversations, users) stays manager-only.
 */
const SELF_SERVICE_DELETABLE = new Set([
  'templates',
  'broadcasts',
  'saved-replies',
  'tags',
]);

/**
 * Two-tier permission gate.
 *   - System Managers (SUPER_ADMIN, ADMIN, TEAM_LEAD): full access.
 *   - Employees (AGENT, ANALYST, VIEWER): read/create/update plus delete on
 *     self-service resources; blocked from deleting critical data.
 */
export function checkPermission(action: string, resource: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    return authMiddleware(req, res, () => {
      const role = req.user?.role;
      if (!role) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (isManager(role)) {
        return next();
      }

      // Employees: block destructive deletes on critical resources only.
      if (action === 'delete' && !SELF_SERVICE_DELETABLE.has(resource)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      next();
    });
  };
}
