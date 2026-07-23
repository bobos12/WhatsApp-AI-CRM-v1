/**
 * Platform console API — how the operator (PLATFORM_OWNER) manages tenants.
 *
 * Every route is gated to PLATFORM_OWNER and runs cross-tenant on purpose, so it
 * uses the UNSCOPED client. This is the single backend surface the future admin
 * dashboard (Phase 9) will call; today it is usable directly / via curl.
 *
 *   GET    /api/platform/tenants                 list every tenant + a few stats
 *   POST   /api/platform/tenants                 create a tenant (+ owner login)
 *   POST   /api/platform/tenants/:id/suspend     block logins, drop the WA socket
 *   POST   /api/platform/tenants/:id/activate    re-enable a suspended tenant
 *   POST   /api/platform/tenants/:id/impersonate mint a scoped token for support
 *   DELETE /api/platform/tenants/:id             delete a tenant and all its data
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prismaUnscoped } from '../../lib/prisma';
import { env } from '../../lib/env';
import { authMiddleware } from '../../auth/auth.middleware';
import { isDevSuperuserEmail } from '../../auth/authorize';
import { provisionTenant } from '../../tenants/provision-tenant.service';
import { sessionManager } from '../../whatsapp/session-manager';
import { aiConfigService } from '../../services/ai-config.service';
import { logger } from '../../lib/logger';

const router = Router();

/**
 * Gate: the platform console is for the operator. That means the PLATFORM_OWNER
 * role, OR the developer super-account (which already carries cross-tenant scope
 * and is the ultimate operator identity).
 */
function requirePlatformOwner(req: Request, res: Response, next: NextFunction) {
  return authMiddleware(req as any, res, () => {
    const user = (req as any).user;
    const allowed = user?.role === 'PLATFORM_OWNER' || isDevSuperuserEmail(user?.email);
    if (!allowed) {
      return res.status(403).json({ error: 'Platform owner access required' });
    }
    next();
  });
}

// Authenticated (but NOT operator-gated) probe the frontend uses to decide
// whether to surface the platform console. Returns a boolean, never 403 — so a
// normal tenant user simply gets { isOperator: false } instead of an error.
router.get('/access', (req, res) =>
  authMiddleware(req as any, res, () => {
    const user = (req as any).user;
    const isOperator = user?.role === 'PLATFORM_OWNER' || isDevSuperuserEmail(user?.email);
    res.json({ isOperator: Boolean(isOperator) });
  }),
);

// Everything below is operator-only.
router.use(requirePlatformOwner);

// ── List tenants ──────────────────────────────────────────────────────────────
router.get('/tenants', async (_req, res) => {
  const tenants = await prismaUnscoped.tenant.findMany({ orderBy: { createdAt: 'desc' } });
  const rows = await Promise.all(
    tenants.map(async (t) => {
      const [users, contacts, session] = await Promise.all([
        prismaUnscoped.user.count({ where: { tenantId: t.id } }),
        prismaUnscoped.contact.count({ where: { tenantId: t.id } }),
        prismaUnscoped.whatsAppSession.findFirst({ where: { tenantId: t.id }, select: { sessionId: true } }),
      ]);
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        createdAt: t.createdAt,
        users,
        contacts,
        whatsapp: {
          hasSession: Boolean(session),
          status: sessionManager.getStatus(t.id),
          connectedNumber: sessionManager.getConnectedNumber(t.id),
        },
      };
    }),
  );
  res.json({ tenants: rows });
});

// ── Create tenant ─────────────────────────────────────────────────────────────
router.post('/tenants', async (req, res) => {
  const { name, ownerEmail, ownerPassword, ownerName, slug } = req.body ?? {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'A tenant name is required' });
  }
  if (ownerEmail && !ownerPassword) {
    return res.status(400).json({ error: 'ownerPassword is required when ownerEmail is set' });
  }
  try {
    const result = await provisionTenant({ name, slug, ownerEmail, ownerPassword, ownerName });
    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A duplicate owner email or slug surfaces as a unique-constraint violation.
    logger.error('platform.create_tenant_failed', { message });
    res.status(400).json({ error: `Could not create tenant: ${message}` });
  }
});

// ── Suspend / activate ────────────────────────────────────────────────────────
router.post('/tenants/:id/suspend', async (req, res) => {
  const { id } = req.params;
  const tenant = await prismaUnscoped.tenant.findUnique({ where: { id }, select: { id: true } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  await prismaUnscoped.tenant.update({ where: { id }, data: { status: 'SUSPENDED' } });
  // Drop the WhatsApp socket immediately; data is untouched.
  await sessionManager.disconnect(id).catch(() => undefined);
  logger.info('platform.tenant_suspended', { tenantId: id });
  res.json({ success: true });
});

router.post('/tenants/:id/activate', async (req, res) => {
  const { id } = req.params;
  const tenant = await prismaUnscoped.tenant.findUnique({ where: { id }, select: { id: true } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  await prismaUnscoped.tenant.update({ where: { id }, data: { status: 'ACTIVE' } });
  // Reconnect if the tenant already had a WhatsApp session.
  const session = await prismaUnscoped.whatsAppSession.findFirst({ where: { tenantId: id }, select: { id: true } });
  if (session) sessionManager.connect(id).catch(() => undefined);
  logger.info('platform.tenant_activated', { tenantId: id });
  res.json({ success: true });
});

// ── Impersonate (support) ─────────────────────────────────────────────────────
// Mint a short-lived access token for the tenant's owner so the operator can see
// exactly what the client sees. Uses the tenant's first SUPER_ADMIN.
router.post('/tenants/:id/impersonate', async (req, res) => {
  const { id } = req.params;
  const owner = await prismaUnscoped.user.findFirst({
    where: { tenantId: id, role: 'SUPER_ADMIN' },
    select: { id: true, email: true, name: true, role: true, teamId: true, tenantId: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) return res.status(404).json({ error: 'Tenant has no owner to impersonate' });

  const token = jwt.sign(
    { id: owner.id, email: owner.email, name: owner.name, role: owner.role, teamId: owner.teamId, tenantId: owner.tenantId },
    env.jwtSecret,
    { expiresIn: '30m' },
  );
  logger.info('platform.impersonate', { tenantId: id, asUser: owner.id });
  res.json({ token, user: owner });
});

// ── Delete a tenant and all its data ──────────────────────────────────────────
// Ordered child→parent so foreign keys never block a delete. Irreversible.
router.delete('/tenants/:id', async (req, res) => {
  const { id } = req.params;
  const tenant = await prismaUnscoped.tenant.findUnique({ where: { id }, select: { id: true } });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

  await sessionManager.disconnect(id).catch(() => undefined);

  try {
    const where = { tenantId: id };
    // Leaf rows first, then their parents.
    await prismaUnscoped.messageReaction.deleteMany({ where });
    await prismaUnscoped.leadStatusEvent.deleteMany({ where });
    await prismaUnscoped.leadQualification.deleteMany({ where });
    await prismaUnscoped.notification.deleteMany({ where });
    await prismaUnscoped.internalNote.deleteMany({ where });
    await prismaUnscoped.message.deleteMany({ where });
    await prismaUnscoped.task.deleteMany({ where });
    await prismaUnscoped.deal.deleteMany({ where });
    await prismaUnscoped.broadcastRecipient.deleteMany({ where });
    await prismaUnscoped.broadcast.deleteMany({ where });
    await prismaUnscoped.automationFlowExecution.deleteMany({ where });
    await prismaUnscoped.automationFlow.deleteMany({ where });
    await prismaUnscoped.automationRule.deleteMany({ where });
    await prismaUnscoped.conversation.deleteMany({ where });
    await prismaUnscoped.contact.deleteMany({ where });
    await prismaUnscoped.tag.deleteMany({ where });
    await prismaUnscoped.customFieldDefinition.deleteMany({ where });
    await prismaUnscoped.savedReply.deleteMany({ where });
    await prismaUnscoped.messageTemplate.deleteMany({ where });
    await prismaUnscoped.analytics.deleteMany({ where });
    await prismaUnscoped.auditLog.deleteMany({ where });
    await prismaUnscoped.whatsAppSession.deleteMany({ where });
    await prismaUnscoped.setting.deleteMany({ where });
    // Users last — detach team ownership first to avoid the Team.ownerId FK.
    await prismaUnscoped.user.updateMany({ where, data: { teamId: null } });
    await prismaUnscoped.team.deleteMany({ where });
    await prismaUnscoped.user.deleteMany({ where });
    await prismaUnscoped.tenant.delete({ where: { id } });
    // Remove the tenant's per-tenant bot config file too.
    aiConfigService.remove(id);
    logger.info('platform.tenant_deleted', { tenantId: id });
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('platform.delete_tenant_failed', { tenantId: id, message });
    res.status(500).json({ error: `Could not fully delete tenant: ${message}` });
  }
});

export default router;
