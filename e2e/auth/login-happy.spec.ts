/**
 * login-happy.spec.ts
 *
 * Happy-path login: known email + correct password → dashboard.
 *
 * Front-door shapes are handled by the shared loginViaZitadelV2 helper
 * (dashboard#961): kind inline form, SaaS gate page (deploy#1060), and the
 * legacy auto-handoff all funnel through the same call.
 *
 * Because we need a pre-existing user we either:
 *   (a) Read credentials from E2E_SEED_EMAIL / E2E_SEED_PASSWORD env vars
 *       (for running against a cluster with a pre-seeded user), or
 *   (b) Create a fresh user via the shared signup helper (signUpViaForm),
 *       then sign in. Signup creates the Zitadel user with a
 *       verified-at-create email (E9, dashboard#812), so no email-token
 *       scrape is needed before login.
 *
 * Strategy (b) is the self-contained default so no external seed is required.
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, generateUserCredentials } from "./helpers/fixtures";
import { loginViaZitadelV2 } from "./helpers/login-via-zitadel-v2";
import { signUpViaForm } from "./helpers/signup-via-form";

// ---------------------------------------------------------------------------
// Seed: allow overriding credentials via env for cluster-seeded runs.
// ---------------------------------------------------------------------------

const SEED_EMAIL = process.env.E2E_SEED_EMAIL;
const SEED_PASSWORD = process.env.E2E_SEED_PASSWORD;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Login, happy path", () => {
  test("correct credentials → redirect to dashboard", async ({ browser }) => {
    // Self-contained path budget: signup provisioning (up to 120s) + Zitadel
    // OIDC login (up to 60s) + navigation slack.
    test.setTimeout(300_000);

    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();

    try {
      let email: string;
      let password: string;

      if (SEED_EMAIL && SEED_PASSWORD) {
        // Pre-seeded user: log straight in.
        email = SEED_EMAIL;
        password = SEED_PASSWORD;
      } else {
        // Self-contained: create a fresh tenant + user via the real signup
        // flow, then log in with those credentials.
        const creds = generateUserCredentials();
        await signUpViaForm(page, {
          slug: creds.slug,
          email: creds.email,
          password: creds.password,
          baseURL: BASE_URL,
        });
        // Post-signup lands on /login (auto-login retired in E9). Clear any
        // half-established browser state so the login below is a clean flow.
        await ctx.clearCookies();
        email = creds.email;
        password = creds.password;
      }

      // Drive the shape-aware login flow (gate page / inline form / V2 pages).
      const result = await loginViaZitadelV2(page, ctx, {
        email,
        password,
        baseURL: BASE_URL,
      });

      // Assert we landed on the dashboard with a session cookie.
      await page.waitForURL((url) => url.pathname.startsWith("/dashboard"), {
        timeout: 30_000,
      });
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
      expect(result.sessionCookieSet).toBe(true);
      await expect(
        page.getByText(/invalid email or password|error|failed/i),
      ).not.toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
