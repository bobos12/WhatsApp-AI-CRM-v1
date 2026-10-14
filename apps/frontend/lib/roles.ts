/**
 * Two-tier role model for the UI.
 *
 * The platform now exposes exactly two roles:
 *   - System Manager → full access
 *   - Employee       → limited, scoped access
 *
 * Legacy enum values are still stored in the DB; every one of them collapses
 * into one of the two tiers below. New users created through the UI are stored
 * as a single canonical enum value (`ADMIN` for managers, `AGENT` for
 * employees) so the backend enum/validation stays untouched.
 */

export type SimpleRole = 'SYSTEM_MANAGER' | 'EMPLOYEE';

/** Legacy enum roles that count as a System Manager (full access). */
export const MANAGER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD'] as const;

export function isManager(role?: string | null): boolean {
  return !!role && (MANAGER_ROLES as readonly string[]).includes(role);
}

/** Collapse any stored role into one of the two effective tiers. */
export function toSimpleRole(role?: string | null): SimpleRole {
  return isManager(role) ? 'SYSTEM_MANAGER' : 'EMPLOYEE';
}

/** The canonical enum value persisted for each tier. */
export function simpleRoleToStored(simple: SimpleRole): 'ADMIN' | 'AGENT' {
  return simple === 'SYSTEM_MANAGER' ? 'ADMIN' : 'AGENT';
}

export const SIMPLE_ROLES: SimpleRole[] = ['SYSTEM_MANAGER', 'EMPLOYEE'];

export const SIMPLE_ROLE_LABEL: Record<SimpleRole, string> = {
  SYSTEM_MANAGER: 'System Manager',
  EMPLOYEE: 'Employee',
};

export const SIMPLE_ROLE_BADGE: Record<SimpleRole, string> = {
  SYSTEM_MANAGER: 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  EMPLOYEE: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-ink-3',
};

/** Convenience: human label for a stored role. */
export function roleLabel(role?: string | null): string {
  return SIMPLE_ROLE_LABEL[toSimpleRole(role)];
}
