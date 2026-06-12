/**
 * Unit tests for HttpZitadelAdminClient.
 *
 * Spec: signup-zitadel-permissions-fix
 * Bug: SIGNUP-B23, password-policy-cache HTTP 403 on every signup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpZitadelAdminClient } from '../admin-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal client instance with dummy credentials. */
function makeClient() {
  return new HttpZitadelAdminClient({
    apiUrl: 'http://zitadel.test:8080',
    pat: 'test-pat',
    externalDomain: 'auth.test.local',
  });
}

// ---------------------------------------------------------------------------
// URL value-lock: getPasswordComplexityPolicy
// ---------------------------------------------------------------------------

describe('HttpZitadelAdminClient.getPasswordComplexityPolicy', () => {
  let requestedPath: string | null;

  beforeEach(() => {
    requestedPath = null;

    // Stub global fetch to intercept the URL and return a minimal policy.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      // Extract the path from the full URL.
      const u = new URL(url);
      requestedPath = u.pathname;

      return new Response(
        JSON.stringify({
          policy: {
            minLength: '8',
            hasUppercase: true,
            hasLowercase: true,
            hasNumber: true,
            hasSymbol: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }));
  });

  it(
    'uses the auth API endpoint, not the admin endpoint, spec:signup-zitadel-permissions-fix SIGNUP-B23',
    async () => {
      const client = makeClient();
      await client.getPasswordComplexityPolicy();

      expect(requestedPath).not.toBeNull();

      // This is the regression lock. If anyone reverts the URL back to the
      // admin endpoint or the management endpoint (both require IAM_OWNER or
      // higher, NOT covered by the signup-bot's IAM_USER_MANAGER role),
      // this test fails.
      //
      // Correct endpoint:  /auth/v1/policies/passwords/complexity
      // Broken endpoints:
      //   /admin/v1/policies/password/complexity  , requires IAM_OWNER
      //   /management/v1/policies/password/complexity, requires elevated role
      expect(requestedPath, [
        'spec:signup-zitadel-permissions-fix SIGNUP-B23, ',
        'getPasswordComplexityPolicy must use /auth/v1/policies/passwords/complexity. ',
        `Actual path was: ${requestedPath}. `,
        'Reverting to /admin/v1/... or /management/v1/... causes HTTP 403 for the signup-bot.',
      ].join('')).toBe('/auth/v1/policies/passwords/complexity');
    },
  );

  it('parses the policy response shape correctly', async () => {
    const client = makeClient();
    const policy = await client.getPasswordComplexityPolicy();

    expect(policy.minLength).toBe(8);
    expect(policy.hasUppercase).toBe(true);
    expect(policy.hasLowercase).toBe(true);
    expect(policy.hasNumber).toBe(true);
    expect(policy.hasSymbol).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// V2 Session API, signup auto-login (issue dashboard#41)
// ---------------------------------------------------------------------------

describe('HttpZitadelAdminClient.createSession', () => {
  let lastRequest:
    | { url: string; method: string; body: unknown; headers: Record<string, string> }
    | null;

  beforeEach(() => {
    lastRequest = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        lastRequest = {
          url,
          method: init.method ?? 'GET',
          body: init.body ? JSON.parse(init.body as string) : null,
          headers: init.headers as Record<string, string>,
        };
        return new Response(
          JSON.stringify({
            sessionId: 'sess-123',
            sessionToken: 'tok-secret-xyz',
            details: { changeDate: '2026-05-14T00:00:00Z' },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );
  });

  it(
    'POSTs to /v2/sessions with combined user.loginName + password.password checks, issue dashboard#41',
    async () => {
      const client = makeClient();
      await client.createSession({
        loginName: 'ada@example.com',
        password: 'P@ssw0rd-very-long-enough-12345',
      });

      expect(lastRequest).not.toBeNull();
      const u = new URL(lastRequest!.url);
      // Value-lock: any drift away from /v2/sessions breaks the V2 flow.
      expect(
        u.pathname,
        'createSession must POST /v2/sessions exactly, Zitadel V2 spec',
      ).toBe('/v2/sessions');
      expect(lastRequest!.method).toBe('POST');

      // Body shape: both checks bundled in one request.
      const body = lastRequest!.body as {
        checks: {
          user: { loginName: string };
          password: { password: string };
        };
      };
      expect(body.checks.user.loginName).toBe('ada@example.com');
      expect(body.checks.password.password).toBe(
        'P@ssw0rd-very-long-enough-12345',
      );
    },
  );

  it('returns sessionId + sessionToken from the response', async () => {
    const client = makeClient();
    const session = await client.createSession({
      loginName: 'ada@example.com',
      password: 'P@ssw0rd-very-long-enough-12345',
    });
    expect(session.sessionId).toBe('sess-123');
    expect(session.sessionToken).toBe('tok-secret-xyz');
  });

  it('throws ZitadelApiError with NO_SESSION when response is missing sessionId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
          new Response(JSON.stringify({ sessionToken: 'tok-only' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    const client = makeClient();
    await expect(
      client.createSession({ loginName: 'a@b.c', password: 'x'.repeat(12) }),
    ).rejects.toMatchObject({
      name: 'ZitadelApiError',
      zitadelErrorId: 'NO_SESSION',
    });
  });
});

describe('HttpZitadelAdminClient.finalizeAuthRequest', () => {
  let lastRequest:
    | { url: string; method: string; body: unknown }
    | null;

  beforeEach(() => {
    lastRequest = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        lastRequest = {
          url,
          method: init.method ?? 'GET',
          body: init.body ? JSON.parse(init.body as string) : null,
        };
        return new Response(
          JSON.stringify({
            callbackUrl:
              'https://app.zeroroot.local/api/auth/callback/zitadel?code=AUTH_CODE&state=STATE_VAL',
            details: { sequence: '42' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );
  });

  it(
    'POSTs to /v2/oidc/auth_requests/:id with the session in the body, issue dashboard#41',
    async () => {
      const client = makeClient();
      const result = await client.finalizeAuthRequest({
        authRequestId: 'V2_AUTH_REQ_abc',
        session: { sessionId: 'sess-123', sessionToken: 'tok-xyz' },
      });

      expect(lastRequest).not.toBeNull();
      const u = new URL(lastRequest!.url);
      expect(
        u.pathname,
        'finalizeAuthRequest path must be /v2/oidc/auth_requests/{id} with no /CreateCallback suffix (gRPC method name is not part of the HTTP path)',
      ).toBe('/v2/oidc/auth_requests/V2_AUTH_REQ_abc');
      expect(lastRequest!.method).toBe('POST');

      const body = lastRequest!.body as {
        session: { sessionId: string; sessionToken: string };
      };
      expect(body.session.sessionId).toBe('sess-123');
      expect(body.session.sessionToken).toBe('tok-xyz');

      expect(result.callbackUrl).toMatch(/\/api\/auth\/callback\/zitadel\?code=/);
    },
  );

  it('URL-encodes the authRequestId path parameter', async () => {
    const client = makeClient();
    await client.finalizeAuthRequest({
      authRequestId: 'with spaces/and+plus',
      session: { sessionId: 's', sessionToken: 't' },
    });
    const u = new URL(lastRequest!.url);
    expect(u.pathname).toBe(
      '/v2/oidc/auth_requests/with%20spaces%2Fand%2Bplus',
    );
  });

  // Regression lock: dashboard#<filed below>, Zitadel v4 emits standard-base64
  // auth codes (which contain '+') in callbackUrl without percent-encoding them.
  // URLSearchParams.get('code') decodes '+' as space, causing Zitadel's token
  // endpoint to return "illegal base64 data at input byte N" (~40% of logins).
  it(
    'sanitises + in callbackUrl code/state params to %2B, dashboard base64-code-corruption fix',
    async () => {
      // Simulate a Zitadel callbackUrl with a standard-base64 auth code containing '+'.
      // Position 16 is where the real failure was observed (OIDC-ahLi2).
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              callbackUrl:
                'https://app.zeroroot.local/api/auth/callback/zitadel?code=ABCDEFGHIJKLMNOPabc+def&state=state+val',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
      );
      const client = makeClient();
      const result = await client.finalizeAuthRequest({
        authRequestId: 'ar1',
        session: { sessionId: 's', sessionToken: 't' },
      });
      // '+' must be '%2B' so URLSearchParams.get() returns the correct char.
      expect(result.callbackUrl).toContain('code=ABCDEFGHIJKLMNOPabc%2Bdef');
      expect(result.callbackUrl).toContain('state=state%2Bval');
      // No bare '+' must remain in the query string.
      expect(result.callbackUrl.slice(result.callbackUrl.indexOf('?'))).not.toContain('+');
    },
  );

  it('does not double-encode %2B already in callbackUrl', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            callbackUrl:
              'https://app.zeroroot.local/api/auth/callback/zitadel?code=abc%2Bdef&state=xyz',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const client = makeClient();
    const result = await client.finalizeAuthRequest({
      authRequestId: 'ar1',
      session: { sessionId: 's', sessionToken: 't' },
    });
    // %2B stays %2B (no %252B).
    expect(result.callbackUrl).toContain('code=abc%2Bdef');
    expect(result.callbackUrl).not.toContain('%252B');
  });

  it('throws ZitadelApiError with NO_CALLBACK_URL when response is malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
          new Response(JSON.stringify({ details: {} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    const client = makeClient();
    await expect(
      client.finalizeAuthRequest({
        authRequestId: 'x',
        session: { sessionId: 's', sessionToken: 't' },
      }),
    ).rejects.toMatchObject({
      name: 'ZitadelApiError',
      zitadelErrorId: 'NO_CALLBACK_URL',
    });
  });
});
