/**
 * Test-only Auth.js session-cookie encoder.
 *
 * Issues a synthetic JWE that decrypts under the dashboard's own
 * AUTH_SECRET. Used by the visual-regression suite for authenticated
 * routes (e2e/visual/auth-routes.spec.ts) so Playwright can render
 * /dashboard, /missions, /findings, /settings without a live Zitadel
 * sign-in flow.
 *
 * SECURITY — this module effectively forges a session. Two independent
 * production guards, AND-ed:
 *
 *   1. NODE_ENV must NOT be "production".
 *   2. TEST_AUTH_BYPASS must equal "1".
 *
 * Both must be true; neither alone activates the encoder. The helm
 * chart never sets TEST_AUTH_BYPASS, so even if a misconfigured prod
 * deploy somehow ran with NODE_ENV=development, the second guard
 * blocks. Adding the env var to any production-bound config path
 * deserves a check-no-permissive-flags entry; see the dashboard
 * CLAUDE.md → "No hardcoded credentials" section.
 *
 * Salt matches Auth.js v5's default cookie naming:
 *   HTTPS production: `__Secure-authjs.session-token`
 *   HTTP dev:         `authjs.session-token`
 *
 * The visual-regression spec runs against http://localhost:3000 (the
 * Playwright webServer in playwright.config.ts) so it uses the insecure
 * cookie name. If you ever need to test against a real HTTPS deploy,
 * pass `secureCookie: true` to encodeTestSession().
 */

import { encode } from "@auth/core/jwt";

const INSECURE_COOKIE_NAME = "authjs.session-token";
const SECURE_COOKIE_NAME = "__Secure-authjs.session-token";

export interface TestSessionInput {
  sub: string;
  name?: string;
  email?: string;
  /** Whether to use the secure cookie name (default: false — dev/HTTP). */
  secureCookie?: boolean;
  /** Override the AUTH_SECRET. Falls back to env. */
  secret?: string;
}

export interface TestSessionResult {
  cookieName: string;
  cookieValue: string;
}

function assertGuards(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[encode-session] BLOCKED: NODE_ENV=production. This module forges " +
        "Auth.js sessions and MUST NOT run in production under any " +
        "circumstances.",
    );
  }
  if (process.env.TEST_AUTH_BYPASS !== "1") {
    throw new Error(
      "[encode-session] BLOCKED: TEST_AUTH_BYPASS is not set to '1'. The " +
        "session-encoder requires this opt-in env var as a second guard " +
        "in addition to NODE_ENV !== 'production'. Set TEST_AUTH_BYPASS=1 " +
        "in your test environment (visual-regression CI job, local dev).",
    );
  }
}

export async function encodeTestSession(
  input: TestSessionInput,
): Promise<TestSessionResult> {
  assertGuards();

  const secret = input.secret ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "[encode-session] AUTH_SECRET not set. The encoder needs the same " +
        "secret the dashboard uses to decode the cookie. Export AUTH_SECRET " +
        "from .env.local or pass `secret` explicitly.",
    );
  }

  const secureCookie = input.secureCookie ?? false;
  const cookieName = secureCookie ? SECURE_COOKIE_NAME : INSECURE_COOKIE_NAME;

  const cookieValue = await encode({
    salt: cookieName,
    secret,
    token: {
      sub: input.sub,
      name: input.name,
      email: input.email,
    },
    maxAge: 60 * 60,
  });

  return { cookieName, cookieValue };
}
