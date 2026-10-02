// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * login-happy.spec.ts
 *
 * The admin account signs in through the /login gate and Zitadel's hosted
 * Login v2 (email, password, TOTP) and lands on /dashboard with an Auth.js
 * session cookie. This is the anchor test of the staging lane: when it
 * fails, every other signed-in spec fails for the same reason.
 *
 * Credentials: E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ADMIN_TOTP_SECRET
 * (see helpers/accounts.ts).
 */

import { test, expect } from "@playwright/test";
import { requireAdmin, signIn } from "./helpers/accounts";

test.describe("Login, happy path", () => {
  test("the admin account signs in through Zitadel and lands on the dashboard", async ({
    page,
    context,
  }) => {
    // The gate, three Login v2 pages and the OIDC callback.
    test.setTimeout(120_000);
    const account = requireAdmin();

    await signIn(page, context, account);

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("banner")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(/invalid email or password|sign in failed/i),
    ).not.toBeVisible();
  });
});
