/**
 * Unit tests for src/lib/zitadel/signup-handoff.ts.
 *
 * Issue: dashboard#41 — wire Zitadel V2 session+CreateCallback into the
 * signup flow so the user lands on /dashboard authenticated with no
 * intermediate hosted-login bounce.
 *
 * Scope of these tests:
 *   - state/PKCE cookies are set on the response (mocked via cookies()).
 *   - the OIDC /oauth/v2/authorize call carries the standard PKCE/state
 *     params.
 *   - the authRequestId is extracted from the redirect Location header,
 *     regardless of whether the param is named `authRequest` or
 *     `authRequestID`.
 *   - failures return null (caller falls back to /login).
 *
 * Not in scope:
 *   - End-to-end Auth.js callback handler decoding the cookies we set — that
 *     is covered by the live-cluster Playwright spec at
 *     e2e/auth/signup-autologin.spec.ts.
 *
 * Test environment override: the default vitest env is jsdom, but
 * @auth/core/jwt → jose 6.x performs an `instanceof Uint8Array` check that
 * fails under jsdom's polyfilled-Uint8Array. Switch to the `node` env
 * for this file so encryption succeeds.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// next/headers mock — captures cookie.set() calls so each test can assert
// on the cookies emitted by initiateOidcAuthRequest.
// ---------------------------------------------------------------------------

type SetCall = {
  name: string;
  value: string;
  options: { httpOnly?: boolean; sameSite?: string; secure?: boolean; path?: string; maxAge?: number };
};

const setCalls: SetCall[] = [];

vi.mock('next/headers', () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: SetCall['options']) => {
      setCalls.push({ name, value, options });
    },
    get: () => undefined,
  }),
}));

// Defer importing the module under test until AFTER the mock is registered.
async function importSut() {
  return await import('../signup-handoff');
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_CONFIG = {
  issuer: 'https://auth.test.local',
  internalIssuer: 'http://zitadel.test.svc:8080',
  clientId: 'dashboard-client-test',
  redirectUri: 'http://app.test.local/api/auth/callback/zitadel',
  authSecret: 'unit-test-secret-very-long-must-be-32-chars-or-more',
};

/** Build a fetch stub that returns a 302 with the given Location header. */
function stubFetchWith302(location: string) {
  return vi.fn(async () =>
    new Response(null, {
      status: 302,
      headers: { Location: location },
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('initiateOidcAuthRequest', () => {
  beforeEach(() => {
    setCalls.length = 0;
    // Force the non-secure cookie names (dev parity with NODE_ENV=test).
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('issues a /oauth/v2/authorize GET with the PKCE + state + standard OIDC params', async () => {
    let capturedUrl: string | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return new Response(null, {
          status: 302,
          headers: {
            Location:
              'https://auth.test.local/ui/v2/login/login?authRequest=AR_123abc',
          },
        });
      }),
    );

    const sut = await importSut();
    const result = await sut.initiateOidcAuthRequest(TEST_CONFIG);

    expect(result).not.toBeNull();
    expect(capturedUrl).not.toBeNull();

    const u = new URL(capturedUrl!);
    expect(u.origin + u.pathname).toBe(
      'http://zitadel.test.svc:8080/oauth/v2/authorize',
    );
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('dashboard-client-test');
    expect(u.searchParams.get('redirect_uri')).toBe(
      'http://app.test.local/api/auth/callback/zitadel',
    );
    expect(u.searchParams.get('scope')).toBe('openid profile email');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    // code_challenge is base64url of SHA-256(code_verifier) — 43 chars.
    const challenge = u.searchParams.get('code_challenge');
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // state is the JWE-encoded inner value — opaque but non-empty.
    expect(u.searchParams.get('state')?.length ?? 0).toBeGreaterThan(20);
  });

  it('returns the authRequestId parsed from the Location header (authRequest param)', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetchWith302(
        'https://auth.test.local/ui/v2/login/login?authRequest=AR_xyz_001',
      ),
    );
    const sut = await importSut();
    const result = await sut.initiateOidcAuthRequest(TEST_CONFIG);
    expect(result?.authRequestId).toBe('AR_xyz_001');
  });

  it('accepts the alternative authRequestID query-param spelling', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetchWith302(
        'https://auth.test.local/login?authRequestID=AR_legacy_999',
      ),
    );
    const sut = await importSut();
    const result = await sut.initiateOidcAuthRequest(TEST_CONFIG);
    expect(result?.authRequestId).toBe('AR_legacy_999');
  });

  it('sets the authjs.state and authjs.pkce.code_verifier cookies (dev / no __Secure- prefix)', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetchWith302('https://auth.test.local/ui/v2/login?authRequest=A1'),
    );

    const sut = await importSut();
    await sut.initiateOidcAuthRequest(TEST_CONFIG);

    const stateCookie = setCalls.find((c) => c.name === 'authjs.state');
    const pkceCookie = setCalls.find(
      (c) => c.name === 'authjs.pkce.code_verifier',
    );

    expect(stateCookie, 'state cookie must be set').toBeTruthy();
    expect(pkceCookie, 'pkceCodeVerifier cookie must be set').toBeTruthy();

    // Cookies must be httpOnly + lax (sameSite strict would break the OIDC
    // 302 round-trip — see auth.ts cookies block).
    for (const c of [stateCookie!, pkceCookie!]) {
      expect(c.options.httpOnly).toBe(true);
      expect(c.options.sameSite).toBe('lax');
      expect(c.options.path).toBe('/');
      expect(c.options.maxAge).toBeGreaterThan(0);
    }

    // Values are JWEs (4 dots → 5 segments).
    expect(stateCookie!.value.split('.').length).toBe(5);
    expect(pkceCookie!.value.split('.').length).toBe(5);
  });

  it('returns null when Location header is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302 })),
    );
    const sut = await importSut();
    const result = await sut.initiateOidcAuthRequest(TEST_CONFIG);
    expect(result).toBeNull();
  });

  it('returns null when Location contains no authRequest param', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetchWith302('https://auth.test.local/login'),
    );
    const sut = await importSut();
    const result = await sut.initiateOidcAuthRequest(TEST_CONFIG);
    expect(result).toBeNull();
  });

  it('returns null when fetch throws a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('connect ECONNREFUSED');
      }),
    );
    const sut = await importSut();
    const result = await sut.initiateOidcAuthRequest(TEST_CONFIG);
    expect(result).toBeNull();
  });

  it('returns null when response is not a 3xx redirect', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    const sut = await importSut();
    const result = await sut.initiateOidcAuthRequest(TEST_CONFIG);
    expect(result).toBeNull();
  });
});

describe('loadHandoffConfig', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_SECRET', '');
    vi.stubEnv('NEXTAUTH_SECRET', '');
    vi.stubEnv('AUTH_URL', '');
    vi.stubEnv('NEXTAUTH_URL', '');
    vi.stubEnv('ZITADEL_CLIENT_ID', '');
    vi.stubEnv('ZITADEL_ISSUER', '');
    vi.stubEnv('ZITADEL_INTERNAL_ISSUER', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns null when required env vars are missing', async () => {
    const sut = await importSut();
    expect(sut.loadHandoffConfig()).toBeNull();
  });

  it('builds a config when AUTH_SECRET + AUTH_URL + ZITADEL_CLIENT_ID are set', async () => {
    vi.stubEnv('AUTH_SECRET', 'secret-32-chars-or-more-aaaaaaaaaa');
    vi.stubEnv('AUTH_URL', 'http://app.test.local');
    vi.stubEnv('ZITADEL_CLIENT_ID', 'cid');
    vi.stubEnv('ZITADEL_ISSUER', 'https://auth.test.local');
    const sut = await importSut();
    const cfg = sut.loadHandoffConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.redirectUri).toBe(
      'http://app.test.local/api/auth/callback/zitadel',
    );
    expect(cfg!.clientId).toBe('cid');
    expect(cfg!.issuer).toBe('https://auth.test.local');
  });
});
