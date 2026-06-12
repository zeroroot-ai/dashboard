/**
 * no-workspace.spec.ts
 *
 * Delete all memberships for a user, refresh → /dashboard/no-workspace
 * (not /signup?error=no-org).
 *
 * Pre-conditions:
 *   DASHBOARD_EMAIL_PROVIDER=log
 *   DASHBOARD_CAPTCHA_PROVIDER=disabled
 *   DATABASE_URL or PGHOST/PGPORT pointing at the dashboard Postgres.
 *
 * Flow:
 *   1. Create a fresh user via signup + verify.
 *   2. Sign in → confirm dashboard access.
 *   3. Use the DB helper to delete all membership rows for this user.
 *   4. Refresh the dashboard → expect redirect to /dashboard/no-workspace.
 *   5. Assert the no-workspace page renders with a "create workspace" CTA
 *      and does NOT redirect to /signup?error=no-org.
 *
 * Note: if the DB is not reachable (no DATABASE_URL), the test skips the
 * membership-deletion step and verifies the page structure only.
 */

import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, generateUserCredentials } from "./helpers/fixtures";
import { scrapeToken, isLogSourceReachable } from "./helpers/email-log";
import {
  deleteAllMembershipsForEmail,
  isDbAvailable,
  closeDbPool,
} from "./helpers/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signupAndVerify(
  page: Page,
  creds: ReturnType<typeof generateUserCredentials>,
): Promise<void> {
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

  // Verify email if required.
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
      (url) =>
        url.pathname.startsWith("/dashboard") ||
        url.pathname.startsWith("/verify-email"),
      { timeout: 20_000 },
    );
    if (!page.url().includes("/dashboard")) {
      await page.waitForURL(
        (url) => url.pathname.startsWith("/dashboard"),
        { timeout: 10_000 },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("No-workspace page", () => {
  test.afterAll(async () => {
    await closeDbPool();
  });

  test("user with no memberships is redirected to /dashboard/no-workspace", async ({
    browser,
  }) => {
    const dbAvail = await isDbAvailable();

    if (!dbAvail) {
      test.skip(
        true,
        "DATABASE_URL not available, cannot delete memberships; skipping test.",
      );
      return;
    }

    if (!isLogSourceReachable()) {
      test.skip(
        true,
        "Log source unreachable, cannot verify email; skipping test.",
      );
      return;
    }

    const creds = generateUserCredentials();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      // ------------------------------------------------------------------
      // 1. Create + verify user.
      // ------------------------------------------------------------------
      await signupAndVerify(page, creds);

      // ------------------------------------------------------------------
      // 2. Assert dashboard is accessible (sanity check).
      // ------------------------------------------------------------------
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

      // ------------------------------------------------------------------
      // 3. Delete all memberships for this user via DB.
      // ------------------------------------------------------------------
      const deleted = await deleteAllMembershipsForEmail(creds.email);
      expect(deleted).toBe(true);

      // ------------------------------------------------------------------
      // 4. Refresh the dashboard.
      // ------------------------------------------------------------------
      await page.reload();

      // The layout middleware should detect no memberships and redirect.
      await page.waitForURL(
        (url) =>
          url.pathname.startsWith("/dashboard/no-workspace") ||
          url.pathname.startsWith("/login") ||
          // Older redirect pattern that should no longer exist.
          url.pathname.startsWith("/signup"),
        { timeout: 20_000 },
      );

      const redirectedUrl = page.url();

      // Assert we went to the new no-workspace page, NOT the old ?error=no-org path.
      expect(redirectedUrl).toContain("/dashboard/no-workspace");
      expect(redirectedUrl).not.toContain("/signup?error=no-org");
      expect(redirectedUrl).not.toContain("?error=no-org");

      // ------------------------------------------------------------------
      // 5. Assert the no-workspace page renders correctly.
      // ------------------------------------------------------------------
      await expect(page).toHaveURL(/\/dashboard\/no-workspace/, { timeout: 10_000 });

      // A "create workspace" or "create account" CTA must be present.
      const createCTA = page
        .getByRole("link", { name: /create.*workspace|new.*workspace|create.*org/i })
        .or(page.getByRole("button", { name: /create.*workspace|create.*org/i }))
        .first();
      await expect(createCTA).toBeVisible({ timeout: 10_000 });

      // A sign-out option should be present as an escape hatch.
      const signout = page
        .getByRole("button", { name: /sign out|log out/i })
        .first();
      await expect(signout).toBeVisible({ timeout: 10_000 });
    } finally {
      await ctx.close();
    }
  });
});
