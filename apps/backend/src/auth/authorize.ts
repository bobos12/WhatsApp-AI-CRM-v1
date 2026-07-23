/**
 * Centralized authorization helpers.
 *
 * The app uses team-based ownership: most resources carry a nullable `teamId`.
 * These helpers enforce a consistent, safe rule across services so a member of
 * one team cannot read/modify another team's explicitly-owned records (IDOR),
 * while leaving shared (null-team) records accessible — which preserves
 * existing single-/shared-org workflows.
 */

import { env } from '../lib/env';

export type Role = 'PLATFORM_OWNER' | 'SUPER_ADMIN' | 'ADMIN' | 'TEAM_LEAD' | 'AGENT' | 'ANALYST' | 'VIEWER';

/** The hidden developer super-account's email, or null when not configured. */
export function devSuperuserEmail(): string | null {
  return env.devSuperuser?.email ?? null;
}

/** True when this email belongs to the developer super-account. */
export function isDevSuperuserEmail(email?: string | null): boolean {
  const dev = devSuperuserEmail();
  return !!dev && !!email && email.toLowerCase() === dev;
}

/**
 * Prisma `User` where-fragment that hides the developer super-account from any
 * listing shown to customers. Spread into a `findMany` `where`. Returns {} (no
 * effect) when no developer account is configured.
 *
 *   where: { ...someFilters, ...excludeDevSuperuser() }
 */
export function excludeDevSuperuser(): Record<string, unknown> {
  const email = devSuperuserEmail();
  return email ? { email: { not: email } } : {};
}

export interface AuthActor {
  id: string;
  role?: Role | string;
  teamId?: string | null;
}

/**
 * Two-tier role model. Every legacy enum role collapses into one of two
 * effective roles:
 *   - "System Manager" (full access): SUPER_ADMIN, ADMIN, TEAM_LEAD
 *   - "Employee" (scoped access):     AGENT, ANALYST, VIEWER
 * Existing enum values are preserved in the DB so no destructive migration is
 * needed; access is decided purely by which tier a role falls into.
 */
export const MANAGER_ROLES = new Set<string>(['PLATFORM_OWNER', 'SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD']);

/** True when the role grants full ("System Manager") access. */
export function isManager(role?: Role | string): boolean {
  return !!role && MANAGER_ROLES.has(role);
}

/**
 * Back-compat alias. Historically "admin" gated full access; under the
 * two-tier model that is exactly a System Manager, so this delegates to
 * `isManager` and every existing call site keeps working.
 */
export function isAdmin(role?: Role | string): boolean {
  return isManager(role);
}

/** Collapse any legacy enum role into the two-tier label used by the UI. */
export function simpleRole(role?: Role | string): 'SYSTEM_MANAGER' | 'EMPLOYEE' {
  return isManager(role) ? 'SYSTEM_MANAGER' : 'EMPLOYEE';
}

/** Base HTTP-aware error so routes/global handler can map to a status code. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'You do not have access to this resource') {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found') {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

/**
 * Prisma `where` fragment limiting a query to records the actor may access.
 * - Admins: no restriction (full access across teams).
 * - Team members: their own team's records plus shared (null-team) records.
 * - Team-less non-admins: shared (null-team) records only.
 *
 * Use for list/read endpoints when you want to filter results by ownership.
 */
export function teamScope(actor: AuthActor): Record<string, unknown> {
  if (isAdmin(actor.role)) return {};
  if (actor.teamId) return { OR: [{ teamId: actor.teamId }, { teamId: null }] };
  return { teamId: null };
}

/**
 * Assert the actor may act on a fetched record. Throws `ForbiddenError` only
 * when the record belongs to a *different* non-null team — shared (null-team)
 * and same-team records are always allowed; admins always pass.
 *
 * Use on by-id read/update/delete paths to close cross-team IDOR safely.
 */
export function assertTeamAccess(actor: AuthActor, record: { teamId?: string | null } | null | undefined): void {
  if (!record) throw new NotFoundError();
  if (isAdmin(actor.role)) return;
  const recordTeam = record.teamId ?? null;
  if (recordTeam !== null && recordTeam !== (actor.teamId ?? null)) {
    throw new ForbiddenError();
  }
}
