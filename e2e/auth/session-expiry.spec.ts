// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * session-expiry.spec.ts
 *
 * A browser whose session cookie is gone is sent back to /login with a
 * callbackUrl, and never to /api/auth/federated-signout (middleware.ts,
 * `denyUnauthenticated`).
 *
 * Browsers refuse a cookie with an expiry in the past, so the spec clears
 * the cookie jar after a real sign-in and reloads a protected route. Auth.js
 * reads a missing cookie and an expired one the same way.
 *
 * Credentials: E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ADMIN_TOTP_SECRET.
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, requireAdmin, signIn } from "./helpers/accounts";

test.describe("Session expiry", () => {
  test("a cleared session cookie sends the browser back to /login with a callbackUrl", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const account = requireAdmin();

    await signIn(page, context, account);
    await expect(page).toHaveURL(/\/dashboard/);

    await context.clearCookies();
    await page.goto(`${BASE_URL}/dashboard`);

    await page.waitForURL((url) => url.pathname.startsWith("/login"), {
      timeout: 20_000,
    });
    const landed = page.url();
    expect(landed).not.toContain("federated-signout");
    expect(decodeURIComponent(landed)).toContain("callbackUrl=/dashboard");

    // The gate is there to sign in again.
    await expect(
      page.getByRole("button", { name: /^sign in$/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
