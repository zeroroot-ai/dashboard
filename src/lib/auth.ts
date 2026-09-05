/**
 * Gibson auth helpers, server side.
 *
 * Provides getServerSession() for Server Components, Route Handlers, and
 * Server Actions. Uses Auth.js v5 (next-auth) with Zitadel OIDC as the
 * identity backend.
 *
 * Authorization is sourced from the generated AuthRegistry relation model, not
 * from a static permission closure on the session:
 *   - client gates → useAuthorize(rpcMethod)
 *   - server gates → assertAuthorized(rpcMethod) / requireCrdSession(action)
 *   - cross-tenant  → isCrossTenant(session) (src/lib/auth/schema), with the
 *     crossTenant flag derived from the role via rolesAreCrossTenant.
 */

import { cache } from 'react';
import { auth } from '@/auth';

// ============================================================================
// Types
// ============================================================================

/**
 * Extended session type with Gibson-specific properties.
 *
 * Shape is intentionally preserved from the pre-Auth.js session so
 * that all existing callers can use this type without changes.
 *
 * NOTE (dashboard#583 lock-in): `tenantId` has been removed as an authority
 * field. The active tenant is now only resolvable via `requireActiveTenant()`
 * from `src/lib/auth/active-tenant`. Session no longer carries a tenant
 * identity, it carries the membership list (`tenants`) for role lookup and
 * the tenant-switcher UI.
 */
export interface GibsonSession {
  user: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    /**
     * Whether the user has verified their email address.
     * Always true for Zitadel OIDC users, email_verified is asserted by
     * Zitadel before issuing the ID token. The dashboard layout gate continues
     * to check this field for forward compatibility.
     */
    emailVerified: boolean;
    groups: string[];
    roles: string[];
    tenants: string[];
    rolesByTenant: Record<string, string>;
    crossTenant: boolean;
  };
  error?: string;
  expires: string;
}

// ============================================================================
// Session enrichment (per-request cache via React cache())
// ============================================================================

/**
 * Internal: fetch and enrich the Auth.js session with Gibson tenant/role
 * data from the Zitadel claims. Wrapped with React cache() so it runs at
 * most once per server request even if multiple Server Components call
 * getServerSession().
 */
const _getEnrichedSession = cache(async (): Promise<GibsonSession | null> => {
  const session = await auth();

  if (!session || !session.user) {
    return null;
  }

  const { user } = session;

  // Tenant + memberships now come from FGA (via the daemon) plus the
  // gibson_active_tenant cookie, see spec `tenant-membership-not-in-jwt`.
  // The active tenant is NOT resolved here; every endpoint calls
  // requireActiveTenant() directly (dashboard#583 lock-in). The session only
  // carries the membership list (for role lookup and switcher UI).
  // Lazily import to avoid a hard dep cycle through the membership module.
  const tenants: string[] = [];
  const rolesByTenant: Record<string, string> = {};
  let activeTenantId: string | null = null;
  try {
    const [{ getMyMemberships }, { readRawActiveTenant }] = await Promise.all([
      import('@/src/lib/auth/membership'),
      import('@/src/lib/auth/active-tenant'),
    ]);
    const memberships = await getMyMemberships();
    for (const m of memberships) {
      tenants.push(m.tenantId);
      rolesByTenant[m.tenantId] = m.role;
    }
    // Read the active-tenant cookie to populate roles for this render.
    // This is read-only; no auto-pick fallback, a missing cookie means
    // no active tenant and the endpoint will throw via requireActiveTenant().
    const raw = await readRawActiveTenant();
    if (raw.status === 'present' && tenants.includes(raw.tenantId!)) {
      activeTenantId = raw.tenantId!;
    }
  } catch (err) {
    // Transient FGA/daemon errors degrade to "no tenant", middleware will
    // route the next request to /login/error if the failure persists.
    console.error('[auth] membership resolution failed:', err);
  }

  // Derive roles from the cookie-confirmed active tenant only (no auto-pick).
  const roles: string[] = activeTenantId && rolesByTenant[activeTenantId] ? [rolesByTenant[activeTenantId]!] : [];

  // crossTenant is derived DIRECTLY from the active-tenant role, not from the
  // (deleted) daemon auth schema, which always returned false and silently
  // broke platform-operator provisioning. Authorization itself is sourced from
  // the AuthRegistry relation model (useAuthorize / assertAuthorized /
  // requireCrdSession), not a static permission closure.
  const { rolesAreCrossTenant } = await import('@/src/lib/auth/relation-hierarchy');
  const crossTenant = rolesAreCrossTenant(roles);

  return {
    user: {
      id: user.id,
      name: user.name ?? null,
      email: user.email ?? null,
      image: user.image ?? null,
      // Zitadel asserts email_verified before issuing tokens.
      emailVerified: true,
      groups: [],
      roles,
      tenants,
      rolesByTenant,
      crossTenant,
    },
    expires: session.expires,
  };
});

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the server-side session enriched with Gibson tenant/role/permission data.
 *
 * Uses React cache() internally so the underlying Auth.js call happens at most
 * once per server request, even if multiple Server Components call this.
 *
 * Use this in Server Components, Route Handlers, and Server Actions.
 *
 * @example
 * ```tsx
 * import { getServerSession } from '@/src/lib/auth';
 * import { hasPermission } from '@/src/lib/auth/schema';
 *
 * export default async function Page() {
 *   const session = await getServerSession();
 *   if (!session) redirect('/login');
 *   await assertAuthorized('/gibson.tenant.v1.SecretsService/GetMissionAudit');
 *   return <div>Hello, {session.user.name}</div>;
 * }
 * ```
 */
export async function getServerSession(): Promise<GibsonSession | null> {
  return _getEnrichedSession();
}

/**
 * Check if authentication is enabled.
 */
function isAuthEnabled(): boolean {
  return true;
}
