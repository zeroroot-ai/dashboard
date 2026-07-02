/**
 * extended-tools.spec.ts
 *
 * End-to-end smoke for /dashboard/tools, confirms the page renders the
 * shared AccessScopeSelector + RWXMatrix with Version/Endpoint metadata
 * preserved as row description content.
 *
 * Spec: access-matrix-finish task 29, R2 AC 4.
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";
const TOOLS_URL = `${BASE_URL}/dashboard/tools`;

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^log ?in$|^sign ?in$/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 20_000,
  });
}

async function mockListTools(page: Page) {
  await page.route("**/*listAccessibleComponents*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: [
          {
            kind: "tool",
            name: "nmap",
            displayName: "Nmap",
            description: "Network mapper, https://tools.internal/nmap",
            rwx: { read: true, write: true, execute: true },
            denyingGates: [],
            version: "7.94",
          },
        ],
      }),
    });
  });
}

test.describe("Tools page, matrix + metadata preservation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("renders scope selector + matrix", async ({ page }) => {
    await mockListTools(page);
    await page.goto(TOOLS_URL);
    await expect(page.getByRole("tab", { name: /Tenant-wide/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Nmap")).toBeVisible();
  });

  test("Version + Endpoint metadata remain visible", async ({ page }) => {
    await mockListTools(page);
    await page.goto(TOOLS_URL);
    // Version + endpoint are concatenated into the row description.
    await expect(page.getByText(/v7\.94/)).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(/https:\/\/tools\.internal\/nmap/),
    ).toBeVisible();
  });

  test("each action class toggle fires", async ({ page }) => {
    await mockListTools(page);
    await page.route("**/*setComponentAccess*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { applied: true } }),
      });
    });
    await page.goto(TOOLS_URL);
    for (const action of ["Read", "Write", "Execute"] as const) {
      const sw = page.getByRole("switch", {
        name: new RegExp(`${action} for Nmap`, "i"),
      });
      await sw.click();
    }
  });
});
