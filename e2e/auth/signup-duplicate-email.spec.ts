/**
 * signup-duplicate-email.spec.ts
 *
 * Duplicate email → EMAIL_ALREADY_REGISTERED page-level error with sign-in
 * and reset links visible.
 *
 * Pre-conditions:
 *   DASHBOARD_EMAIL_PROVIDER=log
 *   DASHBOARD_CAPTCHA_PROVIDER=disabled
 *
 * Flow:
 *   1. Sign up user A with email E (establishes the email in the system).
 *   2. Attempt signup with the same email E but a different company name.
 *   3. Expect EMAIL_ALREADY_REGISTERED response, either:
 *      (a) A page-level inline alert on /signup, or
 *      (b) A redirect to /signup/duplicate-email page.
 *   4. In either case, assert that a link to /login and /forgot-password
 *      are visible.
 */

import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, generateUserCredentials } from "./helpers/fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fillAndSubmitSignup(
  page: Page,
  companyName: string,
  email: string,
  password: string,
) {
  await page.goto(`${BASE_URL}/signup`);
  await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 });

  const companyInput = page.getByLabel(/company name/i).or(
    page.getByPlaceholder(/company|organization|workspace/i),
  );
  await companyInput.first().fill(companyName);

  await page.getByLabel(/email/i).fill(email);

  const passwordFields = page.getByLabel(/^password$/i);
  await passwordFields.first().fill(password);

  const confirmField = page
    .getByLabel(/confirm password|re-enter password/i)
    .first();
  if ((await confirmField.count()) > 0) {
    await confirmField.fill(password);
  }

  const tosCheckbox = page
    .getByRole("checkbox", { name: /terms|tos|agree/i })
    .first();
  if ((await tosCheckbox.count()) > 0) {
    await tosCheckbox.check();
  }

  await page
    .getByRole("button", { name: /create account|sign up|get started/i })
    .first()
    .click();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Signup, duplicate email", () => {
  test("duplicate email shows EMAIL_ALREADY_REGISTERED with sign-in and reset links", async ({
    browser,
  }) => {
    const userA = generateUserCredentials();

    // -------------------------------------------------------------------------
    // Step 1: Sign up user A to establish the email.
    // -------------------------------------------------------------------------
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();

    try {
      await fillAndSubmitSignup(
        pageA,
        userA.companyName,
        userA.email,
        userA.password,
      );

      // Wait for post-signup navigation.
      await pageA.waitForURL(
        (url) =>
          url.pathname.startsWith("/verify-email") ||
          url.pathname.startsWith("/signup/provisioning") ||
          url.pathname.startsWith("/dashboard"),
        { timeout: 30_000 },
      );
    } finally {
      await ctxA.close();
    }

    // -------------------------------------------------------------------------
    // Step 2: Attempt signup with the same email but a different company name.
    // -------------------------------------------------------------------------
    const userB = generateUserCredentials(); // fresh slug / company name
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();

    try {
      await fillAndSubmitSignup(
        pageB,
        userB.companyName, // different company name → no slug collision
        userA.email, // same email → EMAIL_ALREADY_REGISTERED
        userB.password,
      );

      // -------------------------------------------------------------------------
      // Step 3: Expect EMAIL_ALREADY_REGISTERED error state.
      // -------------------------------------------------------------------------
      // Could stay on /signup or redirect to /signup/duplicate-email.
      await pageB.waitForURL(
        (url) =>
          url.pathname.startsWith("/signup"),
        { timeout: 20_000 },
      );

      // Look for the error text in any form.
      const errorLocator = pageB
        .getByText(/already registered|already exists|account.*exists|email.*taken/i)
        .or(pageB.getByText(/EMAIL_ALREADY_REGISTERED/))
        .or(
          pageB
            .getByRole("alert")
            .filter({ hasText: /already|exists|registered/i }),
        );

      await expect(errorLocator.first()).toBeVisible({ timeout: 15_000 });

      // -------------------------------------------------------------------------
      // Step 4: Assert sign-in and reset links are visible.
      // -------------------------------------------------------------------------
      // Sign-in link
      const signinLink = pageB
        .getByRole("link", { name: /sign in|log in|login/i })
        .first();
      await expect(signinLink).toBeVisible({ timeout: 10_000 });

      // Reset / forgot password link
      const resetLink = pageB
        .getByRole("link", { name: /forgot|reset|password/i })
        .first();
      await expect(resetLink).toBeVisible({ timeout: 10_000 });

      // Verify the sign-in link points somewhere sensible.
      const href = await signinLink.getAttribute("href");
      expect(href).toMatch(/login|sign-in/i);
    } finally {
      await ctxB.close();
    }
  });
});
