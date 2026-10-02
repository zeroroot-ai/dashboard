// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * authz/non-admin.spec.ts
 *
 * The admin chrome is hidden from a Viewer, and a direct navigation to an
 * admin page is refused server-side.
 *
 * The original spec mocked /api/auth/my-memberships to look like a member.
 * That only moved the client-side gates; the server kept the real role, so
 * the server-side assertions could never hold. This spec signs in as a real
 * Viewer of the e2e tenant and asserts both halves against FGA.
 *
 * Credentials: E2E_MEMBER_EMAIL, E2E_MEMBER_PASSWORD, E2E_MEMBER_TOTP_SECRET.
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, requireMember, signIn } from "../auth/helpers/accounts";

const SETTINGS_URL = `${BASE_URL}/dashboard/pages/settings`;
const SECRETS_URL = `${SETTINGS_URL}/secrets`;
const SECRETS_NEW_URL = `${SETTINGS_URL}/secrets/new`;
const GRANTS_URL = `${SETTINGS_URL}/grants`;

async function refusedOrRedirected(
  page: import("@playwright/test").Page,
  url: string,
  stillThere: RegExp,
): Promise<void> {
  const statuses: number[] = [];
  page.on("response", (resp) => {
    if (resp.url().startsWith(url)) statuses.push(resp.status());
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });

  const finalUrl = page.url();
  const wasRedirected = !stillThere.test(finalUrl);
  const has4xx = statuses.includes(403) || statuses.includes(401);
  const bodyText = ((await page.textContent("body").catch(() => "")) ?? "").toLowerCase();
  const hasDenialCopy =
    bodyText.includes("permission") ||
    bodyText.includes("forbidden") ||
    bodyText.includes("not authorized") ||
    bodyText.includes("access denied");

  expect(
    wasRedirected || has4xx || hasDenialCopy,
    `expected ${url} to redirect or refuse a Viewer. finalUrl=${finalUrl}, statuses=${statuses.join(",")}`,
  ).toBe(true);
}

test.describe("Authz gating, Viewer visibility", () => {
  test.beforeEach(async ({ page, context }) => {
    test.setTimeout(120_000);
    await signIn(page, context, requireMember());
  });

  for (const title of ["Secrets", "Secret Broker", "Permissions"] as const) {
    test(`the settings nav does not show the ${title} entry`, async ({ page }) => {
      await page.goto(SETTINGS_URL);
      // The ungated Profile entry proves the nav rendered, so the absence is not vacuous.
      await expect(
        page.locator("nav").getByRole("link", { name: /^profile$/i }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.locator("nav").getByRole("link", { name: new RegExp(`^${title}$`, "i") }),
      ).toHaveCount(0);
    });
  }

  test("the Add secret link is not in the DOM on the secrets page", async ({ page }) => {
    await page.goto(SECRETS_URL);
    await page.waitForLoadState("networkidle", { timeout: 20_000 });
    await expect(page.getByRole("link", { name: /add secret/i })).toHaveCount(0);
  });

  test("a direct navigation to secrets/new is refused", async ({ page }) => {
    await refusedOrRedirected(page, SECRETS_NEW_URL, /\/secrets\/new/);
  });

  test("a direct navigation to the Permissions page is refused", async ({ page }) => {
    await refusedOrRedirected(page, GRANTS_URL, /\/settings\/grants/);
  });

  for (const [type, path] of [
    ["agent", "/dashboard/agents"],
    ["plugin", "/dashboard/plugins"],
    ["tool", "/dashboard/tools"],
  ] as const) {
    test(`the Deploy ${type} CTA renders disabled with a tooltip for a Viewer`, async ({
      page,
    }) => {
      await page.goto(`${BASE_URL}${path}`);
      // The denied wrapper keeps the affordance in the DOM (dashboard#145)
      // and renders the label as text, with no link to /dashboard/deploy.
      const denied = page.getByTestId("auth-gated-button-denied");
      await expect(denied.first()).toBeVisible({ timeout: 20_000 });
      await expect(denied.first()).toContainText(new RegExp(`deploy ${type}`, "i"));
      await expect(
        page.getByRole("link", { name: new RegExp(`deploy ${type}`, "i") }),
      ).toHaveCount(0);
    });
  }
});
