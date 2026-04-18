/**
 * forgot-reset.spec.ts
 *
 * Full password reset loop:
 *   1. Request a reset via /forgot-password.
 *   2. Scrape the reset token from the log provider.
 *   3. Navigate to /reset-password?token=<token> and set a new password.
 *   4. Sign in with the new password → land on dashboard.
 *
 * Pre-conditions:
 *   DASHBOARD_EMAIL_PROVIDER=log
 *   DASHBOARD_CAPTCHA_PROVIDER=disabled
 *
 * Requires a cluster with the dashboard running so the reset email is
 * dispatched and logged.  Test skips if `isLogSourceReachable()` returns
 * false.
 */

import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, generateUserCredentials, securePassword } from "./helpers/fixtures";
import { scrapeToken, isLogSourceReachable } from "./helpers/email-log";
import { closeDbPool } from "./helpers/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signup(
  page: Page,
  companyName: string,
  email: string,
  password: string,
) {
  await page.goto(`${BASE_URL}/signup`);
  const companyInput = page.getByLabel(/company name/i).or(
    page.getByPlaceholder(/company|organization|workspace/i),
  );
  await companyInput.first().fill(companyName);
  await page.getByLabel(/email/i).fill(email);
  const pwFields = page.getByLabel(/^password$/i);
  await pwFields.first().fill(password);
  const confirm = page.getByLabel(/confirm password|re-enter password/i).first();
  if ((await confirm.count()) > 0) await confirm.fill(password);
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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Forgot / reset password", () => {
  test.afterAll(async () => {
    await closeDbPool();
  });

  test("request reset → scrape token → set new password → sign in succeeds", async ({
    browser,
  }) => {
    if (!isLogSourceReachable()) {
      test.skip(
        true,
        "Log source unreachable — skipping reset flow (cluster not running?).",
      );
      return;
    }

    const creds = generateUserCredentials();
    const newPassword = securePassword(); // fresh password distinct from the original

    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      // ------------------------------------------------------------------
      // 1. Create a verified user.
      // ------------------------------------------------------------------
      await signup(page, creds.companyName, creds.email, creds.password);

      // Verify email if required.
      if (page.url().includes("/verify-email")) {
        const verifyToken = await scrapeToken({
          to: creds.email,
          tokenType: "verify",
          timeoutMs: 30_000,
        });
        await page.goto(
          `${BASE_URL}/verify-email/confirm?token=${encodeURIComponent(verifyToken)}`,
        );
        await page.waitForURL(
          (url) =>
            url.pathname.startsWith("/dashboard") ||
            url.pathname.startsWith("/verify-email"),
          { timeout: 20_000 },
        );
      }

      // Sign out.
      if (page.url().includes("/dashboard")) {
        const signoutBtn = page
          .getByRole("button", { name: /sign out|log out/i })
          .first();
        if ((await signoutBtn.count()) > 0) {
          await signoutBtn.click();
          await page.waitForURL(
            (url) => !url.pathname.startsWith("/dashboard"),
            { timeout: 10_000 },
          );
        } else {
          await page.goto(`${BASE_URL}/login`);
        }
      }

      // ------------------------------------------------------------------
      // 2. Navigate to /forgot-password and request a reset.
      // ------------------------------------------------------------------
      await page.goto(`${BASE_URL}/forgot-password`);
      await expect(page).toHaveURL(/\/forgot-password/, { timeout: 15_000 });

      await page.getByLabel(/email/i).fill(creds.email);
      await page
        .getByRole("button", { name: /send|reset|request/i })
        .first()
        .click();

      // The forgot-password action always returns a generic success message
      // regardless of whether the email exists (enumeration resistance).
      await expect(
        page.getByText(/check your email|link.*sent|instructions.*sent|sent/i),
      ).toBeVisible({ timeout: 15_000 });

      // ------------------------------------------------------------------
      // 3. Scrape the reset token.
      // ------------------------------------------------------------------
      const resetToken = await scrapeToken({
        to: creds.email,
        tokenType: "reset",
        timeoutMs: 30_000,
      });

      expect(resetToken).toBeTruthy();

      // ------------------------------------------------------------------
      // 4. Navigate to /reset-password?token=<token> and set a new password.
      // ------------------------------------------------------------------
      await page.goto(
        `${BASE_URL}/reset-password?token=${encodeURIComponent(resetToken)}`,
      );
      await expect(page).toHaveURL(/\/reset-password/, { timeout: 15_000 });

      // Fill in the new password.
      const pwFields = page.getByLabel(/^(new )?password$/i);
      await pwFields.first().fill(newPassword);

      const confirmField = page
        .getByLabel(/confirm (new )?password|re-enter/i)
        .first();
      if ((await confirmField.count()) > 0) {
        await confirmField.fill(newPassword);
      }

      await page
        .getByRole("button", { name: /reset|set|change|update|save/i })
        .first()
        .click();

      // After successful reset we expect either a success message, an
      // auto-redirect to /login, or a redirect to the dashboard.
      await page.waitForURL(
        (url) =>
          url.pathname.startsWith("/login") ||
          url.pathname.startsWith("/dashboard") ||
          url.pathname.startsWith("/reset-password"),
        { timeout: 20_000 },
      );

      // If still on reset-password, look for a success banner.
      if (page.url().includes("/reset-password")) {
        await expect(
          page.getByText(/success|updated|changed|reset/i),
        ).toBeVisible({ timeout: 10_000 });
      }

      // ------------------------------------------------------------------
      // 5. Sign in with the NEW password.
      // ------------------------------------------------------------------
      await page.goto(`${BASE_URL}/login`);
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

      await page.getByLabel(/email/i).fill(creds.email);
      await page.getByLabel(/password/i).first().fill(newPassword);
      await page
        .getByRole("button", { name: /^log ?in$|^sign ?in$/i })
        .first()
        .click();

      await page.waitForURL(
        (url) => !url.pathname.startsWith("/login"),
        { timeout: 20_000 },
      );

      // Assert we landed on the dashboard.
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
      await expect(
        page.getByText(/invalid email or password|error|failed/i),
      ).not.toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
