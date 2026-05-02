/**
 * Typed tenant roles and rank-based authorization helpers.
 *
 * TenantRole is the exhaustive set of roles a member may hold within a
 * tenant. Roles are sourced from FGA (the daemon's `ListMyMemberships`
 * RPC), which emits the highest tier the caller satisfies in the
 * three-tier hierarchy `owner > admin > member` (spec
 * `tenant-role-taxonomy`). The Gibson schema adds no custom roles on top
 * of these.
 *
 * ROLE_RANK encodes the privilege hierarchy: a higher number means more
 * privilege. hasRoleAtLeast uses these ranks for a single numeric comparison
 * instead of a fragile list of explicit role-name checks.
 *
 * Usage
 * -----
 *   import { hasRoleAtLeast } from '@/src/lib/auth/roles';
 *
 *   // In a Server Action or Server Component:
 *   const session = await getServerSession();
 *   if (!hasRoleAtLeast(session, activeTenantId, 'admin')) {
 *     return { error: 'forbidden' };
 *   }
 */

import type { GibsonSession } from '@/src/lib/auth';

// ---------------------------------------------------------------------------
// Role type and rank table
// ---------------------------------------------------------------------------

/**
 * Exhaustive set of roles a user may hold within a tenant.
 *
 * Roles are populated server-side on `GibsonSession.user.rolesByTenant`
 * by `getServerSession()` via the daemon's FGA membership lookup. Any
 * role string outside this set is treated as rank 0 (deny) by
 * `hasRoleAtLeast`.
 *
 * Spec: tenant-role-taxonomy — `owner` is now a first-class FGA relation
 * emitted by the daemon for founding users; `admin` and `member` inherit
 * via the computed-union hierarchy (owner > admin > member).
 */
export type TenantRole = 'owner' | 'admin' | 'member';

/**
 * Privilege rank table. Higher number = more privilege.
 *
 * owner (3) >= admin (2) >= member (1)
 *
 * Unknown or unrecognised role strings default to rank 0, which fails every
 * hasRoleAtLeast check — default-deny for unrecognised roles.
 */
export const ROLE_RANK: Record<TenantRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

// ---------------------------------------------------------------------------
// Authorization helper
// ---------------------------------------------------------------------------

/**
 * Return true when the session's role in `tenantId` is at least `required`.
 *
 * The hierarchy is: owner >= admin >= member. An owner therefore passes
 * `hasRoleAtLeast(session, id, 'admin')` and `hasRoleAtLeast(session, id, 'member')`.
 *
 * Returns false for:
 *   - null / undefined session
 *   - missing rolesByTenant entry for the given tenantId
 *   - role strings not present in ROLE_RANK (treated as rank 0)
 *
 * @param session  - The GibsonSession (or null/undefined for unauthenticated callers).
 * @param tenantId - The tenant to check the role within.
 * @param required - The minimum role required (inclusive).
 */
export function hasRoleAtLeast(
  session: GibsonSession | null | undefined,
  tenantId: string,
  required: TenantRole,
): boolean {
  if (!session) return false;

  const roleString = session.user.rolesByTenant[tenantId];
  if (!roleString) return false;

  // Unknown role strings (not in ROLE_RANK) receive rank 0 — deny by default.
  const actualRank = (ROLE_RANK as Record<string, number>)[roleString] ?? 0;
  const requiredRank = ROLE_RANK[required];

  return actualRank >= requiredRank;
}
