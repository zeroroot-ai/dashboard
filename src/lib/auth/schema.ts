/**
 * Cross-tenant session read helper.
 *
 * Historically this module cached a declarative authorization schema fetched
 * from the daemon's GetAuthSchema RPC and exposed a static permission closure
 * (hasPermission / canCallRpc / resolveEffectivePermissions / loadSchema).
 * That whole layer was a SECOND authorization source of truth that drifted
 * from the daemon once GetAuthSchema was removed, every lookup default-denied.
 *
 * It has been deleted. Authorization is now sourced entirely from the
 * generated AuthRegistry relation model:
 *   - client gates  → useAuthorize(rpcMethod)         (src/lib/auth/use-authorize.ts)
 *   - server gates  → assertAuthorized(rpcMethod)     (src/lib/auth/assert-authorized.ts)
 *                     / requireCrdSession(action)      (app/actions/crd/_authz.ts)
 *   - relation tiers → satisfiesRelation / rolesAreCrossTenant
 *                     (src/lib/auth/relation-hierarchy.ts)
 *
 * Only the cross-tenant read helper remains here; `crossTenant` is derived
 * from the caller's role (see rolesAreCrossTenant) and stored on the session.
 */

interface SessionWithCrossTenant {
  user?: {
    crossTenant?: boolean;
  } | null;
}

/**
 * True when the session holds a cross-tenant role (e.g. platform_operator).
 * Reads the `crossTenant` flag the auth callback derived via rolesAreCrossTenant.
 */
export function isCrossTenant(session: SessionWithCrossTenant | null): boolean {
  return session?.user?.crossTenant ?? false;
}
