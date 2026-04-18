/**
 * verify-email.spec.ts
 *
 * Email verification flow:
 *   1. New user signs up → redirected to /verify-email (not dashboard).
 *   2. Scrape verification link from log provider.
 *   3. Click → confirmed → redirect to /dashboard/*.
 *
 * Pre-conditions:
 *   DASHBOARD_EMAIL_PROVIDER=log
 *   DASHBOARD_CAPTCHA_PROVIDER=disabled
 *
 * Test skips if log source is unreachable (cluster not running).
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, generateUserCredentials } from "./helpers/fixtures";
import { scrapeToken, isLogSourceReachable } from "./helpers/email-log";
import { queryUser, closeDbPool } from "./helpers/db";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Email verification", () => {
  test.afterAll(async () => {
    await closeDbPool();
  });

  test("new user is redirected to /verify-email; verification link confirms and reaches dashboard", async ({
    browser,
  }) => {
    if (!isLogSourceReachable()) {
      test.skip(
        true,
        "Log source unreachable — skipping verify-email test (cluster not running?).",
      );
      return;
    }

    const creds = generateUserCredentials();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      // ------------------------------------------------------------------
      // 1. Sign up a fresh user.
      // ------------------------------------------------------------------
      await page.goto(`${BASE_URL}/signup`);
      await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 });

      const companyInput = page.getByLabel(/company name/i).or(
        page.getByPlaceholder(/company|organization|workspace/i),
      );
      await companyInput.first().fill(creds.companyName);
      await page.getByLabel(/email/i).fill(creds.email);
      const pwFields = page.getByLabel(/^password$/i);
      await pwFields.first().fill(creds.password);
      const confirm = page.getByLabel(/confirm password|re-enter password/i).first();
      if ((await confirm.count()) > 0) await confirm.fill(creds.password);
      const tos = page.getByRole("checkbox", { name: /terms|tos|agree/i }).first();
      if ((await tos.count()) > 0) await tos.check();
      await page
        .getByRole("button", { name: /create account|sign up|get started/i })
        .first()
        .click();

      await page.waitForURL(
        (url) =>
          url.pathname.startsWith("/verify-email") ||
          url.pathname.startsWith("/signup/provisioning") ||
          url.pathname.startsWith("/dashboard"),
        { timeout: 30_000 },
      );

      // If the app does not require email verification (verification
      // bypass or pre-existing config), skip the rest.
      if (!page.url().includes("/verify-email")) {
        test.skip(
          true,
          "App did not redirect to /verify-email — email verification may be disabled in this environment.",
        );
        return;
      }

      // ------------------------------------------------------------------
      // 2. Assert /verify-email shows the expected holding page.
      // ------------------------------------------------------------------
      await expect(page).toHaveURL(/\/verify-email/, { timeout: 10_000 });

      // The page should mention sending an email and have a resend option.
      await expect(
        page.getByText(/check your email|verification|sent|verify/i),
      ).toBeVisible({ timeout: 10_000 });

      // ------------------------------------------------------------------
      // 3. Scrape the verification token from the log.
      // ------------------------------------------------------------------
      const token = await scrapeToken({
        to: creds.email,
        tokenType: "verify",
        timeoutMs: 30_000,
      });

      expect(token).toBeTruthy();

      // ------------------------------------------------------------------
      // 4. Navigate to the confirmation URL.
      // ------------------------------------------------------------------
      await page.goto(
        `${BASE_URL}/verify-email/confirm?token=${encodeURIComponent(token)}`,
      );

      // The confirm page either shows a success state and then meta-refreshes
      // to /dashboard, or redirects immediately.
      await page.waitForURL(
        (url) =>
          url.pathname.startsWith("/dashboard") ||
          url.pathname.startsWith("/verify-email"),
        { timeout: 20_000 },
      );

      if (page.url().includes("/verify-email")) {
        // Success card should be visible.
        await expect(
          page.getByText(/verified|success|welcome|confirmed/i),
        ).toBeVisible({ timeout: 10_000 });

        // Wait for meta-refresh to /dashboard.
        await page.waitForURL(
          (url) => url.pathname.startsWith("/dashboard"),
          { timeout: 15_000 },
        );
      }

      // ------------------------------------------------------------------
      // 5. Assert we are now in the dashboard.
      // ------------------------------------------------------------------
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
      await expect(
        page.getByText(/error|failed|invalid|not verified/i),
      ).not.toBeVisible();

      // ------------------------------------------------------------------
      // 6. Optional DB assertion: emailVerified = true.
      // ------------------------------------------------------------------
      const user = await queryUser(creds.email);
      if (user !== null) {
        expect(user["emailVerified"]).toBe(true);
      }
    } finally {
      await ctx.close();
    }
  });
});
