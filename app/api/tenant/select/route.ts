/**
 * POST /api/tenant/select
 *
 * Sets the active tenant for the current session.
 *
 * Validates that the requested tenant slug is in the caller's organization
 * list, then calls Better Auth's setActiveOrganization to persist the choice
 * in activeOrganizationId on the session row. Also writes the
 * gibson_current_tenant cookie so middleware can inject X-Gibson-Tenant
 * without a DB call on every request.
 *
 * Request body:
 * - tenant: string — the slug of the tenant to activate
 *
 * Responses:
 * - 200 { ok: true, currentTenant: slug }
 * - 400 { error: string }           — bad input
 * - 401 { error: 'Unauthorized' }   — no session
 * - 403 { error: 'TENANT_FORBIDDEN' } — user is not a member
 */
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/src/lib/auth-server';
import { getServerSession } from '@/src/lib/auth';

// Cookie name used across middleware.ts and this route.
export const CURRENT_TENANT_COOKIE = 'gibson_current_tenant';

// Max-age: 7 days.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export async function POST(request: NextRequest) {
  const session = await getServerSession();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { tenant } = (body ?? {}) as Record<string, unknown>;
  if (!tenant || typeof tenant !== 'string') {
    return NextResponse.json({ error: 'tenant field is required' }, { status: 400 });
  }

  const allowedTenants: string[] = session.user.tenants ?? [];
  const isCrossTenant = session.user.crossTenant === true;

  if (!isCrossTenant && !allowedTenants.includes(tenant)) {
    return NextResponse.json(
      { error: 'TENANT_FORBIDDEN' },
      { status: 403 },
    );
  }

  // Update Better Auth activeOrganizationId via the organization plugin's
  // setActiveOrganization endpoint. This writes to the session row so the
  // enriched session (used by server components) reflects the new active org.
  try {
    const reqHeaders = await headers();
    await auth.api.setActiveOrganization({
      body: { organizationSlug: tenant },
      headers: reqHeaders,
    });
  } catch (err) {
    // If the org slug is unknown to Better Auth (not yet provisioned) fall
    // back to cookie-only — the middleware header is still the runtime
    // enforcement path for the daemon.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[tenant/select] setActiveOrganization failed for slug=${tenant}: ${msg}`);
  }

  const response = NextResponse.json({ ok: true, currentTenant: tenant });
  response.cookies.set(CURRENT_TENANT_COOKIE, tenant, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });

  return response;
}
