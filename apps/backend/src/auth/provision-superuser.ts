/**
 * Developer super-account provisioner.
 *
 * When `DEV_SUPERUSER_EMAIL` / `DEV_SUPERUSER_PASSWORD` are configured (see
 * `env.devSuperuser`), this runs once on startup and force-keeps the account as
 * a SUPER_ADMIN whose password matches the environment. The env is the single
 * source of truth, so the developer who built the system can always log in to
 * any deployment/database with full cross-team access — even if the account was
 * deleted, demoted, or its password changed through the UI.
 *
 * SUPER_ADMIN already grants unrestricted access via `teamScope` / `isAdmin`
 * (see auth/authorize.ts); this just guarantees the account always exists.
 *
 * The users API additionally refuses to delete, demote, or rename this account
 * (see api/routes/users.routes.ts) so another admin cannot lock the developer out.
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { env } from '../lib/env';
import { PERMANENT_PLATFORM_OWNER_EMAIL } from './authorize';
import { logger } from '../lib/logger';

export async function provisionDevSuperuser(): Promise<void> {
  await reassertPermanentOwner();

  const cfg = env.devSuperuser;
  if (!cfg) return; // feature disabled

  try {
    const hashed = await bcrypt.hash(cfg.password, 12);
    const existing = await prisma.user.findUnique({ where: { email: cfg.email } });

    if (existing) {
      // Re-assert the canonical state on every boot: role + password from env.
      await prisma.user.update({
        where: { id: existing.id },
        data: { name: cfg.name, role: 'SUPER_ADMIN', password: hashed },
      });
      logger.info('Developer super-account refreshed', { email: cfg.email });
    } else {
      await prisma.user.create({
        data: { name: cfg.name, email: cfg.email, password: hashed, role: 'SUPER_ADMIN' },
      });
      logger.info('Developer super-account created', { email: cfg.email });
    }
  } catch (err) {
    // Never let provisioning crash the server; log loudly and continue.
    logger.error('Failed to provision developer super-account', {
      email: cfg.email,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Keep the permanent platform owner (see authorize.ts) at full access on every
 * boot, independent of env configuration. Never creates the account or touches
 * its password — only restores the role if something demoted it.
 */
async function reassertPermanentOwner(): Promise<void> {
  try {
    const owner = await prisma.user.findFirst({
      where: { email: { equals: PERMANENT_PLATFORM_OWNER_EMAIL, mode: 'insensitive' } },
      select: { id: true, role: true },
    });
    if (owner && owner.role !== 'SUPER_ADMIN' && owner.role !== 'PLATFORM_OWNER') {
      await prisma.user.update({ where: { id: owner.id }, data: { role: 'SUPER_ADMIN' } });
      logger.info('Permanent platform owner role restored', { email: PERMANENT_PLATFORM_OWNER_EMAIL });
    }
  } catch (err) {
    logger.error('Failed to reassert permanent platform owner', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
