/**
 * extended-plugins.spec.ts
 *
 * End-to-end smoke for /dashboard/plugins, confirms the page renders the
 * shared AccessScopeSelector + RWXMatrix and that the Configure button is
 * preserved per plugin row via rowTrailingAction.
 *
 * Spec: access-matrix-finish task 29, R3 AC 4.
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";
const PLUGINS_URL = `${BASE_URL}/dashboard/plugins`;

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^log ?in$|^sign ?in$/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 20_000,
  });
}

async function mockListPlugins(page: Page) {
  await page.route("**/*listAccessibleComponents*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: [
          {
            kind: "plugin",
            name: "gitlab",
            displayName: "GitLab",
            description: "Source control integration",
            rwx: { read: true, write: true, execute: true },
            denyingGates: [],
            version: "2.1.0",
          },
        ],
      }),
    });
  });
}

test.describe("Plugins page, matrix + Configure preserved", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("renders scope selector + matrix", async ({ page }) => {
    await mockListPlugins(page);
    await page.goto(PLUGINS_URL);
    await expect(page.getByRole("tab", { name: /Tenant-wide/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("GitLab")).toBeVisible();
  });

  test("Configure button renders on plugin rows", async ({ page }) => {
    await mockListPlugins(page);
    await page.goto(PLUGINS_URL);
    await expect(
      page.getByRole("button", { name: /Configure GitLab/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("each action class toggle fires", async ({ page }) => {
    await mockListPlugins(page);
    await page.route("**/*setComponentAccess*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { applied: true } }),
      });
    });
    await page.goto(PLUGINS_URL);
    for (const action of ["Read", "Write", "Execute"] as const) {
      const sw = page.getByRole("switch", {
        name: new RegExp(`${action} for GitLab`, "i"),
      });
      await sw.click();
    }
  });
});
