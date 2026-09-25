// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

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
 * NOTE (ADR-0093 decision 4): the person's one tenant is now resolved
 * server-side at sign-in (`auth.ts`'s `jwt` callback) and carried on the
 * underlying Auth.js session as `tenantId`. This module's `tenantId` field
 * mirrors that value; `tenants` / `rolesByTenant` are derived from the SAME
 * membership read, so they can hold at most one entry. Use
 * `requireActiveTenant()` (`src/lib/auth/active-tenant`) as the fail-closed
 * resolver — it re-validates against current FGA membership on every call.
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
  /** The person's one tenant (ADR-0093 decision 4), or null when they have none. */
  tenantId?: string | null;
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

  // The person's tenant is resolved server-side at sign-in and carried on
  // the session (ADR-0093 decision 4) — never read from a cookie. Memberships
  // still come from FGA (via the daemon) for role lookup; there is at most
  // one now, matching the session's one tenant.
  // Lazily import to avoid a hard dep cycle through the membership module.
  const tenants: string[] = [];
  const rolesByTenant: Record<string, string> = {};
  let activeTenantId: string | null = null;
  try {
    const { getMyMemberships } = await import('@/src/lib/auth/membership');
    const memberships = await getMyMemberships();
    for (const m of memberships) {
      tenants.push(m.tenantId);
      rolesByTenant[m.tenantId] = m.role;
    }
    // The session's server-resolved tenant, confirmed against the fresh
    // membership read above. No auto-pick: a session with no tenant, or one
    // whose membership no longer confirms, means no active tenant and the
    // endpoint will throw via requireActiveTenant().
    if (session.tenantId && tenants.includes(session.tenantId)) {
      activeTenantId = session.tenantId;
    }
  } catch (err) {
    // Transient FGA/daemon errors degrade to "no tenant", middleware will
    // route the next request to /login/error if the failure persists.
    console.error('[auth] membership resolution failed:', err);
  }

  // Derive roles from the session-confirmed active tenant only (no auto-pick).
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
    tenantId: activeTenantId,
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
