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

function makeRequest(
  init: { method?: string; headers?: Record<string, string>; url?: string } = {},
): NextRequest {
  // Request origin intentionally differs from POST_LOGOUT_REDIRECT_URI so we
  // can prove the route does NOT synthesize the URI from origin.
  return new NextRequest(init.url ?? 'http://localhost:9999/api/auth/federated-signout', {
    method: init.method ?? 'GET',
    headers: init.headers,
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
    process.env.POST_LOGOUT_REDIRECT_URI = 'https://app.zeroroot.local:30443';
    process.env.ZITADEL_ISSUER = 'https://auth.zeroroot.local:30443';
    // dashboard#76: the route reads ZITADEL_CLIENT_ID (the user-flow OIDC App)
    // for the client_id fallback, NOT ZITADEL_DASHBOARD_CLIENT_ID (a MACHINE_USER
    // for s2s client_credentials, which has no postLogoutRedirectURIs).
    process.env.ZITADEL_CLIENT_ID = 'test-user-flow-client-id';
    // Set the wrong env too so we'd catch a future regression that reaches
    // for the machine-user client by mistake.
    process.env.ZITADEL_DASHBOARD_CLIENT_ID = 'wrong-machine-user-client-id';
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('sends POST_LOGOUT_REDIRECT_URI verbatim, no path append, no trailing slash from origin', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toBeTruthy();
    const url = new URL(location!);
    // Zitadel end_session
    expect(url.origin + url.pathname).toBe('https://auth.zeroroot.local:30443/oidc/v1/end_session');
    // The post_logout_redirect_uri is the env value exactly.
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://app.zeroroot.local:30443',
    );
    // Regression guard: the trailing-slash form that origin-synthesis used to
    // produce must never reach the wire.
    expect(url.searchParams.get('post_logout_redirect_uri')).not.toMatch(/\/$/);
    // Regression guard: the request origin (localhost:9999 from makeRequest)
    // must NEVER end up as the post_logout_redirect_uri.
    expect(url.searchParams.get('post_logout_redirect_uri')).not.toContain('localhost:9999');
  });

  it('NEVER puts the raw id_token in the navigable redirect URL', async () => {
    // The ID token is a signed bearer credential carrying the user's identity
    // claims. A URL the browser navigates to is not a safe place for one: it
    // lands in browser history, in the Referer sent onward from the
    // post-logout landing page, and in every intermediary access log.
    // client_id drives the same RP-initiated logout and carries no secret.
    mockAuth.mockResolvedValue({ idToken: 'test-id-token' });
    const res = await GET(makeRequest());
    const location = res.headers.get('location')!;
    expect(location).not.toContain('test-id-token');
    expect(location).not.toContain('id_token_hint');
    expect(new URL(location).searchParams.get('client_id')).toBe('test-user-flow-client-id');
  });

  it('always identifies the RP by the user-flow client_id (ZITADEL_CLIENT_ID)', async () => {
    mockAuth.mockResolvedValue({ idToken: undefined });
    const res = await GET(makeRequest());
    const url = new URL(res.headers.get('location')!);
    expect(url.searchParams.get('id_token_hint')).toBeNull();
    // dashboard#76 regression guard, must NOT use the machine-user client
    // (ZITADEL_DASHBOARD_CLIENT_ID), which has no postLogoutRedirectURIs and
    // would make Zitadel reject every logout with
    // {"error":"invalid_request","error_description":"post_logout_redirect_uri invalid"}.
    expect(url.searchParams.get('client_id')).toBe('test-user-flow-client-id');
    expect(url.searchParams.get('client_id')).not.toBe('wrong-machine-user-client-id');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://app.zeroroot.local:30443',
    );
  });

  it('fails loud (500) when ZITADEL_CLIENT_ID is unset, no silent unauthenticated end_session', async () => {
    // Both end_session client-resolution inputs are missing: an
    // unauthenticated end_session call would be rejected by Zitadel anyway
    // and would partially trash the user's local session in the process
    // (Auth.js cookie cleared but Zitadel session intact). Better to refuse
    // and surface the misconfiguration. See dashboard#76.
    mockAuth.mockResolvedValue({ idToken: undefined });
    delete process.env.ZITADEL_CLIENT_ID;
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'logout_misconfigured' });
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    // signOut MUST NOT have been called, same invariant as the
    // POST_LOGOUT_REDIRECT_URI-missing branch.
    expect(mockSignOut).not.toHaveBeenCalled();
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

  it('fails loud (500) when POST_LOGOUT_REDIRECT_URI is unset, no silent fallback', async () => {
    delete process.env.POST_LOGOUT_REDIRECT_URI;
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'logout_misconfigured' });
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    // signOut MUST NOT be called when configuration is broken, leaving the
    // session intact is preferable to a partial logout that leaves the user
    // stuck without the Zitadel SSO termination half of the flow.
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('POST drives the same logout so the no-workspace signout form works', async () => {
    const res = await POST(makeRequest({ method: 'POST' }));
    expect(res.status).toBe(307);
    expect(mockSignOut).toHaveBeenCalledWith({ redirect: false });
  });
});

// ---------------------------------------------------------------------------
// Cross-site request forgery (GHSA-wqh8)
// ---------------------------------------------------------------------------

describe('federated-signout CSRF protection', () => {
  const ORIG_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue(undefined);
    mockAuth.mockResolvedValue({ idToken: 'test-id-token' });
    process.env.POST_LOGOUT_REDIRECT_URI = 'https://app.zeroroot.local:30443';
    process.env.ZITADEL_ISSUER = 'https://auth.zeroroot.local:30443';
    process.env.ZITADEL_CLIENT_ID = 'test-user-flow-client-id';
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('rejects a cross-site navigation and does NOT sign the user out', async () => {
    const res = await GET(
      makeRequest({ headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document' } }),
    );
    expect(res.status).toBe(403);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('rejects a cross-site form POST', async () => {
    const res = await POST(
      makeRequest({
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'document' },
      }),
    );
    expect(res.status).toBe(403);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('rejects the zero-click subresource vector (<img src=...>)', async () => {
    // Same-origin but loaded as an image: this is how a forged logout is
    // normally triggered, and it is never a real sign-out.
    const res = await GET(
      makeRequest({ headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'image' } }),
    );
    expect(res.status).toBe(403);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('rejects a fetch()-initiated sign-out', async () => {
    const res = await GET(
      makeRequest({ headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'empty' } }),
    );
    expect(res.status).toBe(403);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('allows a same-origin navigation (the sidebar/header menu path)', async () => {
    const res = await GET(
      makeRequest({ headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'document' } }),
    );
    expect(res.status).toBe(307);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('allows a user-typed navigation (Sec-Fetch-Site: none)', async () => {
    const res = await GET(
      makeRequest({ headers: { 'sec-fetch-site': 'none', 'sec-fetch-dest': 'document' } }),
    );
    expect(res.status).toBe(307);
  });

  it('falls back to Origin when fetch metadata is absent', async () => {
    const res = await GET(makeRequest({ headers: { origin: 'https://evil.example' } }));
    expect(res.status).toBe(403);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('keys the active-tenant cookie Secure flag to the request scheme, not NODE_ENV', async () => {
    const secure = await GET(
      makeRequest({
        url: 'https://app.zeroroot.local/api/auth/federated-signout',
        headers: { 'x-forwarded-proto': 'https' },
      }),
    );
    const secureCookie = secure.cookies
      .getAll()
      .find((c) => c.name === ACTIVE_TENANT_COOKIE_NAME);
    expect(secureCookie!.secure).toBe(true);

    const plain = await GET(makeRequest({ headers: { 'x-forwarded-proto': 'http' } }));
    const plainCookie = plain.cookies
      .getAll()
      .find((c) => c.name === ACTIVE_TENANT_COOKIE_NAME);
    expect(plainCookie!.secure).toBe(false);
  });
});
