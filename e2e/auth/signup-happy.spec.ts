/**
 * signup-happy.spec.ts
 *
 * Happy-path signup: fresh unique slug + email → provisioning completes →
 * the new credentials can sign in and land on the dashboard.
 *
 * Flow (shared shape-aware helpers, dashboard#961):
 *   1. signUpViaForm drives /signup?plan=… — it handles every front-door
 *      shape (kind card-free form, SaaS card-first form with the inline
 *      Stripe Payment Element, login-only redirect, pricing bounce) and
 *      waits for the ProvisioningPanel to finish and route through /login
 *      (auto-login retired in E9, dashboard#812).
 *   2. loginViaZitadelV2 signs in with the fresh credentials — the Zitadel
 *      user is created with a verified-at-create email, so no email-token
 *      scrape is required.
 *   3. Assert we land on /dashboard with a session cookie.
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, generateUserCredentials } from "./helpers/fixtures";
import { loginViaZitadelV2 } from "./helpers/login-via-zitadel-v2";
import { signUpViaForm } from "./helpers/signup-via-form";

test.describe("Signup, happy path", () => {
  test("fresh slug + email completes signup and can sign in", async ({
    page,
    context,
  }) => {
    // Provisioning (up to 120s) + Zitadel OIDC login (up to 60s) + slack.
    test.setTimeout(300_000);

    const creds = generateUserCredentials();

    // -------------------------------------------------------------------------
    // Step 1: Drive the signup form (shape-aware shared helper).
    // -------------------------------------------------------------------------
    const { finalUrl, tenantSlug } = await signUpViaForm(page, {
      slug: creds.slug,
      email: creds.email,
      password: creds.password,
      baseURL: BASE_URL,
    });

    expect(tenantSlug).toBe(creds.slug);
    // Post-signup the dashboard routes through /login; /dashboard is also
    // accepted for deployments where an auto-login path is active.
    expect(finalUrl).toMatch(/\/login|\/dashboard/);

    // Already authenticated (auto-login profile): signup is proven usable.
    if (finalUrl.includes("/dashboard")) {
      await expect(page.locator("body")).not.toHaveText(/error/i, {
        timeout: 10_000,
      });
      return;
    }

    // -------------------------------------------------------------------------
    // Step 2: Sign in with the fresh credentials to prove the account works.
    // -------------------------------------------------------------------------
    const result = await loginViaZitadelV2(page, context, {
      email: creds.email,
      password: creds.password,
      baseURL: BASE_URL,
    });

    // -------------------------------------------------------------------------
    // Step 3: Assert we landed on the dashboard.
    // -------------------------------------------------------------------------
    await page.waitForURL((url) => url.pathname.startsWith("/dashboard"), {
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    expect(result.sessionCookieSet).toBe(true);
  });
});
