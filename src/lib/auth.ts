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
 * Shape is intentionally preserved from the former Better Auth session so
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

  // Derive tenant from the gibson:tenant Zitadel claim forwarded in the JWT
  // callback (auth.ts jwt callback copies it onto token.tenant, and the
  // session callback copies it onto session.user.tenant).
  const tenantId = (user as unknown as { tenant?: string }).tenant ?? null;
  const tenants = tenantId ? [tenantId] : [];
  const rolesByTenant: Record<string, string> = {};

  // Resolve roles from K8s TenantMember CRs. The dashboard's signup flow
  // creates a TenantMember with role=admin for the founding owner; that
  // record is the source of truth for what role this user holds in this
  // tenant. Zitadel project roles aren't wired yet (no Actions v2 mapper),
  // so without this lookup `roles` stays [] forever and every
  // hasPermission(session, …) check returns false → 403 on every protected
  // API route the moment the user reaches the dashboard.
  let roles: string[] = [];
  let permissions: string[] = [];
  let crossTenant = false;

  if (tenantId && user.email) {
    try {
      const { listTenantMembers } = await import('@/src/lib/k8s/tenants');
      const ns = `tenant-${tenantId}`;
      const members = await listTenantMembers(ns);
      const me = members.find(
        (m) => m.spec?.email?.toLowerCase() === user.email!.toLowerCase(),
      );
      if (me?.spec?.role) {
        roles = [me.spec.role];
        rolesByTenant[tenantId] = me.spec.role;
      }
    } catch (err) {
      console.error('[auth] TenantMember role lookup failed:', err);
    }
  }

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
