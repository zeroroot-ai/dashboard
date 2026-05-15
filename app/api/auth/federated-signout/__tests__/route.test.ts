/**
 * @vitest-environment node
 *
 * Unit tests for the federated-signout route handler at
 * app/api/auth/federated-signout/route.ts.
 *
 * Covers two paired behaviors (epic logout-post-uri-fix):
 *
 *  1. The route reads `process.env.POST_LOGOUT_REDIRECT_URI` verbatim and
 *     sends it to Zitadel's `/oidc/v1/end_session` as `post_logout_redirect_uri`.
 *     It does NOT synthesize the URI from request origin (that path appended
 *     a trailing slash and silently drifted from the Zitadel registration,
 *     causing every logout to be rejected with `invalid_request`).
 *
 *  2. On every successful logout the response clears both the Auth.js
 *     session cookie set (defensive, matches `clearAuthCookies`) AND the
 *     `gibson_active_tenant` cookie, so the next sign-in re-runs default-
 *     tenant resolution / picker logic instead of auto-routing the user
 *     back to the tenant they were viewing at logout time.
 *
 * Missing env: the route must fail loud (500 + structured log line) rather
 * than fall back to anything dynamic; the chart owns the URI and an unset
 * env is a deployment misconfiguration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockSignOut = vi.fn();
const mockAuth = vi.fn();

vi.mock('@/auth', () => ({
  auth: () => mockAuth(),
  signOut: (opts: unknown) => mockSignOut(opts),
}));

const mockLoggerError = vi.fn();
vi.mock('@/src/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// Import handler under test AFTER mocks are registered.
import { GET, POST } from '../route';
import { ACTIVE_TENANT_COOKIE_NAME } from '@/src/lib/auth/active-tenant';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(): NextRequest {
  // Request origin intentionally differs from POST_LOGOUT_REDIRECT_URI so we
  // can prove the route does NOT synthesize the URI from origin.
  return new NextRequest('http://localhost:9999/api/auth/federated-signout', {
    method: 'GET',
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/auth/federated-signout', () => {
  const ORIG_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue(undefined);
    mockAuth.mockResolvedValue({ idToken: 'test-id-token' });
    process.env.POST_LOGOUT_REDIRECT_URI = 'https://app.zero-day.local:30443';
    process.env.ZITADEL_ISSUER = 'https://auth.zero-day.local:30443';
    process.env.ZITADEL_DASHBOARD_CLIENT_ID = 'test-client-id';
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('sends POST_LOGOUT_REDIRECT_URI verbatim — no path append, no trailing slash from origin', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toBeTruthy();
    const url = new URL(location!);
    // Zitadel end_session
    expect(url.origin + url.pathname).toBe('https://auth.zero-day.local:30443/oidc/v1/end_session');
    // The post_logout_redirect_uri is the env value exactly.
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://app.zero-day.local:30443',
    );
    // Regression guard: the trailing-slash form that origin-synthesis used to
    // produce must never reach the wire.
    expect(url.searchParams.get('post_logout_redirect_uri')).not.toMatch(/\/$/);
    // Regression guard: the request origin (localhost:9999 from makeRequest)
    // must NEVER end up as the post_logout_redirect_uri.
    expect(url.searchParams.get('post_logout_redirect_uri')).not.toContain('localhost:9999');
    expect(url.searchParams.get('id_token_hint')).toBe('test-id-token');
  });

  it('falls back to client_id when id_token_hint is unavailable', async () => {
    mockAuth.mockResolvedValue({ idToken: undefined });
    const res = await GET(makeRequest());
    const url = new URL(res.headers.get('location')!);
    expect(url.searchParams.get('id_token_hint')).toBeNull();
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://app.zero-day.local:30443',
    );
  });

  it('clears the gibson_active_tenant cookie on the redirect response', async () => {
    const res = await GET(makeRequest());
    // res.cookies is a ResponseCookies; getAll returns every Set-Cookie entry.
    const cleared = res.cookies.getAll().find(
      (c) => c.name === ACTIVE_TENANT_COOKIE_NAME,
    );
    expect(cleared).toBeDefined();
    expect(cleared!.value).toBe('');
    expect(cleared!.maxAge).toBe(0);
    expect(cleared!.path).toBe('/');
  });

  it('clears all Auth.js session cookie shapes on the redirect response', async () => {
    const res = await GET(makeRequest());
    const all = res.cookies.getAll();
    // Sanity: both the prefixed and unprefixed forms of the session token
    // must be expired so neither survives on the next request.
    const sessionCookieNames = all
      .filter((c) => c.value === '' && c.maxAge === 0)
      .map((c) => c.name);
    expect(sessionCookieNames).toContain('__Secure-authjs.session-token');
    expect(sessionCookieNames).toContain('authjs.session-token');
    // And the active-tenant cookie is among the cleared set.
    expect(sessionCookieNames).toContain(ACTIVE_TENANT_COOKIE_NAME);
  });

  it('always invokes Auth.js signOut() with redirect:false so the route owns the final redirect', async () => {
    await GET(makeRequest());
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith({ redirect: false });
  });

  it('fails loud (500) when POST_LOGOUT_REDIRECT_URI is unset — no silent fallback', async () => {
    delete process.env.POST_LOGOUT_REDIRECT_URI;
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'logout_misconfigured' });
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    // signOut MUST NOT be called when configuration is broken — leaving the
    // session intact is preferable to a partial logout that leaves the user
    // stuck without the Zitadel SSO termination half of the flow.
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('POST is wired to the same handler so the no-workspace signout form works', () => {
    expect(POST).toBe(GET);
  });
});
