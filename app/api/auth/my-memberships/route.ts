/**
 * GET /api/auth/my-memberships
 *
 * Thin server-side endpoint that returns the authenticated user's tenant
 * memberships and active tenant ID, formatted for consumption by the
 * `useAuthorize` React hook.
 *
 * Roles are returned as FGA relation strings (`tenant_admin`, `tenant_member`)
 * so that callers can directly compare against `AuthRegistry[method].relation`
 * without any client-side translation.
 *
 * Spec: dashboard-authz-ui-gating Requirement 2.3.
 *
 * @module api/auth/my-memberships
 */

import { NextResponse } from 'next/server';

import { getMyMemberships } from '@/src/lib/auth/membership';
import { readRawActiveTenant } from '@/src/lib/auth/active-tenant';

/**
 * Map the dashboard's internal role strings to FGA relation strings used
 * by the authz registry.
 *
 * The daemon normalizes all roles to 'admin' | 'member'. Anything else
 * falls back to 'tenant_member' (deny is handled downstream via the
 * hierarchy; unknown roles get tier 0).
 */
function toRelation(role: 'admin' | 'member'): string {
  return role === 'admin' ? 'tenant_admin' : 'tenant_member';
}

export async function GET(): Promise<NextResponse> {
  let memberships;
  try {
    memberships = await getMyMemberships();
  } catch {
    // Unauthenticated or daemon unavailable — return empty so the hook
    // treats every gated element as not-allowed.
    return NextResponse.json({ activeTenantId: null, byTenant: {} }, { status: 200 });
  }

  const byTenant: Record<string, { role: string }> = {};
  for (const m of memberships) {
    byTenant[m.tenantId] = { role: toRelation(m.role) };
  }

  // Read the active tenant cookie without throwing (no membership validation
  // needed here — the hook will simply find no matching role if the cookie is
  // stale and return allowed=false).
  const { tenantId: activeTenantId } = await readRawActiveTenant().then(
    (r) => (r.status === 'present' ? { tenantId: r.tenantId! } : { tenantId: null }),
  );

  return NextResponse.json({ activeTenantId, byTenant }, { status: 200 });
}
