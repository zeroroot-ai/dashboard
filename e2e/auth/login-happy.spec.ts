/**
 * login-happy.spec.ts
 *
 * Happy-path login: known email + correct password → dashboard.
 *
 * Pre-conditions:
 *   DASHBOARD_EMAIL_PROVIDER=log
 *   DASHBOARD_CAPTCHA_PROVIDER=disabled
 *
 * Because we need a pre-existing user with a verified email we either:
 *   (a) Read credentials from E2E_SEED_EMAIL / E2E_SEED_PASSWORD env vars
 *       (for running against a cluster with a pre-seeded user), or
 *   (b) Create a fresh user via the signup flow and skip verification by
 *       using the token-scrape helper, then sign in.
 *
 * Strategy (b) is the self-contained default so no external seed is required.
 */

import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, generateUserCredentials } from "./helpers/fixtures";
import { scrapeToken, isLogSourceReachable } from "./helpers/email-log";
import { closeDbPool } from "./helpers/db";

// ---------------------------------------------------------------------------
// Seed: allow overriding credentials via env for cluster-seeded runs.
// ---------------------------------------------------------------------------

const SEED_EMAIL = process.env.E2E_SEED_EMAIL;
const SEED_PASSWORD = process.env.E2E_SEED_PASSWORD;

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

async function loginWith(
  page: Page,
  email: string,
  password: string,
) {
  await page.goto(`${BASE_URL}/login`);
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).first().fill(password);
  await page
    .getByRole("button", { name: /^log ?in$|^sign ?in$/i })
    .first()
    .click();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Login, happy path", () => {
  test.afterAll(async () => {
    await closeDbPool();
  });

  test("correct credentials → redirect to dashboard", async ({ browser }) => {
    // If a pre-seeded user is provided, use them directly.
    if (SEED_EMAIL && SEED_PASSWORD) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await loginWith(page, SEED_EMAIL, SEED_PASSWORD);
        await page.waitForURL(
          (url) => !url.pathname.startsWith("/login"),
          { timeout: 20_000 },
        );
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
        await expect(
          page.getByText(/error|failed|invalid/i),
        ).not.toBeVisible();
      } finally {
        await ctx.close();
      }
      return;
    }

    // Self-contained: sign up a fresh user, verify their email, then log in.
    if (!isLogSourceReachable()) {
      test.skip(
        true,
        "Log source unreachable and no E2E_SEED_EMAIL set, skipping.",
      );
      return;
    }

    const creds = generateUserCredentials();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      // 1. Create the user via signup.
      await signup(page, creds.companyName, creds.email, creds.password);

      // 2. If we landed on the dashboard, email verification is not required.
      if (page.url().includes("/dashboard")) {
        await expect(page.getByText(/error|failed|invalid/i)).not.toBeVisible();
        return;
      }

      // 3. Scrape and consume the verify token.
      const token = await scrapeToken({
        to: creds.email,
        tokenType: "verify",
        timeoutMs: 30_000,
      });
      await page.goto(
        `${BASE_URL}/verify-email/confirm?token=${encodeURIComponent(token)}`,
      );
      // Wait for success or dashboard redirect.
      await page.waitForURL(
        (url) =>
          url.pathname.startsWith("/dashboard") ||
          url.pathname.startsWith("/verify-email"),
        { timeout: 20_000 },
      );
      if (!page.url().includes("/dashboard")) {
        // Wait for meta-refresh.
        await page.waitForURL(
          (url) => url.pathname.startsWith("/dashboard"),
          { timeout: 10_000 },
        );
      }

      // 4. Sign out so we can test login cleanly.
      // Hit the signout action by navigating to a URL that triggers it, or
      // look for a signout button in the sidebar.
      const signoutBtn = page
        .getByRole("button", { name: /sign out|log out/i })
        .first();
      if ((await signoutBtn.count()) > 0) {
        await signoutBtn.click();
        await page.waitForURL((url) => !url.pathname.startsWith("/dashboard"), {
          timeout: 10_000,
        });
      } else {
        // Navigate directly to the signed-out state.
        await page.goto(`${BASE_URL}/login`);
      }

      // 5. Log in with the verified credentials.
      await loginWith(page, creds.email, creds.password);
      await page.waitForURL(
        (url) => !url.pathname.startsWith("/login"),
        { timeout: 20_000 },
      );

      // 6. Assert we landed on the dashboard.
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
      await expect(
        page.getByText(/invalid email or password|error|failed/i),
      ).not.toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
