// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * authz/admin.spec.ts
 *
 * The gated admin chrome is visible to an Owner or Admin: the three gated
 * settings nav entries, the Add secret link, the secret broker's Test
 * connection and Save buttons, the Permissions page, and an enabled Deploy
 * CTA on the agents, plugins and tools pages.
 *
 * Counterpart of non-admin.spec.ts. Both sign in as real accounts; nothing
 * is mocked, so the gating decision under test is the one the server makes
 * from FGA (ADR-0093: written in Zitadel, checked in FGA).
 *
 * Credentials: E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ADMIN_TOTP_SECRET.
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, requireAdmin, signIn } from "../auth/helpers/accounts";

const SETTINGS_URL = `${BASE_URL}/dashboard/pages/settings`;
const SECRETS_URL = `${SETTINGS_URL}/secrets`;
const SECRETS_BACKEND_URL = `${SETTINGS_URL}/secrets-backend`;
const GRANTS_URL = `${SETTINGS_URL}/grants`;

test.describe("Authz gating, admin visibility", () => {
  test.beforeEach(async ({ page, context }) => {
    test.setTimeout(120_000);
    await signIn(page, context, requireAdmin());
  });

  for (const title of ["Secrets", "Secret Broker", "Permissions"] as const) {
    test(`the settings nav shows the ${title} entry`, async ({ page }) => {
      await page.goto(SETTINGS_URL);
      await expect(
        page.locator("nav").getByRole("link", { name: new RegExp(`^${title}$`, "i") }),
      ).toBeVisible({ timeout: 20_000 });
    });
  }

  test("the Add secret link is present on the secrets page", async ({ page }) => {
    await page.goto(SECRETS_URL);
    await expect(
      page.getByRole("link", { name: /add secret/i }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("Test connection and Save configuration are present on the secret broker page", async ({
    page,
  }) => {
    await page.goto(SECRETS_BACKEND_URL);
    await expect(page.getByTestId("probe-button")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("save-button")).toBeVisible({ timeout: 20_000 });
  });

  test("the Permissions page renders for an admin", async ({ page }) => {
    await page.goto(GRANTS_URL);
    await page.waitForLoadState("networkidle", { timeout: 20_000 });
    await expect(page).toHaveURL(/\/settings\/grants/);
    // The page renders its content, not the denial alert a Viewer gets.
    await expect(
      page
        .locator('[role="alert"]')
        .filter({ hasText: /admin permissions|not authorized|access denied|forbidden/i }),
    ).toHaveCount(0);
    await expect(page.getByText(/grants|permissions/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  for (const [type, path] of [
    ["agent", "/dashboard/agents"],
    ["plugin", "/dashboard/integrations?tab=plugins"],
    ["tool", "/dashboard/tools"],
  ] as const) {
    test(`the Deploy ${type} CTA is enabled for an admin`, async ({ page }) => {
      await page.goto(`${BASE_URL}${path}`);
      const cta = page.getByRole("link", { name: new RegExp(`deploy ${type}`, "i") });
      await expect(cta.first()).toBeVisible({ timeout: 20_000 });
      // The denied variant wraps the CTA in data-testid="auth-gated-button-denied".
      await expect(page.getByTestId("auth-gated-button-denied")).toHaveCount(0, {
        timeout: 3_000,
      });
    });
  }
});
