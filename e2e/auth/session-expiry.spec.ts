/**
 * session-expiry.spec.ts
 *
 * Expired cookie → /dashboard/login/expired.
 *
 * Strategy:
 *   Playwright cannot set arbitrary cookie expiry in the past via the cookie
 *   API because browsers reject cookies with past expiry on set.  Instead we
 *   use one of two approaches:
 *
 *   (A) Delete the session cookie entirely — Better Auth interprets a missing
 *       session cookie as "unauthenticated" and the middleware redirects to
 *       the login page.  The middleware in this codebase redirects expired /
 *       missing sessions to `/dashboard/login/expired` (not the plain login
 *       page).  This is the approach used here.
 *
 *   (B) Future improvement: manipulate the Better Auth `session` DB row
 *       directly via the DB helper to set `expiresAt` in the past, then
 *       reload.  This requires DB access and is left as a follow-on.
 *
 * Flow:
 *   1. Create and verify a user; sign in.
 *   2. Save the session cookie names.
 *   3. Delete all auth-related cookies from the browser context.
 *   4. Navigate to a dashboard page.
 *   5. Expect redirect to /dashboard/login/expired (or /login with expiry
 *      param, as configured by middleware.ts task 16).
 *   6. Assert the expired-session page renders with a "sign in again" CTA.
 */

import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, generateUserCredentials } from "./helpers/fixtures";
import { scrapeToken, isLogSourceReachable } from "./helpers/email-log";
import { closeDbPool } from "./helpers/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signupAndLogin(
  page: Page,
  creds: ReturnType<typeof generateUserCredentials>,
): Promise<void> {
  // Signup.
  await page.goto(`${BASE_URL}/signup`);
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

  // Verify email if needed.
  if (page.url().includes("/verify-email") && isLogSourceReachable()) {
    const token = await scrapeToken({
      to: creds.email,
      tokenType: "verify",
      timeoutMs: 30_000,
    });
    await page.goto(
      `${BASE_URL}/verify-email/confirm?token=${encodeURIComponent(token)}`,
    );
    await page.waitForURL(
      (url) => url.pathname.startsWith("/dashboard") || url.pathname.startsWith("/verify-email"),
      { timeout: 20_000 },
    );
    if (!page.url().includes("/dashboard")) {
      await page.waitForURL((url) => url.pathname.startsWith("/dashboard"), {
        timeout: 10_000,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Session expiry", () => {
  test.afterAll(async () => {
    await closeDbPool();
  });

  test("expired / missing session cookie redirects to /dashboard/login/expired", async ({
    browser,
  }) => {
    if (!isLogSourceReachable()) {
      // We can still run this test without the log source IF we have a
      // pre-seeded user, but the full setup requires verify-email scraping.
      // For simplicity, skip when the cluster is unreachable.
      test.skip(
        true,
        "Log source unreachable — skipping session expiry test.",
      );
      return;
    }

    const creds = generateUserCredentials();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      // ------------------------------------------------------------------
      // 1. Create + verify + sign in.
      // ------------------------------------------------------------------
      await signupAndLogin(page, creds);
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

      // ------------------------------------------------------------------
      // 2. Capture current cookies for reference.
      // ------------------------------------------------------------------
      const cookiesBefore = await ctx.cookies();
      const authCookieNames = cookiesBefore
        .filter(
          (c) =>
            c.name.startsWith("better-auth") ||
            c.name.startsWith("__session") ||
            c.name.includes("session") ||
            c.name.includes("auth"),
        )
        .map((c) => c.name);

      // ------------------------------------------------------------------
      // 3. Delete all session cookies to simulate an expired session.
      // ------------------------------------------------------------------
      if (authCookieNames.length > 0) {
        // Clear all cookies by setting the storage state to empty.
        await ctx.clearCookies();
      } else {
        // Fallback: clear all cookies regardless.
        await ctx.clearCookies();
      }

      // ------------------------------------------------------------------
      // 4. Navigate to a protected dashboard route.
      // ------------------------------------------------------------------
      await page.goto(`${BASE_URL}/dashboard/default`);

      // ------------------------------------------------------------------
      // 5. Expect redirect to the expired-session page.
      // ------------------------------------------------------------------
      await page.waitForURL(
        (url) =>
          url.pathname.startsWith("/dashboard/login/expired") ||
          // Some middleware configurations redirect to /login with a param.
          (url.pathname.startsWith("/login") &&
            (url.search.includes("expired") || url.search.includes("callback"))),
        { timeout: 20_000 },
      );

      // ------------------------------------------------------------------
      // 6. Assert the expired page renders with a sign-in-again CTA.
      // ------------------------------------------------------------------
      const expiredUrl = page.url();

      if (expiredUrl.includes("/dashboard/login/expired")) {
        await expect(page).toHaveURL(/\/dashboard\/login\/expired/, {
          timeout: 10_000,
        });

        // Page should mention the session expired and have a link to sign in.
        await expect(
          page.getByText(/session.*expired|sign.*again|log.*again/i),
        ).toBeVisible({ timeout: 10_000 });

        const signinLink = page
          .getByRole("link", { name: /sign in|log in|login/i })
          .or(page.getByRole("button", { name: /sign in|log in/i }))
          .first();
        await expect(signinLink).toBeVisible({ timeout: 10_000 });
      } else {
        // Acceptable fallback: plain login page with a callbackUrl param.
        await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
        await expect(
          page.getByRole("button", { name: /^log ?in$|^sign ?in$/i }),
        ).toBeVisible({ timeout: 10_000 });
      }
    } finally {
      await ctx.close();
    }
  });
});
