/**
 * Gibson auth helpers — server side.
 *
 * Provides getServerSession() for Server Components, Route Handlers, and
 * Server Actions. Uses Better Auth as the identity backend.
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
import { headers } from 'next/headers';
import { auth } from '@/src/lib/auth-server';

// ============================================================================
// Types
// ============================================================================

/**
 * Extended session type with Gibson-specific properties.
 *
 * Shape is intentionally preserved from the former Auth.js v5 session so
 * that all existing callers can use this type without changes.
 */
export interface GibsonSession {
  user: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    groups: string[];
    roles: string[];
    tenantId: string | null | undefined;
    tenants: string[];
    rolesByTenant: Record<string, string>;
    permissions: string[];
    crossTenant: boolean;
  };
  /** @deprecated No longer used — dashboard authenticates via SPIFFE mTLS. */
  accessToken?: string;
  error?: string;
  expires: string;
}

// ============================================================================
// Session enrichment (per-request cache via React cache())
// ============================================================================

/**
 * Internal: fetch and enrich the Better Auth session with Gibson tenant/role
 * data from the daemon. Wrapped with React cache() so it runs at most once
 * per server request even if multiple Server Components call getServerSession().
 */
const _getEnrichedSession = cache(async (): Promise<GibsonSession | null> => {
  let rawSession: { session: { token: string; expiresAt: Date; activeOrganizationId?: string | null }; user: { id: string; name: string; email: string; image?: string | null } } | null;

  try {
    const requestHeaders = await headers();
    rawSession = await auth.api.getSession({ headers: requestHeaders });
  } catch (err) {
    // Better Auth may throw during initialization (e.g., DB unavailable).
    console.error('[auth] Failed to get Better Auth session:', err);
    return null;
  }

  if (!rawSession) {
    return null;
  }

  const { session: baSession, user: baUser } = rawSession;
  const sessionToken = baSession.token;

  // Derive tenant data from the daemon via SPIFFE mTLS transport.
  // The dashboard's SPIFFE identity is used for authentication; no Bearer token
  // is forwarded. The user's ID is passed as x-gibson-user-id metadata.
  let tenants: string[] = [];
  let rolesByTenant: Record<string, string> = {};
  let roles: string[] = [];
  let permissions: string[] = [];
  let crossTenant = false;

  try {
    // Better Auth's `organization` + `member` tables are the source of
    // truth for tenant membership — signUpAction and the tenant-operator
    // both write there. Read them directly via Better Auth's organization
    // adapter; no daemon round-trip, no mTLS requirement.
    const { getOrgAdapter } = await import('better-auth/plugins/organization');
    type AnyCtx = Parameters<typeof getOrgAdapter>[0];
    const ctx = (await auth.$context) as unknown as AnyCtx;
    const orgAdapter = getOrgAdapter(ctx);
    const orgs = await orgAdapter.listOrganizations(baUser.id);
    for (const o of orgs) {
      const orgId = (o as unknown as { id?: string }).id;
      const slug = (o as unknown as { slug?: string }).slug;
      const tenantId = slug ?? orgId;
      if (!tenantId) continue;
      tenants.push(tenantId);
      // We own the creation path — the signup flow grants the creator
      // "owner" via the org plugin's creatorRole. Treat that as admin
      // for the downstream permission resolver.
      rolesByTenant[tenantId] = 'admin';
    }

    // Use activeOrganizationId as the active tenant, falling back to first.
    const activeTenantId = baSession.activeOrganizationId ?? tenants[0] ?? null;
    const membershipRole = activeTenantId ? rolesByTenant[activeTenantId] : undefined;
    roles = membershipRole ? [membershipRole] : [];

    const { resolveEffectivePermissions, resolveCrossTenant } = await import('@/src/lib/auth/schema');
    permissions = await resolveEffectivePermissions(roles);
    crossTenant = await resolveCrossTenant(roles);
  } catch (err) {
    console.error('[auth] Failed to read tenant memberships for user=' + baUser.id + ':', err);
    // Do not return null here — return a partial session so the user can still
    // see the UI. Permission checks will fail cleanly (default-deny).
  }

  const activeTenantId = baSession.activeOrganizationId ?? tenants[0] ?? null;

  return {
    user: {
      id: baUser.id,
      name: baUser.name,
      email: baUser.email,
      image: baUser.image ?? null,
      groups: [],
      roles,
      tenantId: activeTenantId,
      tenants,
      rolesByTenant,
      permissions,
      crossTenant,
    },
    // accessToken is kept for backward compatibility but is no longer used for
    // daemon calls (SPIFFE mTLS replaced token-based transport).
    accessToken: sessionToken,
    expires: baSession.expiresAt.toISOString(),
  };
});

// ============================================================================
// Public API
// ============================================================================

/**
 * Get the server-side session enriched with Gibson tenant/role/permission data.
 *
 * Uses React cache() internally so the underlying Better Auth + daemon calls
 * happen at most once per server request, even if multiple Server Components
 * call this function.
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
 *   if (!session) redirect('/dashboard/login/v2');
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
