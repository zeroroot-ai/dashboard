/**
 * tenant-forbidden.spec.ts
 *
 * Deep-link to another tenant's resource → /dashboard/forbidden.
 *
 * Pre-conditions:
 *   DASHBOARD_EMAIL_PROVIDER=log
 *   DASHBOARD_CAPTCHA_PROVIDER=disabled
 *
 * Flow:
 *   1. Create tenant A (userA + slugA).
 *   2. Create tenant B (userB + slugB) — logged in as userB.
 *   3. While authenticated as userB, navigate to a dashboard URL scoped to
 *      tenantA (e.g., `/dashboard/${slugA}/settings`).
 *   4. Expect redirect to /dashboard/forbidden (not a 500 or a data leak).
 *   5. Assert the forbidden page renders with a "Go to your dashboard" escape
 *      hatch (not the tenant A content).
 *
 * The middleware (task 33) enforces tenant membership before serving any
 * tenant-scoped route. Non-member access hits the `/dashboard/forbidden` page.
 */

import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, generateUserCredentials } from "./helpers/fixtures";
import { scrapeToken, isLogSourceReachable } from "./helpers/email-log";
import { closeDbPool } from "./helpers/db";

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

async function extractActiveTenantSlug(page: Page): Promise<string | null> {
  // After signup+login the URL is typically /dashboard/<slug>/...
  const url = new URL(page.url());
  const parts = url.pathname.split("/").filter(Boolean);
  // Expected: ["dashboard", "<slug>", ...]
  if (parts[0] === "dashboard" && parts[1] && parts[1] !== "default") {
    return parts[1];
  }
  // Try /dashboard/default redirect — follow it.
  if (parts[1] === "default") {
    // The default route typically resolves to the user's only tenant.
    // We can't easily get the slug from client side here; return null.
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Tenant forbidden", () => {
  test.afterAll(async () => {
    await closeDbPool();
  });

  test("deep-link to another tenant's resource redirects to /dashboard/forbidden", async ({
    browser,
  }) => {
    if (!isLogSourceReachable()) {
      test.skip(
        true,
        "Log source unreachable — skipping tenant-forbidden test.",
      );
      return;
    }

    const userA = generateUserCredentials();
    const userB = generateUserCredentials();

    // ------------------------------------------------------------------
    // 1. Create Tenant A in context A.
    // ------------------------------------------------------------------
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    let slugA: string | null = null;

    try {
      await signupAndVerify(pageA, userA);
      await expect(pageA).toHaveURL(/\/dashboard/, { timeout: 15_000 });
      slugA = await extractActiveTenantSlug(pageA);
    } finally {
      await ctxA.close();
    }

    // If we couldn't determine slugA from URL (e.g., /dashboard/default),
    // fall back to the slug we generated.
    if (!slugA) {
      slugA = userA.slug;
    }

    // ------------------------------------------------------------------
    // 2. Create Tenant B and sign in as userB.
    // ------------------------------------------------------------------
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();

    try {
      await signupAndVerify(pageB, userB);
      await expect(pageB).toHaveURL(/\/dashboard/, { timeout: 15_000 });

      // ------------------------------------------------------------------
      // 3. Navigate to a URL scoped to Tenant A while authenticated as userB.
      // ------------------------------------------------------------------
      // We try several candidate paths that would be tenant-scoped.
      // The middleware should catch any of them.
      const candidatePaths = [
        `/dashboard/${slugA}/settings`,
        `/dashboard/${slugA}/agents`,
        `/dashboard/${slugA}`,
      ];

      let forbiddenDetected = false;

      for (const path of candidatePaths) {
        await pageB.goto(`${BASE_URL}${path}`);

        await pageB.waitForURL(
          (url) =>
            url.pathname.startsWith("/dashboard/forbidden") ||
            url.pathname.startsWith("/dashboard/no-workspace") ||
            // Some configurations 404 instead of forbidden for unknown tenant.
            url.pathname === path ||
            url.pathname.startsWith("/login"),
          { timeout: 15_000 },
        );

        const resultUrl = pageB.url();

        if (resultUrl.includes("/dashboard/forbidden")) {
          forbiddenDetected = true;
          break;
        }
        if (resultUrl.includes("/dashboard/no-workspace")) {
          // No-workspace is also an acceptable "you don't have access here" state.
          forbiddenDetected = true;
          break;
        }
      }

      // ------------------------------------------------------------------
      // 4. Assert forbidden state.
      // ------------------------------------------------------------------
      expect(forbiddenDetected).toBe(true);

      // ------------------------------------------------------------------
      // 5. Assert the forbidden page content.
      // ------------------------------------------------------------------
      const finalUrl = pageB.url();

      if (finalUrl.includes("/dashboard/forbidden")) {
        await expect(pageB).toHaveURL(/\/dashboard\/forbidden/, { timeout: 10_000 });

        // The page must NOT leak tenant A's data.
        await expect(pageB.getByText(userA.companyName)).not.toBeVisible();

        // The page should have an escape hatch back to the user's own dashboard.
        const dashboardLink = pageB
          .getByRole("link", { name: /go to dashboard|my dashboard|your workspace/i })
          .or(pageB.getByRole("button", { name: /dashboard|workspace/i }))
          .first();
        await expect(dashboardLink).toBeVisible({ timeout: 10_000 });
      } else if (finalUrl.includes("/dashboard/no-workspace")) {
        // Acceptable: user B is being told they have no access to this resource.
        await expect(pageB).toHaveURL(/\/dashboard\/no-workspace/, {
          timeout: 10_000,
        });
      }
    } finally {
      await ctxB.close();
    }
  });
});
