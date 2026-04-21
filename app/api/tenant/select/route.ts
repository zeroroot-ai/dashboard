/**
 * POST /api/tenant/select
 *
 * Sets the active tenant for the current session by writing the
 * gibson_current_tenant cookie. Validates that the requested tenant slug
 * is in the caller's session tenants list (or the user is cross-tenant).
 *
 * The Better Auth setActiveOrganization call is removed — Zitadel manages
 * the active org via claims in the OIDC token.
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
