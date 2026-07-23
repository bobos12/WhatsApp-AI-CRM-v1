/**
 * Platform-owner provisioner.
 *
 * The PLATFORM_OWNER is the operator of the whole deployment (you): the identity
 * that manages tenants (create/suspend/impersonate) and is the only role that
 * sees across every tenant. It lives above all tenants (tenantId = null), so the
 * tenant-guard is bypassed for it (see auth.middleware `isPlatformIdentity`).
 *
 * Seeded from `PLATFORM_OWNER_EMAIL` / `PLATFORM_OWNER_PASSWORD`. Create-only so
 * the operator can safely change their own password later; if the account exists
 * with the wrong role it is upgraded to PLATFORM_OWNER (and detached from any
 * tenant) so the platform console is never locked out.
 *
 * Runs at boot inside platform scope (see index.ts), so `prisma` is unguarded here.
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export async function provisionPlatformOwner(): Promise<void> {
  const email = process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_OWNER_PASSWORD;
  const name = process.env.PLATFORM_OWNER_NAME?.trim() || 'Platform Owner';
  if (!email || !password) return; // feature disabled

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Ensure the account is a tenant-less PLATFORM_OWNER; never clobber the password.
      if (existing.role !== 'PLATFORM_OWNER' || existing.tenantId !== null) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { role: 'PLATFORM_OWNER', tenantId: null },
        });
        logger.info('Platform owner role reasserted', { email });
      }
      return;
    }

    const hashed = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: { name, email, password: hashed, role: 'PLATFORM_OWNER', tenantId: null },
    });
    logger.info('Platform owner account created', { email });
  } catch (err) {
    logger.error('Failed to provision platform owner', {
      email,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
