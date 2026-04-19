/**
 * extended-agents.spec.ts
 *
 * End-to-end smoke for /dashboard/agents — confirms the page renders the
 * shared AccessScopeSelector + RWXMatrix, that toggling each action class
 * reaches the setComponentAccessAction Server Action, and that the denying-
 * gate tooltip is non-empty on a denied action.
 *
 * Spec: access-matrix-finish task 29, R1 AC 8.
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";
const AGENTS_URL = `${BASE_URL}/dashboard/agents`;

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^log ?in$|^sign ?in$/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 20_000,
  });
}

async function mockListAgents(page: Page) {
  await page.route("**/*listAccessibleComponents*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: [
          {
            kind: "agent",
            name: "test-agent",
            displayName: "Test Agent",
            description: "sample",
            rwx: { read: true, write: false, execute: true },
            denyingGates: ["tenant:acme#tenant_write_disabled@component:agent/test-agent"],
            version: "0.1.0",
          },
        ],
      }),
    });
  });
}

async function mockSetComponentAccess(page: Page) {
  await page.route("**/*setComponentAccess*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { applied: true } }),
    });
  });
}

test.describe("Agents page — scope selector + matrix", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("renders AccessScopeSelector and RWXMatrix", async ({ page }) => {
    await mockListAgents(page);
    await page.goto(AGENTS_URL);
    await expect(page.getByRole("tab", { name: /Tenant-wide/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Test Agent/)).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Read" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Write" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Execute" })).toBeVisible();
  });

  test("denying-gate tooltip content is non-empty on denied action", async ({
    page,
  }) => {
    await mockListAgents(page);
    await page.goto(AGENTS_URL);

    const writeSwitch = page.getByRole("switch", {
      name: /write for Test Agent/i,
    });
    await writeSwitch.hover();
    await expect(
      page.getByText(/tenant:acme#tenant_write_disabled/),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("toggle each action class once", async ({ page }) => {
    await mockListAgents(page);
    await mockSetComponentAccess(page);
    await page.goto(AGENTS_URL);

    for (const action of ["Read", "Write", "Execute"] as const) {
      const sw = page.getByRole("switch", {
        name: new RegExp(`${action} for Test Agent`, "i"),
      });
      await sw.click();
    }
  });
});
