import { prismaUnscoped } from '../lib/prisma';
import { runWithTenant } from '../lib/tenant-context';
import { logger } from '../lib/logger';

/**
 * Run `fn` once for every ACTIVE tenant, each call inside that tenant's scope so
 * the tenant-guard fences all queries and realtime/sends resolve to the right
 * tenant. Used by the interval jobs (no-reply detector, snooze wakeup) that scan
 * on a timer rather than from a request. Per-tenant errors are isolated so one
 * bad tenant never stops the sweep.
 */
export async function forEachActiveTenant(fn: (tenantId: string) => Promise<void>): Promise<void> {
  const tenants = await prismaUnscoped.tenant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  for (const t of tenants) {
    try {
      await runWithTenant(t.id, () => fn(t.id));
    } catch (err) {
      logger.warn('for_each_tenant.error', {
        tenantId: t.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
