/**
 * Access-control contract for middleware.ts (GHSA-826q).
 *
 * The defect: an unauthenticated request returned `NextResponse.next()`, i.e.
 * the middleware FORWARDED anonymous traffic to protected route handlers on the
 * belief that "Auth.js redirects to /login via its default behavior". That
 * default only applies when middleware exports the bare `auth` handler; this
 * app uses the `auth(handler)` wrapper form, which takes the decision over
 * entirely. Nothing denied the request.
 *
 * These tests drive the real middleware function with the Auth.js wrapper
 * stubbed out, so what is under test is this repo's decision logic rather than
 * Auth.js's.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// The `auth()` wrapper is replaced by an identity function so the handler runs
// directly and `req.auth` is whatever each test sets. This mirrors what Auth.js
// does at runtime minus the session decoding.
vi.mock('@/auth', () => ({
  auth: (handler: (req: NextRequest) => Promise<NextResponse>) => handler,
}));

const getMyMemberships = vi.fn();
vi.mock('@/src/lib/auth/membership', () => ({
  getMyMemberships: () => getMyMemberships(),
  MembershipResolutionError: class MembershipResolutionError extends Error {
    reason = 'daemon_unavailable';
    connectCode = 14;
  },
}));

const readRawActiveTenant = vi.fn();
vi.mock('@/src/lib/auth/active-tenant', () => ({
  ACTIVE_TENANT_COOKIE_NAME: 'gibson_active_tenant',
  readRawActiveTenant: () => readRawActiveTenant(),
}));

// Single-origin: no host split, so every test exercises the auth path directly.
vi.mock('@/src/lib/host-routing', () => ({
  loadHostSplitConfig: () => null,
  decideHostSplit: () => ({ kind: 'continue' }),
}));

vi.mock('@/src/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthedRequest = NextRequest & { auth: any };

async function run(
  path: string,
  session: unknown,
): Promise<NextResponse> {
  const middleware = (await import('../../../middleware')).default;
  const req = new NextRequest(`https://app.example.com${path}`) as AuthedRequest;
  req.auth = session;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (middleware as any)(req);
}

const SIGNED_IN = { user: { id: 'user-1' } };

beforeEach(() => {
  vi.clearAllMocks();
  getMyMemberships.mockResolvedValue([{ tenantId: 'tenant-1' }]);
  readRawActiveTenant.mockResolvedValue({ status: 'ok', tenantId: 'tenant-1' });
});

describe('unauthenticated requests', () => {
  it.each([
    '/dashboard',
    '/dashboard/pages/findings',
    '/dashboard/organization/users',
    '/device',
    '/api/missions',
    '/api/admin/billing/trial-extension',
    '/api/debug/recent-errors',
    '/api/test/inject-fault',
  ])('denies %s', async (path) => {
    const res = await run(path, null);
    // The regression: this used to be 200 with `NextResponse.next()`.
    expect(res.status, `${path} was forwarded, not denied`).not.toBe(200);
  });

  it('redirects a page navigation to /login carrying the callbackUrl', async () => {
    const res = await run('/dashboard/pages/findings', null);

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('callbackUrl')).toBe(
      '/dashboard/pages/findings',
    );
  });

  it('answers an API request with 401 JSON rather than an HTML redirect', async () => {
    const res = await run('/api/missions', null);

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toMatchObject({ error: 'unauthenticated' });
  });

  it.each([
    '/',
    '/login',
    '/signin',
    '/signup',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/robots.txt',
    '/sitemap.xml',
    '/invite/some-opaque-token',
    '/api/health',
    '/api/metrics',
    '/api/config/public',
  ])('still serves the public path %s', async (path) => {
    const res = await run(path, null);
    expect(res.status, `${path} should be public`).toBe(200);
  });

  it('seeds the CSRF cookie on a public pass-through', async () => {
    const res = await run('/login', null);
    // Named for a TLS origin; see src/lib/csrf.ts.
    expect(res.cookies.get('__Host-csrf-token')).toBeDefined();
  });
});

describe('authenticated requests without a usable tenant', () => {
  it('denies an API request when the user has no membership', async () => {
    getMyMemberships.mockResolvedValue([]);
    const res = await run('/api/missions', SIGNED_IN);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ reason: 'no_membership' });
  });

  it('denies an API request when the active-tenant cookie is absent', async () => {
    readRawActiveTenant.mockResolvedValue({ status: 'absent' });
    const res = await run('/api/missions', SIGNED_IN);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ reason: 'no_active_tenant' });
  });

  it('denies an API request when the tenant cookie fails its signature check', async () => {
    readRawActiveTenant.mockResolvedValue({ status: 'invalid' });
    const res = await run('/api/missions', SIGNED_IN);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      reason: 'tenant_cookie_invalid',
    });
  });

  it('denies an API request when membership no longer includes the active tenant', async () => {
    getMyMemberships.mockResolvedValue([{ tenantId: 'some-other-tenant' }]);
    const res = await run('/api/missions', SIGNED_IN);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      reason: 'membership_revoked',
    });
  });

  it('exempts the onboarding endpoints, which the zero-membership state needs', async () => {
    getMyMemberships.mockResolvedValue([]);
    const res = await run('/api/onboarding/status', SIGNED_IN);
    expect(res.status).toBe(200);
  });

  it('still redirects page navigations rather than returning JSON', async () => {
    readRawActiveTenant.mockResolvedValue({ status: 'absent' });
    const res = await run('/dashboard', SIGNED_IN);

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/select-tenant');
  });
});

describe('authenticated requests with a valid tenant', () => {
  it('lets a dashboard request through', async () => {
    const res = await run('/dashboard', SIGNED_IN);
    expect(res.status).toBe(200);
  });

  it('lets an API request through', async () => {
    const res = await run('/api/missions', SIGNED_IN);
    expect(res.status).toBe(200);
  });
});
