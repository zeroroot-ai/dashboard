/**
 * secrets/list.spec.ts
 *
 * End-to-end tests for the /dashboard/pages/settings/secrets list page.
 *
 * Tests three distinct empty/populated states:
 *   1. Tenant has no broker configured → "Configure secrets backend" CTA.
 *   2. Tenant has broker but zero secrets (onboarding) → onboarding empty state.
 *   3. Tenant has secrets → DataTable renders with expected columns.
 *
 * All daemon RPCs are intercepted via page.route() so these tests run without
 * a live backend. The test conventions mirror agents.spec.ts (mocked via
 * the gibson-proxy API route pattern).
 *
 * Requirements: 1.1, 1.6, NFR Security.
 *
 * Pre-conditions:
 *   PLAYWRIGHT_BASE_URL, target cluster URL (default: http://localhost:3000)
 *   E2E_ADMIN_EMAIL    , admin user email
 *   E2E_ADMIN_PASSWORD , admin user password
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";

const SECRETS_URL = `${BASE_URL}/dashboard/pages/settings/secrets`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^log ?in$|^sign ?in$/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 20_000,
  });
}

/**
 * Mock the broker-config RPC to return "no broker configured" for the tenant.
 * The secrets page uses GetBrokerConfig to determine which empty state to render.
 */
async function mockNoBroker(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();
    if (
      url.includes("GetBrokerConfig") ||
      url.includes("GetTenantBrokerConfig")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ provider: "", config: null, configured: false }),
      });
      return;
    }
    if (url.includes("ListSecrets")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ secrets: [], total: 0 }),
      });
      return;
    }
    await route.continue();
  });
}

/**
 * Mock broker configured but zero secrets (onboarding state, Gibson-hosted Vault).
 */
async function mockBrokerNoSecrets(page: Page, provider = "gibson_vault") {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();
    if (
      url.includes("GetBrokerConfig") ||
      url.includes("GetTenantBrokerConfig")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          provider,
          config: { provider },
          configured: true,
        }),
      });
      return;
    }
    if (url.includes("ListSecrets")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ secrets: [], total: 0 }),
      });
      return;
    }
    await route.continue();
  });
}

/**
 * Mock broker configured with a populated secrets list.
 */
async function mockBrokerWithSecrets(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();
    if (
      url.includes("GetBrokerConfig") ||
      url.includes("GetTenantBrokerConfig")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          provider: "gibson_vault",
          config: { provider: "gibson_vault" },
          configured: true,
        }),
      });
      return;
    }
    if (url.includes("ListSecrets")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          secrets: [
            {
              id: "secret-001",
              name: "anthropic_api_key",
              category: "provider_config",
              version: 3,
              createdAt: "2026-01-01T00:00:00Z",
              createdBy: "user-e2e-001",
              lastRotatedAt: "2026-04-01T00:00:00Z",
              lastAccessedAt: "2026-04-15T00:00:00Z",
            },
            {
              id: "secret-002",
              name: "db_password",
              category: "cred",
              version: 1,
              createdAt: "2026-02-01T00:00:00Z",
              createdBy: "user-e2e-001",
              lastRotatedAt: null,
              lastAccessedAt: "2026-04-10T00:00:00Z",
            },
          ],
          total: 2,
        }),
      });
      return;
    }
    await route.continue();
  });
}

// ---------------------------------------------------------------------------
// Test suite: no broker configured
// ---------------------------------------------------------------------------

test.describe("Secrets list, no broker configured", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("renders 'Configure secrets backend' empty state CTA", async ({
    page,
  }) => {
    await mockNoBroker(page);
    await page.goto(SECRETS_URL);

    // R1.6, no-broker empty state must link to secrets-backend page
    await expect(
      page.getByText(/configure.*secret.*backend|set up.*broker|no broker/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("CTA links to /secrets-backend page", async ({ page }) => {
    await mockNoBroker(page);
    await page.goto(SECRETS_URL);

    // Find the CTA link and confirm it points to the backend page
    const ctaLink = page
      .getByRole("link", { name: /configure|set up|secrets.?backend/i })
      .first();
    await expect(ctaLink).toBeVisible({ timeout: 15_000 });

    const href = await ctaLink.getAttribute("href");
    expect(href).toMatch(/secrets-backend/);
  });

  test("no DataTable rendered in no-broker state", async ({ page }) => {
    await mockNoBroker(page);
    await page.goto(SECRETS_URL);

    // Wait for empty state to appear
    await expect(
      page.getByText(/configure|no broker/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // No table should be visible
    await expect(page.getByRole("table")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test suite: broker configured, zero secrets (onboarding)
// ---------------------------------------------------------------------------

test.describe("Secrets list, broker configured, zero secrets (onboarding)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("renders onboarding empty state with 'Add your first secret' CTA", async ({
    page,
  }) => {
    await mockBrokerNoSecrets(page);
    await page.goto(SECRETS_URL);

    // R1.6, onboarding empty state
    await expect(
      page.getByText(/add your first secret/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("onboarding state for Gibson-hosted Vault confirms backend is ready", async ({
    page,
  }) => {
    await mockBrokerNoSecrets(page, "gibson_vault");
    await page.goto(SECRETS_URL);

    // R7.2, onboarding state copy confirms Gibson-hosted Vault is ready
    await expect(
      page.getByText(/secrets backend is ready|gibson.?hosted vault/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("'Or skip and register a plugin' link is present", async ({ page }) => {
    await mockBrokerNoSecrets(page);
    await page.goto(SECRETS_URL);

    await expect(
      page.getByText(/skip.*register.*plugin|register.*plugin/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("no DataTable rendered in onboarding state", async ({ page }) => {
    await mockBrokerNoSecrets(page);
    await page.goto(SECRETS_URL);

    // Wait for empty state
    await expect(
      page.getByText(/add your first secret/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole("table")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test suite: broker configured, secrets present, DataTable
// ---------------------------------------------------------------------------

test.describe("Secrets list, populated", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("DataTable renders with expected columns", async ({ page }) => {
    await mockBrokerWithSecrets(page);
    await page.goto(SECRETS_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    // Column headers per R1.1
    await expect(
      page.getByRole("columnheader", { name: /name/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: /category/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: /version/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: /last.?rotat/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: /last.?access/i }),
    ).toBeVisible();
  });

  test("secret rows render name and category", async ({ page }) => {
    await mockBrokerWithSecrets(page);
    await page.goto(SECRETS_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    // Row data from the mock
    await expect(page.getByText("anthropic_api_key")).toBeVisible();
    await expect(page.getByText("db_password")).toBeVisible();
    await expect(page.getByText("provider_config")).toBeVisible();
    await expect(page.getByText("cred")).toBeVisible();
  });

  test("NO value column exists (NFR Security, write-only)", async ({
    page,
  }) => {
    await mockBrokerWithSecrets(page);
    await page.goto(SECRETS_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    // The "value" column must never appear
    const valueHeader = page.getByRole("columnheader", {
      name: /^value$|^secret value$|^reveal/i,
    });
    await expect(valueHeader).not.toBeVisible();
  });

  test("'Add secret' button is present", async ({ page }) => {
    await mockBrokerWithSecrets(page);
    await page.goto(SECRETS_URL);

    await expect(
      page.getByRole("button", { name: /add secret/i }).or(
        page.getByRole("link", { name: /add secret/i }),
      ).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("row action links to detail page", async ({ page }) => {
    await mockBrokerWithSecrets(page);
    await page.goto(SECRETS_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    // Per-row action should be visible, can be a link, button, or menu trigger
    const rowAction = page
      .getByRole("row")
      .filter({ hasText: "anthropic_api_key" })
      .getByRole("link")
      .or(
        page
          .getByRole("row")
          .filter({ hasText: "anthropic_api_key" })
          .getByRole("button"),
      )
      .first();

    await expect(rowAction).toBeVisible({ timeout: 10_000 });
  });

  test("page header is visible", async ({ page }) => {
    await mockBrokerWithSecrets(page);
    await page.goto(SECRETS_URL);

    await expect(
      page.getByText(/secrets/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// RBAC: non-admin sees permission gate
// ---------------------------------------------------------------------------

test.describe("Secrets list, non-admin access denied", () => {
  test("non-admin sees permission-required alert", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL ?? "member@example.com";
    const MEMBER_PASSWORD = process.env.E2E_MEMBER_PASSWORD ?? "password";

    try {
      await loginAs(page, MEMBER_EMAIL, MEMBER_PASSWORD);
      await page.goto(SECRETS_URL);

      // PermissionGate renders a destructive Alert for non-admins
      await expect(
        page
          .locator('[role="alert"]')
          .filter({ hasText: /admin permissions|not authorized|access denied/i }),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });
});
