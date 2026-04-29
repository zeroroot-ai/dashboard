/**
 * Unit tests for `getServiceToken` in src/lib/auth/service-token.ts.
 *
 * Uses `vi.stubGlobal('fetch', …)` to intercept outbound HTTP so the tests
 * are fully offline and deterministic. Covers the cache lifecycle (cold,
 * hot, expiry-driven refresh, 401-driven invalidation), concurrent-call
 * dedup, and the missing-env / Zitadel-error failure modes.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest';

import {
  getServiceToken,
  invalidateServiceToken,
  MissingServiceTokenConfigError,
  ServiceTokenFetchError,
  __resetForTests,
} from '../service-token';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function captureFetch(
  impl: (url: string, init: RequestInit) => Promise<Response>,
): { fetch: Mock; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const mock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return impl(url, init);
  });
  vi.stubGlobal('fetch', mock);
  return { fetch: mock, calls };
}

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Partial<Record<string, string | undefined>>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe('getServiceToken', () => {
  beforeEach(() => {
    __resetForTests();
    vi.useRealTimers();
    // Restore env, then set a known-good baseline. Individual tests may
    // override or unset specific vars.
    process.env = { ...ORIGINAL_ENV };
    setEnv({
      ZITADEL_DASHBOARD_CLIENT_ID: 'dashboard-sa',
      ZITADEL_DASHBOARD_CLIENT_SECRET: 'super-secret-value',
      ZITADEL_TOKEN_URL: 'https://zitadel.test/oauth/v2/token',
      ZITADEL_INTERNAL_ISSUER: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    process.env = { ...ORIGINAL_ENV };
  });

  // -------------------------------------------------------------------------
  // Cache lifecycle
  // -------------------------------------------------------------------------

  it('cold cache → blocks on Zitadel and returns the access token', async () => {
    const { fetch, calls } = captureFetch(async () =>
      jsonResponse({ access_token: 'tok-1', expires_in: 600 }),
    );

    const token = await getServiceToken();
    expect(token).toBe('tok-1');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(calls[0].url).toBe('https://zitadel.test/oauth/v2/token');
    // Basic auth — we never want client_secret in the request body.
    const auth = (calls[0].init.headers as Record<string, string>)[
      'Authorization'
    ];
    expect(auth).toMatch(/^Basic /);
    const decoded = Buffer.from(auth.slice('Basic '.length), 'base64').toString();
    expect(decoded).toBe('dashboard-sa:super-secret-value');
    // Body carries the grant + scope.
    const body = String(calls[0].init.body ?? '');
    expect(body).toContain('grant_type=client_credentials');
    expect(body).toContain(encodeURIComponent('urn:zitadel:iam:org:project:id:gibson-platform:aud'));
  });

  it('hot cache → second call within TTL does NOT refetch', async () => {
    const { fetch } = captureFetch(async () =>
      jsonResponse({ access_token: 'tok-hot', expires_in: 600 }),
    );

    const a = await getServiceToken();
    const b = await getServiceToken();
    expect(a).toBe('tok-hot');
    expect(b).toBe('tok-hot');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('near-expiry → next call refetches', async () => {
    let n = 0;
    const { fetch } = captureFetch(async () => {
      n += 1;
      return jsonResponse({ access_token: `tok-${n}`, expires_in: 120 });
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const first = await getServiceToken();
    expect(first).toBe('tok-1');

    // Token has expires_in=120s and the resolver refreshes 60s early →
    // refresh should fire at +60s. Advance to +90s to be safely past it.
    vi.setSystemTime(new Date('2026-01-01T00:01:30Z'));

    const second = await getServiceToken();
    expect(second).toBe('tok-2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('concurrent callers during refresh share a single in-flight Promise', async () => {
    let resolveFetch!: (r: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const { fetch } = captureFetch(async () => pendingResponse);

    // Fire three callers before the fetch resolves.
    const p1 = getServiceToken();
    const p2 = getServiceToken();
    const p3 = getServiceToken();

    // Only one outbound HTTP call should be in flight.
    expect(fetch).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse({ access_token: 'tok-shared', expires_in: 600 }));

    const [a, b, c] = await Promise.all([p1, p2, p3]);
    expect(a).toBe('tok-shared');
    expect(b).toBe('tok-shared');
    expect(c).toBe('tok-shared');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('invalidateServiceToken() forces the next call to refetch (401 path)', async () => {
    let n = 0;
    const { fetch } = captureFetch(async () => {
      n += 1;
      return jsonResponse({ access_token: `tok-${n}`, expires_in: 600 });
    });

    const first = await getServiceToken();
    expect(first).toBe('tok-1');
    expect(fetch).toHaveBeenCalledTimes(1);

    invalidateServiceToken();

    const second = await getServiceToken();
    expect(second).toBe('tok-2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Failure modes
  // -------------------------------------------------------------------------

  it('missing client_id → MissingServiceTokenConfigError', async () => {
    setEnv({ ZITADEL_DASHBOARD_CLIENT_ID: undefined });
    captureFetch(async () => {
      throw new Error('fetch should not be called');
    });
    await expect(getServiceToken()).rejects.toBeInstanceOf(
      MissingServiceTokenConfigError,
    );
  });

  it('missing client_secret → MissingServiceTokenConfigError', async () => {
    setEnv({ ZITADEL_DASHBOARD_CLIENT_SECRET: undefined });
    captureFetch(async () => {
      throw new Error('fetch should not be called');
    });
    await expect(getServiceToken()).rejects.toBeInstanceOf(
      MissingServiceTokenConfigError,
    );
  });

  it('falls back to ZITADEL_INTERNAL_ISSUER when ZITADEL_TOKEN_URL is unset', async () => {
    setEnv({
      ZITADEL_TOKEN_URL: undefined,
      ZITADEL_INTERNAL_ISSUER: 'https://zitadel.gibson.svc:8080',
    });
    const { calls } = captureFetch(async () =>
      jsonResponse({ access_token: 'tok-derived', expires_in: 600 }),
    );

    await getServiceToken();
    expect(calls[0].url).toBe(
      'https://zitadel.gibson.svc:8080/oauth/v2/token',
    );
  });

  it('Zitadel returns 401 → ServiceTokenFetchError surfaces status', async () => {
    captureFetch(async () =>
      new Response('{"error":"invalid_client"}', {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const err = await getServiceToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceTokenFetchError);
    expect((err as ServiceTokenFetchError).status).toBe(401);
    // Secret must NOT appear in the message.
    expect((err as Error).message).not.toContain('super-secret-value');
  });

  it('failed mint clears in-flight slot so subsequent calls retry', async () => {
    let n = 0;
    const { fetch } = captureFetch(async () => {
      n += 1;
      if (n === 1) {
        return new Response('boom', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
      return jsonResponse({ access_token: 'tok-recovered', expires_in: 600 });
    });

    await expect(getServiceToken()).rejects.toBeInstanceOf(
      ServiceTokenFetchError,
    );
    // Second call should NOT see the stale rejected Promise — it must
    // re-enter the fetch path.
    const recovered = await getServiceToken();
    expect(recovered).toBe('tok-recovered');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('response missing access_token → ServiceTokenFetchError', async () => {
    captureFetch(async () => jsonResponse({ expires_in: 600 }));
    await expect(getServiceToken()).rejects.toBeInstanceOf(
      ServiceTokenFetchError,
    );
  });

  it('response missing expires_in → ServiceTokenFetchError', async () => {
    captureFetch(async () => jsonResponse({ access_token: 'x' }));
    await expect(getServiceToken()).rejects.toBeInstanceOf(
      ServiceTokenFetchError,
    );
  });

  // -------------------------------------------------------------------------
  // Scope sanity (R4.2: service-acting-auth)
  //
  // The token-fetch request body MUST include BOTH `openid` (required for
  // Zitadel to issue a JWT rather than an opaque bearer) AND the project
  // audience URN (so the issued JWT carries aud: ["gibson-platform"] and
  // passes Envoy jwt_authn). This test pins the exact scope strings so a
  // future refactor that silently drops either fails loudly.
  // -------------------------------------------------------------------------

  it('scope includes openid AND the gibson-platform audience URN (R4.2)', async () => {
    const { calls } = captureFetch(async () =>
      jsonResponse({ access_token: 'tok-scope-check', expires_in: 600 }),
    );

    await getServiceToken();

    const body = String(calls[0].init.body ?? '');
    // `scope` is URL-encoded in the form body — spaces become '+' or '%20,
    // URN colons become %3A, etc. Check both the param name and the two
    // mandatory scope values.
    expect(body).toContain('scope=');
    // `openid` is a plain ASCII word — must appear verbatim in the encoded body.
    expect(body).toContain('openid');
    // The project-audience URN — space-separated within the scope value,
    // so it appears URL-encoded. Verify the full URN is present.
    const AUD_URN = 'urn:zitadel:iam:org:project:id:gibson-platform:aud';
    expect(body).toContain(encodeURIComponent(AUD_URN));
  });
});
