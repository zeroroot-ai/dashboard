/**
 * Gibson auth helpers — server side.
 *
 * Provides getServerSession() for Server Components, Route Handlers, and
 * Server Actions. Uses Auth.js v5 (next-auth) with Zitadel OIDC as the
 * identity backend.
 *
 * The GibsonSession interface shape is preserved so all downstream callers
 * (hasPermission, canCallRpc, isCrossTenant, resolveTenant) continue to work
 * without change.
 *
 * Permission checks live in '@/src/lib/auth/schema' (hasPermission,
 * isCrossTenant, canCallRpc). The daemon's permissions.yaml is the only
 * source of truth for authorization.
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
 */
export interface GibsonSession {
  user: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    /**
     * Whether the user has verified their email address.
     * Always true for Zitadel OIDC users — email_verified is asserted by
     * Zitadel before issuing the ID token. The dashboard layout gate continues
     * to check this field for forward compatibility.
     */
    emailVerified: boolean;
    groups: string[];
    roles: string[];
    tenantId: string | null | undefined;
    tenants: string[];
    rolesByTenant: Record<string, string>;
    permissions: string[];
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
  // gibson_active_tenant cookie — see spec `tenant-membership-not-in-jwt`.
  // Lazily import to avoid a hard dep cycle through the membership module.
  let tenantId: string | null = null;
  const tenants: string[] = [];
  const rolesByTenant: Record<string, string> = {};
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
    const raw = await readRawActiveTenant();
    if (raw.status === 'present' && tenants.includes(raw.tenantId!)) {
      tenantId = raw.tenantId!;
    } else if (memberships.length === 1) {
      tenantId = memberships[0]!.tenantId;
    }
  } catch (err) {
    // Transient FGA/daemon errors degrade to "no tenant" — middleware will
    // route the next request to /login/error if the failure persists.
    console.error('[auth] membership resolution failed:', err);
  }

  const roles: string[] = tenantId && rolesByTenant[tenantId] ? [rolesByTenant[tenantId]!] : [];
  let permissions: string[] = [];
  let crossTenant = false;

  try {
    const { resolveEffectivePermissions, resolveCrossTenant } = await import('@/src/lib/auth/schema');
    permissions = await resolveEffectivePermissions(roles);
    crossTenant = await resolveCrossTenant(roles);
  } catch (err) {
    console.error('[auth] Failed to resolve permissions:', err);
  }

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
      tenantId,
      tenants,
      rolesByTenant,
      permissions,
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
 *   if (!hasPermission(session, 'missions:read')) redirect('/forbidden');
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
export function isAuthEnabled(): boolean {
  return true;
}
