/**
 * GET /api/auth/my-memberships
 *
 * Thin server-side endpoint that returns the authenticated user's tenant
 * memberships and active tenant ID, formatted for consumption by the
 * `useAuthorize` React hook.
 *
 * Roles are returned as the proto-emitted FGA relation strings
 * (`admin`, `member`) so that callers can directly compare against
 * `AuthRegistry[method].relation` without any client-side translation.
 *
 * Spec: cross-repo-cohesion-fixes Requirement 3 (D1 end state b).
 *
 * @module api/auth/my-memberships
 */

import { NextResponse } from 'next/server';

import { getMyMemberships } from '@/src/lib/auth/membership';
import { readRawActiveTenant } from '@/src/lib/auth/active-tenant';

export async function GET(): Promise<NextResponse> {
  let memberships;
  try {
    memberships = await getMyMemberships();
  } catch {
    // Unauthenticated or daemon unavailable, return empty so the hook
    // treats every gated element as not-allowed.
    return NextResponse.json({ activeTenantId: null, byTenant: {} }, { status: 200 });
  }

  const byTenant: Record<string, { role: string }> = {};
  for (const m of memberships) {
    byTenant[m.tenantId] = { role: m.role };
  }

  // Read the active tenant cookie without throwing (no membership validation
  // needed here, the hook will simply find no matching role if the cookie is
  // stale and return allowed=false).
  const { tenantId: activeTenantId } = await readRawActiveTenant().then(
    (r) => (r.status === 'present' ? { tenantId: r.tenantId! } : { tenantId: null }),
  );

  return NextResponse.json({ activeTenantId, byTenant }, { status: 200 });
}
