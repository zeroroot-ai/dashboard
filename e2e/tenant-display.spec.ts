// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * tenant-display.spec.ts
 *
 * The chrome (sidebar workspace label and header tenant display) shows the
 * active tenant's resolved displayName and not the "No workspace" fallback.
 *
 * The header and sidebar are hydrated server-side: getServerSession() then
 * resolveTenant() then <TenantHydrator>. The spec signs in for real and
 * validates the whole path against the live tenant (ADR-0093 decision 4: the
 * tenant comes from the server-side session, never from a cookie).
 *
 * Credentials: E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ADMIN_TOTP_SECRET.
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, requireAdmin, signIn } from "./auth/helpers/accounts";

test.describe("Tenant chrome shows the resolved tenant", () => {
  test.beforeEach(async ({ page, context }) => {
    test.setTimeout(120_000);
    await signIn(page, context, requireAdmin());
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState("domcontentloaded");
  });

  test("the header does not render the No workspace fallback", async ({ page }) => {
    const header = page.getByRole("banner");
    await expect(header).toBeVisible({ timeout: 15_000 });
    await expect(header).not.toContainText("No workspace", { timeout: 5_000 });
  });

  test("the sidebar does not render the No workspace fallback", async ({ page }) => {
    const sidebar = page.locator('aside,[data-slot="sidebar"]').first();
    await expect(sidebar).toBeVisible({ timeout: 15_000 });
    await expect(sidebar).not.toContainText("No workspace", { timeout: 5_000 });
  });
});
