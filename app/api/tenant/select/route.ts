/**
 * POST /api/tenant/select
 *
 * Sets the active tenant for the current session by writing a cookie.
 * Called by the tenant picker page and the tenant switcher dropdown.
 *
 * The middleware.ts reads this cookie on every request to the daemon and
 * injects the X-Gibson-Tenant header.
 *
 * Request body:
 * - tenant: string — the alias of the tenant to activate
 *
 * The route validates that the requested tenant is in session.user.tenants
 * to prevent a user from setting an arbitrary tenant they do not belong to.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';

// Cookie name used across middleware.ts and this route.
export const CURRENT_TENANT_COOKIE = 'gibson_current_tenant';

// Max-age: 7 days (same as Auth.js session duration).
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

  // Cross-tenant users (platform operators) may set any non-empty tenant.
  const isCrossTenant = session.user.crossTenant === true;

  if (!isCrossTenant && !allowedTenants.includes(tenant)) {
    return NextResponse.json(
      { error: `Tenant '${tenant}' is not in your organization list` },
      { status: 403 }
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
