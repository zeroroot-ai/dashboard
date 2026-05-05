/**
 * Unit tests for `auth.ts` cookie configuration.
 *
 * Spec security-hardening R18 — the dashboard session cookie MUST be
 * issued with `SameSite=Strict` so it is never carried on cross-origin
 * navigations. The OIDC state / PKCE / callback-URL / csrf cookies that
 * Auth.js sets during the sign-in round-trip MUST stay `SameSite=Lax`
 * (Auth.js v5 defaults), or the OIDC redirect from Zitadel back to the
 * dashboard will drop them and break sign-in.
 *
 * This test imports the auth.ts singleton's underlying NextAuthConfig
 * shape via a side-channel — re-exporting the config object directly
 * would introduce a circular module — and asserts the cookies.sessionToken
 * option matches the spec.
 *
 * Why a unit test (not just the Playwright e2e):
 *   - The e2e test in `e2e/auth/session-cookie-samesite.spec.ts` can
 *     verify behaviour against Auth.js endpoints, but the SESSION cookie
 *     itself is only minted after a real OIDC sign-in (requires a live
 *     Zitadel). This test pins the contract at the source of truth so a
 *     regression in auth.ts surfaces in CI without needing infra.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";

// AUTH_SECRET must be set before NextAuth() is invoked at import time.
process.env.AUTH_SECRET = "test-secret-32-chars-long-enough!!";
process.env.ZITADEL_CLIENT_ID = "dashboard-test-client";

// Stub next-auth to capture the config passed to NextAuth(). We don't
// actually want to boot Auth.js inside vitest — we just want to read the
// configuration we hand it. The real auth.ts calls
// `NextAuth(config)` once at module load, so capturing the argument
// gives us the full config tree to assert on.
const captured: { config?: import("next-auth").NextAuthConfig } = {};
vi.mock("next-auth", () => ({
  default: (config: import("next-auth").NextAuthConfig) => {
    captured.config = config;
    return {
      handlers: {},
      auth: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    };
  },
}));

// Test-fixture helper imported by auth.ts must be stubbed too — it reads
// process.env at call time but we don't exercise any fault paths here.
vi.mock("@/src/lib/test-fixtures/fault-injection", () => ({
  getFaultMode: () => undefined,
}));

beforeAll(async () => {
  // Importing auth.ts triggers NextAuth(config) which our mock captures.
  await import("@/auth");
});

describe("auth.ts cookie configuration (security-hardening R18)", () => {
  it("captured the NextAuthConfig from the auth.ts singleton", () => {
    expect(captured.config).toBeDefined();
    expect(captured.config?.cookies).toBeDefined();
  });

  it("session cookie is sameSite=strict", () => {
    const sessionTokenOpts = captured.config?.cookies?.sessionToken?.options;
    expect(sessionTokenOpts).toBeDefined();
    expect(sessionTokenOpts?.sameSite).toBe("strict");
  });

  it("session cookie is httpOnly", () => {
    // Defence-in-depth pairing — strict alone is meaningless if the
    // cookie is JS-readable.
    const sessionTokenOpts = captured.config?.cookies?.sessionToken?.options;
    expect(sessionTokenOpts?.httpOnly).toBe(true);
  });

  it("session cookie path is /", () => {
    const sessionTokenOpts = captured.config?.cookies?.sessionToken?.options;
    expect(sessionTokenOpts?.path).toBe("/");
  });

  it("does not override the OIDC state / pkce / callback-url cookies", () => {
    // The auth.ts config MUST NOT override Auth.js's defaults for the
    // OIDC dance cookies. Auth.js defaults them to sameSite=lax (see
    // node_modules/@auth/core/lib/utils/cookie.js); a strict override
    // would break sign-in because Zitadel's 302 back to
    // /api/auth/callback/zitadel would not carry the state cookie.
    const cookies = captured.config?.cookies ?? {};
    expect(cookies.state).toBeUndefined();
    expect(cookies.pkceCodeVerifier).toBeUndefined();
    expect(cookies.callbackUrl).toBeUndefined();
    expect(cookies.csrfToken).toBeUndefined();
    expect(cookies.nonce).toBeUndefined();
  });
});
