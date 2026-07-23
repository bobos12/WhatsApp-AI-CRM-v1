import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ambient tenant scope for the current async execution.
 *
 * This is the single source of truth the Prisma tenant-guard (lib/prisma.ts)
 * reads to decide which tenant's rows a query may touch. It is established once
 * at each entrypoint and then flows automatically through every awaited call:
 *   - HTTP requests: auth.middleware sets it from the caller's JWT.
 *   - Socket.IO: the handshake sets it from the token.
 *   - Background jobs / schedulers / inbound WhatsApp handlers: the caller wraps
 *     the unit of work in `runWithTenant()` (per-tenant) or `runAsPlatform()`
 *     (cross-tenant system work).
 *
 * The guard FAILS CLOSED: a tenant-scoped query executed with no context here
 * throws, so a forgotten wrapper surfaces as a loud error in development rather
 * than a silent cross-tenant data leak in production.
 */
export interface TenantContext {
  /**
   * The tenant whose data this execution may read/write. Null is only valid
   * together with `platform: true` (a deliberate cross-tenant scope).
   */
  tenantId: string | null;
  userId?: string | null;
  role?: string | null;
  /**
   * Platform scope: the tenant-guard is bypassed and queries see every tenant.
   * Reserved for PLATFORM_OWNER requests, the dev superuser, system boot, and
   * schedulers that must scan all tenants before entering a per-tenant scope.
   */
  platform?: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

/** Run `fn` scoped to a single tenant. All Prisma queries inside are fenced to it. */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return storage.run({ tenantId }, fn);
}

/** Run `fn` with an explicit context object (used when userId/role are known). */
export function runWithContext<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Run `fn` with full cross-tenant access (guard bypassed).
 * Use ONLY for trusted system work: boot/provisioning, the platform console,
 * and schedulers that must enumerate every tenant before narrowing scope.
 */
export function runAsPlatform<T>(fn: () => T): T {
  return storage.run({ tenantId: null, platform: true }, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/** Current tenant id, or null when unset / in platform scope. */
export function getTenantId(): string | null {
  return storage.getStore()?.tenantId ?? null;
}

/** Current tenant id, throwing if there is no per-tenant scope established. */
export function requireTenantId(): string {
  const ctx = storage.getStore();
  if (!ctx || ctx.tenantId == null) {
    throw new Error('requireTenantId: no tenant in the current context');
  }
  return ctx.tenantId;
}

/** True when the current scope has full cross-tenant (platform) access. */
export function isPlatformScope(): boolean {
  return storage.getStore()?.platform === true;
}
