/**
 * Unit tests for HttpZitadelAdminClient.
 *
 * Spec: signup-zitadel-permissions-fix
 * Bug: SIGNUP-B23 — password-policy-cache HTTP 403 on every signup.
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
    'uses the auth API endpoint, not the admin endpoint — spec:signup-zitadel-permissions-fix SIGNUP-B23',
    async () => {
      const client = makeClient();
      await client.getPasswordComplexityPolicy();

      expect(requestedPath).not.toBeNull();

      // This is the regression lock. If anyone reverts the URL back to the
      // admin endpoint or the management endpoint (both require IAM_OWNER or
      // higher — NOT covered by the signup-bot's IAM_USER_MANAGER role),
      // this test fails.
      //
      // Correct endpoint:  /auth/v1/policies/passwords/complexity
      // Broken endpoints:
      //   /admin/v1/policies/password/complexity   — requires IAM_OWNER
      //   /management/v1/policies/password/complexity — requires elevated role
      expect(requestedPath, [
        'spec:signup-zitadel-permissions-fix SIGNUP-B23 — ',
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
