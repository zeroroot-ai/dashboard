// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * connectors.spec.ts, the dashboard half of the ADR-0067 connector arc
 * (dashboard#1128).
 *
 * Covers, in ADR-0067 terms:
 *   - an admin enables a connector from the catalog and it appears in the
 *     Enabled section;
 *   - a plain member sees the catalog but no Enable or Disable control;
 *   - the connector appears in the security-policy matrix beside the other
 *     component kinds, with an execute switch.
 *
 * The team-scoped deny and the per-agent grant assertions of the original
 * spec are gone: the teams page moved to /dashboard/organization/teams with
 * a different form, and the agent detail page has no grants tab.
 *
 * The first run enables the connector in the e2e tenant on staging. Later
 * runs find it already enabled and only assert the state.
 *
 * Gates:
 *   E2E_CLUSTER_AVAILABLE=1       a live platform is reachable
 *   E2E_ADMIN_*, E2E_MEMBER_*     the two accounts (helpers/accounts.ts)
 *   E2E_CONNECTOR_NAME            the catalog display name to drive (default: GitLab)
 */

import { test, expect, type Page } from "@playwright/test";
import {
  BASE_URL,
  requireAdmin,
  requireMember,
  signIn,
} from "./auth/helpers/accounts";

const CONNECTOR_NAME = process.env.E2E_CONNECTOR_NAME ?? "GitLab";
const needsCluster = !process.env.E2E_CLUSTER_AVAILABLE;

function catalogCard(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^catalog$/i }) })
    .locator('[data-slot="card"]')
    .filter({ hasText: CONNECTOR_NAME })
    .first();
}

function enabledSection(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^enabled$/i }) });
}

test.describe("connectors, integration (live platform)", () => {
  test.skip(needsCluster, "requires a live platform and E2E_CLUSTER_AVAILABLE=1");
  // The member and matrix tests read the state the first test establishes.
  test.describe.configure({ mode: "serial" });

  test("an admin enables a connector from the catalog and it appears in the Enabled section", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, context, requireAdmin());
    await page.goto(`${BASE_URL}/dashboard/integrations?tab=connectors`);
    await expect(page.getByRole("heading", { name: /^catalog$/i })).toBeVisible({
      timeout: 20_000,
    });

    const card = catalogCard(page);
    await expect(card).toBeVisible();

    // "Enable" before the first run, "Enabled" (disabled button) after it.
    const enableButton = card.getByRole("button", { name: /^enable$/i });
    if (await enableButton.isVisible()) {
      await enableButton.click();
      await expect(
        page.locator("[data-sonner-toast]").filter({ hasText: /enabled/i }),
      ).toBeVisible({ timeout: 15_000 });
    }

    await expect(enabledSection(page).getByText(CONNECTOR_NAME).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("a member sees the catalog and no Enable or Disable control", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, context, requireMember());
    await page.goto(`${BASE_URL}/dashboard/integrations?tab=connectors`);
    await expect(page.getByRole("heading", { name: /^catalog$/i })).toBeVisible({
      timeout: 20_000,
    });
    // The card renders, so the absence below is not vacuous.
    await expect(catalogCard(page)).toBeVisible();

    await expect(page.getByRole("button", { name: /^enable$|^enabled$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /disable/i })).toHaveCount(0);
  });

  test("the connector appears in the security-policy matrix with an execute switch", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, context, requireAdmin());
    await page.goto(`${BASE_URL}/dashboard/organization/security-policy`);
    await expect(page.getByText(/^security policy$/i).first()).toBeVisible({
      timeout: 20_000,
    });

    // The kind selector is the one combobox on the tenant-wide scope.
    await page.getByRole("combobox").last().click();
    await page.getByRole("option", { name: "Connectors" }).click();

    const row = page.getByRole("row").filter({ hasText: CONNECTOR_NAME });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("switch", { name: new RegExp(`execute for ${CONNECTOR_NAME}`, "i") }),
    ).toBeVisible();
  });
});
