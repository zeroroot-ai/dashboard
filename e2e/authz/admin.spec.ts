/**
 * authz/admin.spec.ts
 *
 * E2E happy-path suite: verifies all gated admin chrome IS visible for a
 * tenant_admin user.
 *
 * Spec: dashboard-authz-ui-gating, Task 19, Requirement 9.4.
 *
 * Counterpart to non-admin.spec.ts. No shared state between the two suites.
 *
 * Strategy:
 *   Mock /api/auth/my-memberships to return tenant_admin role so every call to
 *   useAuthorize resolves allowed=true for all admin RPCs. Also mock the
 *   gibson-proxy endpoints so pages render without a live daemon.
 *
 *   On a real Kind cluster the E2E_ADMIN_EMAIL user is by definition the
 *   tenant owner (created via signup) and therefore tenant_admin, the mock
 *   simply reinforces that and makes the suite deterministic without relying
 *   on cluster state drift.
 *
 * Pre-conditions (Kind cluster):
 *   make deploy-local running against `kind-gibson` context.
 *   PLAYWRIGHT_BASE_URL , cluster URL (default: http://localhost:3000)
 *   E2E_ADMIN_EMAIL     , admin user email
 *   E2E_ADMIN_PASSWORD  , corresponding password
 *
 * Wall-clock budget: ≤ 2 minutes.
 * Requirements: 9.4.
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";

const PLUGINS_URL = `${BASE_URL}/dashboard/plugins`;
const SECRETS_URL = `${BASE_URL}/dashboard/pages/settings/secrets`;
const SECRETS_BACKEND_URL = `${BASE_URL}/dashboard/pages/settings/secrets-backend`;
const GRANTS_URL = `${BASE_URL}/dashboard/pages/settings/grants`;
const SETTINGS_URL = `${BASE_URL}/dashboard/pages/settings`;

/** Synthetic tenant ID used in the mocked membership payload. */
const MOCK_TENANT_ID = "tenant-e2e-admin-001";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^log ?in$|^sign ?in$/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 30_000,
  });
}

/**
 * Intercept /api/auth/my-memberships and return a tenant_admin payload.
 *
 * This ensures useAuthorize resolves allowed=true for every admin RPC,
 * regardless of the real user's cluster-side membership state.
 */
async function mockAdminSession(page: Page) {
  await page.route("**/api/auth/my-memberships**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeTenantId: MOCK_TENANT_ID,
        byTenant: {
          [MOCK_TENANT_ID]: { role: "tenant_admin" },
        },
      }),
    });
  });
}

/** Standard gibson-proxy mock with minimal data so pages render. */
async function mockAdminBackend(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();

    if (url.includes("ListSecrets")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          secrets: [
            {
              id: "secret-admin-001",
              name: "anthropic_api_key",
              category: "provider_config",
              version: 1,
              createdAt: "2026-01-01T00:00:00Z",
              createdBy: "user-admin-e2e",
              lastRotatedAt: null,
              lastAccessedAt: null,
            },
          ],
          total: 1,
        }),
      });
      return;
    }
    if (url.includes("ListPluginInstalls") || url.includes("ListPlugins")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ plugins: [], total: 0 }),
      });
      return;
    }
    if (url.includes("GetBrokerConfig") || url.includes("GetTenantBrokerConfig")) {
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
    if (url.includes("ListActiveGrants") || url.includes("ListGrants")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          grants: [
            {
              jti: "jti-admin-e2e-001",
              recipientInstallId: "install-agent-admin",
              recipientClass: "agent",
              allowedRpcs: ["GetCredential"],
              issuedAt: String(Math.floor(Date.now() / 1000) - 60),
              expiresAt: String(Math.floor(Date.now() / 1000) + 3600),
            },
          ],
          total: 1,
        }),
      });
      return;
    }
    if (url.includes("GetSecret") || url.includes("secret-admin-001")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "secret-admin-001",
          name: "anthropic_api_key",
          category: "provider_config",
          version: 1,
        }),
      });
      return;
    }

    await route.continue();
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("Authz gating, admin happy-path (tenant_admin) visibility", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await mockAdminSession(page);
    await mockAdminBackend(page);
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  // -------------------------------------------------------------------------
  // Sidebar entries, all three admin entries must be present
  // -------------------------------------------------------------------------

  test("settings sidebar shows Secrets entry for tenant_admin", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    await page.goto(SETTINGS_URL);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    const secretsNavEntry = page.locator("nav").getByRole("link", {
      name: /^secrets$/i,
    });

    await expect(secretsNavEntry).toBeVisible({ timeout: 10_000 });
  });

  test("settings sidebar shows Secrets backend entry for tenant_admin", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    await page.goto(SETTINGS_URL);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    const backendNavEntry = page.locator("nav").getByRole("link", {
      name: /secrets.?backend|backend/i,
    });

    await expect(backendNavEntry).toBeVisible({ timeout: 10_000 });
  });

  test("settings sidebar shows Grants entry for tenant_admin", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    await page.goto(SETTINGS_URL);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    const grantsNavEntry = page.locator("nav").getByRole("link", {
      name: /^grants$/i,
    });

    await expect(grantsNavEntry).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Plugins page, Add Plugin button
  // -------------------------------------------------------------------------

  test("Add Plugin button is present on /plugins for tenant_admin", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    await page.goto(PLUGINS_URL);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    await expect(
      page
        .getByRole("button", { name: /add.*plugin|register.*plugin|new.*plugin/i })
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Secrets list, Add Secret button
  // -------------------------------------------------------------------------

  test("Add Secret button is present on /secrets for tenant_admin", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    await page.goto(SECRETS_URL);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    await expect(
      page
        .getByRole("button", { name: /add secret/i })
        .or(page.getByRole("link", { name: /add secret/i }))
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Secrets backend, Probe and Save buttons
  // -------------------------------------------------------------------------

  test("Probe button is present on /secrets-backend for tenant_admin", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    await page.goto(SECRETS_BACKEND_URL);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    await expect(
      page
        .getByRole("button", { name: /probe|test.?connection|verify/i })
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Save button is present on /secrets-backend for tenant_admin", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    await page.goto(SECRETS_BACKEND_URL);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    await expect(
      page
        .getByRole("button", { name: /save|update|apply/i })
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Grants page, table renders
  // -------------------------------------------------------------------------

  test("/grants page renders the grants table for tenant_admin", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    await page.goto(GRANTS_URL);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    // Page must render a table (not a 403 page)
    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    // The mock grant row should be visible
    await expect(
      page.getByText("jti-admin-e2e-001", { exact: false }),
    ).toBeVisible({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Secrets detail, Rotate and Delete buttons (navigate to a secret detail page)
  // -------------------------------------------------------------------------

  test("Rotate and Delete buttons are present on secret detail page for tenant_admin", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    // Navigate to the detail page for secret-admin-001
    await page.goto(`${SECRETS_URL}/secret-admin-001`);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    // Rotate button
    await expect(
      page
        .getByRole("button", { name: /rotate/i })
        .first(),
    ).toBeVisible({ timeout: 10_000 });

    // Delete button
    await expect(
      page
        .getByRole("button", { name: /delete/i })
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // -------------------------------------------------------------------------
  // Deploy launcher, visible AND enabled for admins. Regression guard for
  // dashboard#145: the DeployLauncher now renders via AuthGatedButton so
  // admins must see an interactive CTA (not a disabled or skeleton variant).
  // -------------------------------------------------------------------------

  for (const [type, listUrl] of [
    ["agent", `${BASE_URL}/dashboard/agents`],
    ["plugin", PLUGINS_URL],
    ["tool", `${BASE_URL}/dashboard/tools`],
  ] as const) {
    test(`Deploy ${type} CTA is visible and enabled for tenant_admin`, async ({
      page,
    }) => {
      test.setTimeout(30_000);
      await page.goto(listUrl);
      await page.waitForLoadState("networkidle", { timeout: 15_000 });

      const cta = page
        .getByRole("link", { name: new RegExp(`deploy ${type}`, "i") })
        .or(page.getByRole("button", { name: new RegExp(`deploy ${type}`, "i") }));
      await expect(cta.first()).toBeVisible({ timeout: 10_000 });
      // The denied variant marks the wrapper aria-disabled; for admins
      // there must be no such wrapper around the CTA.
      const deniedWrapper = page.getByTestId("auth-gated-button-denied");
      await expect(deniedWrapper).toHaveCount(0, { timeout: 3_000 });
    });
  }
});
