// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * admin-chrome.spec.ts
 *
 * The admin-only chrome gated by `usePermitted(...)` renders for an Owner or
 * Admin. The hooks read the server-hydrated TenantContextProvider; before
 * this spec they read dead session fields and the chrome was hidden from
 * every user.
 *
 * The permissions on the context are computed server-side from FGA, so this
 * spec signs in as the real admin account and asserts against the live
 * tenant. The member-side absence is in e2e/authz/non-admin.spec.ts.
 *
 * Credentials: E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ADMIN_TOTP_SECRET.
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, requireAdmin, signIn } from "./auth/helpers/accounts";

test.describe("Admin-only chrome via usePermitted (Owner or Admin)", () => {
  test.beforeEach(async ({ page, context }) => {
    test.setTimeout(120_000);
    await signIn(page, context, requireAdmin());
  });

  test("Users page shows the Invite control", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/organization/users`);
    // `usePermitted("team:manage")` gates the Invite button on UsersContent.
    await expect(
      page.getByRole("button", { name: /invite user|invite your first user/i }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  for (const [type, path] of [
    ["agent", "/dashboard/agents"],
    ["tool", "/dashboard/tools"],
    ["plugin", "/dashboard/plugins"],
  ] as const) {
    test(`${type}s page shows the Deploy ${type} CTA`, async ({ page }) => {
      await page.goto(`${BASE_URL}${path}`);
      // The DeployLauncher links to /dashboard/deploy?type=<type>.
      await expect(
        page.getByRole("link", { name: new RegExp(`deploy ${type}`, "i") }).first(),
      ).toBeVisible({ timeout: 20_000 });
    });
  }
});
