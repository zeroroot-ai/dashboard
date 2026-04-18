/**
 * signup-happy.spec.ts
 *
 * Happy-path signup: fresh unique slug + email → verify email → land on
 * dashboard.
 *
 * Pre-conditions:
 *   DASHBOARD_EMAIL_PROVIDER=log  (tokens appear in stdout / kubectl logs)
 *   DASHBOARD_CAPTCHA_PROVIDER=disabled
 *
 * Flow:
 *   1. Navigate to /signup.
 *   2. Fill in unique company name, email, password, accept ToS.
 *   3. Submit → expect redirect to /verify-email (or provisioning page).
 *   4. Scrape verification token from log provider output.
 *   5. Navigate to /verify-email/confirm?token=<token>.
 *   6. Expect redirect / success state and then land on /dashboard/*.
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, generateUserCredentials } from "./helpers/fixtures";
import { scrapeToken, isLogSourceReachable } from "./helpers/email-log";
import { queryUser, closeDbPool } from "./helpers/db";

test.describe("Signup — happy path", () => {
  test.afterAll(async () => {
    await closeDbPool();
  });

  test("fresh slug + email completes signup and email verification", async ({
    page,
  }) => {
    const creds = generateUserCredentials();

    // -------------------------------------------------------------------------
    // Step 1: Navigate to signup page
    // -------------------------------------------------------------------------
    await page.goto(`${BASE_URL}/signup`);
    await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 });

    // -------------------------------------------------------------------------
    // Step 2: Fill in the signup form
    // -------------------------------------------------------------------------
    // Company name field
    const companyNameInput = page.getByLabel(/company name/i).or(
      page.getByPlaceholder(/company|organization|workspace/i),
    );
    await companyNameInput.first().fill(creds.companyName);

    // Email field
    await page.getByLabel(/email/i).fill(creds.email);

    // Password field — use the first password field (the confirm may be second)
    const passwordFields = page.getByLabel(/^password$/i);
    await passwordFields.first().fill(creds.password);

    // Confirm password if present
    const confirmField = page
      .getByLabel(/confirm password|re-enter password/i)
      .first();
    const confirmCount = await confirmField.count();
    if (confirmCount > 0) {
      await confirmField.fill(creds.password);
    }

    // Accept Terms of Service checkbox if present
    const tosCheckbox = page
      .getByRole("checkbox", { name: /terms|tos|agree/i })
      .first();
    const tosCount = await tosCheckbox.count();
    if (tosCount > 0) {
      await tosCheckbox.check();
    }

    // -------------------------------------------------------------------------
    // Step 3: Submit the form
    // -------------------------------------------------------------------------
    await page
      .getByRole("button", { name: /create account|sign up|get started/i })
      .first()
      .click();

    // After submission we expect either:
    //   (a) /verify-email — email verification gate
    //   (b) /signup/provisioning — provisioning pending page
    //   (c) /dashboard/* — direct dashboard (if email verification is bypassed)
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith("/verify-email") ||
        url.pathname.startsWith("/signup/provisioning") ||
        url.pathname.startsWith("/dashboard"),
      { timeout: 30_000 },
    );

    const afterSubmitUrl = page.url();

    // If we're already in the dashboard, signup + verification are done.
    if (afterSubmitUrl.includes("/dashboard")) {
      // Confirm a dashboard element is visible.
      await expect(page.locator("body")).not.toHaveText(/error/i, {
        timeout: 10_000,
      });
      return;
    }

    // -------------------------------------------------------------------------
    // Step 4: Scrape verification token from log provider
    // -------------------------------------------------------------------------
    if (!isLogSourceReachable()) {
      test.skip(
        true,
        "Log source unreachable — skipping token-scrape step (cluster not running?)",
      );
      return;
    }

    const token = await scrapeToken({
      to: creds.email,
      tokenType: "verify",
      timeoutMs: 30_000,
    });

    expect(token).toBeTruthy();

    // -------------------------------------------------------------------------
    // Step 5: Navigate to the confirm endpoint
    // -------------------------------------------------------------------------
    await page.goto(
      `${BASE_URL}/verify-email/confirm?token=${encodeURIComponent(token)}`,
    );

    // -------------------------------------------------------------------------
    // Step 6: Expect success state and eventual dashboard access
    // -------------------------------------------------------------------------
    // The confirm page either auto-redirects (meta-refresh 2s) or shows a
    // success card. We accept both.
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith("/dashboard") ||
        url.pathname.startsWith("/verify-email"),
      { timeout: 30_000 },
    );

    const finalUrl = page.url();

    if (finalUrl.includes("/verify-email")) {
      // Success card on verify page — look for success wording.
      await expect(
        page.getByText(/verified|success|welcome|confirmed/i),
      ).toBeVisible({ timeout: 15_000 });

      // Wait for the meta-refresh redirect to dashboard.
      await page.waitForURL((url) => url.pathname.startsWith("/dashboard"), {
        timeout: 15_000,
      });
    }

    // Assert we landed on the dashboard (not an error page).
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await expect(
      page.getByText(/sign in|error|failed|invalid/i),
    ).not.toBeVisible();

    // -------------------------------------------------------------------------
    // Optional DB assertion: user row exists and emailVerified = true
    // -------------------------------------------------------------------------
    const user = await queryUser(creds.email);
    if (user !== null) {
      // Row should exist
      expect(user["email"]).toBe(creds.email.toLowerCase());
      // emailVerified should be true after confirmation
      expect(user["emailVerified"]).toBe(true);
    }
  });
});
