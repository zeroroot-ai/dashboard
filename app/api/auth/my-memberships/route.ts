// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

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

import { auth } from '@/auth';
import { getMyMemberships } from '@/src/lib/auth/membership';

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

  // The person's tenant, resolved server-side at sign-in (ADR-0093
  // decision 4). No membership validation needed here, the hook will
  // simply find no matching role if the session's tenant is stale and
  // return allowed=false.
  const session = await auth();
  const activeTenantId = session?.tenantId ?? null;

  return NextResponse.json({ activeTenantId, byTenant }, { status: 200 });
}
