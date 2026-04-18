/**
 * permissions.spec.ts
 *
 * End-to-end tests for the settings/permissions page (permissions matrix)
 * and related UI behaviours.
 *
 * Requirements: 15 (agent-auth-fga-integration spec)
 *
 * Environment variables:
 *   PLAYWRIGHT_BASE_URL   - Dashboard URL (default: http://localhost:3000)
 *   E2E_ADMIN_EMAIL       - Admin user email
 *   E2E_ADMIN_PASSWORD    - Admin user password
 *   E2E_MEMBER_EMAIL      - Non-admin member email
 *   E2E_MEMBER_PASSWORD   - Non-admin member password
 *
 * Test strategy:
 *   The daemon may not be running during CI.  Tests that touch RPC calls
 *   (save, data fetch) use page.route() to intercept Connect-RPC / gRPC-web
 *   requests and return minimal valid JSON responses so that the UI renders
 *   without a live backend.  Tests that only check static page structure
 *   (headings, labels, access-denied copy) need no mocking.
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL ?? "member@example.com";
const MEMBER_PASSWORD = process.env.E2E_MEMBER_PASSWORD ?? "password";

const PERMISSIONS_URL = `${BASE_URL}/dashboard/pages/settings/permissions`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Log in via the Better Auth email/password form at /login.
 * Waits for a redirect away from the login page before resolving.
 */
async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^log ?in$|^sign ?in$/i }).click();
  // Wait until we leave the login page (redirect to /dashboard/default or
  // wherever the app sends the user after auth).
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 20_000,
  });
}

/**
 * Mock the ListComponentGrants and ListTenantMembers RPC responses so that
 * the permissions matrix renders with at least one row and one user column,
 * without needing a real daemon.
 *
 * Both RPCs are called via the /api/gibson-proxy Next.js route which forwards
 * to the daemon over gRPC-Web.  We intercept at the fetch level.
 */
async function mockPermissionsRPCs(page: Page) {
  // ListTenantMembers → return one member
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();

    if (url.includes("ListTenantMembers")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          members: [
            {
              subject: "user-e2e-001",
              email: ADMIN_EMAIL,
              name: "E2E Admin",
              roles: ["admin"],
            },
          ],
          total: 1,
        }),
      });
      return;
    }

    if (url.includes("ListComponentGrants")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          grants: [
            {
              componentRef: "component:nmap",
              userId: "user-e2e-001",
              canExecute: true,
              canConfigure: false,
              canRead: true,
              grantSource: "direct",
            },
            {
              componentRef: "component:httpx",
              userId: "user-e2e-001",
              canExecute: false,
              canConfigure: false,
              canRead: false,
              grantSource: "direct",
            },
          ],
          total: 2,
        }),
      });
      return;
    }

    // Pass all other requests through
    await route.continue();
  });
}

// ---------------------------------------------------------------------------
// Admin suite
// ---------------------------------------------------------------------------

test.describe("Permissions Settings — admin view", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("page heading is visible after navigation", async ({ page }) => {
    await page.goto(PERMISSIONS_URL);
    // The h2 "Permissions Matrix" heading should be visible regardless of
    // whether the daemon is up (it is rendered before any RPC resolves).
    await expect(
      page.getByRole("heading", { name: /permissions matrix/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("renders matrix table when grants are mocked", async ({ page }) => {
    await mockPermissionsRPCs(page);
    await page.goto(PERMISSIONS_URL);

    // Wait for the loading skeleton to disappear
    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    // At least one component row should be present (header + at least one data row)
    const rows = page.getByRole("row");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(2);
  });

  test("component column header is present in the matrix", async ({ page }) => {
    await mockPermissionsRPCs(page);
    await page.goto(PERMISSIONS_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });
    // "Component" is the sticky first column header
    await expect(
      page.getByRole("columnheader", { name: /component/i }),
    ).toBeVisible();
  });

  test("filter components input is present", async ({ page }) => {
    await mockPermissionsRPCs(page);
    await page.goto(PERMISSIONS_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });
    const filterInput = page.getByRole("textbox", {
      name: /filter components/i,
    });
    await expect(filterInput).toBeVisible();
  });

  test("filter users input is present", async ({ page }) => {
    await mockPermissionsRPCs(page);
    await page.goto(PERMISSIONS_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });
    const filterInput = page.getByRole("textbox", { name: /filter users/i });
    await expect(filterInput).toBeVisible();
  });

  test("save button is disabled when there are no pending changes", async ({
    page,
  }) => {
    await mockPermissionsRPCs(page);
    await page.goto(PERMISSIONS_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });
    const saveBtn = page.getByRole("button", {
      name: /save permission changes/i,
    });
    await expect(saveBtn).toBeDisabled();
  });

  test("toggling a checkbox enables the save button (optimistic)", async ({
    page,
  }) => {
    await mockPermissionsRPCs(page);
    await page.goto(PERMISSIONS_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    // Find any interactive (non-disabled) checkbox in the matrix
    const interactiveCheckboxes = page
      .getByRole("checkbox")
      .filter({ hasNot: page.locator("[disabled]") });

    const count = await interactiveCheckboxes.count();
    if (count === 0) {
      test.skip(true, "No interactive checkboxes found in mocked data");
      return;
    }

    await interactiveCheckboxes.first().click();

    // Save button should now be enabled
    const saveBtn = page.getByRole("button", {
      name: /save permission changes/i,
    });
    await expect(saveBtn).toBeEnabled();

    // A "unsaved changes" badge should appear
    await expect(page.getByText(/unsaved change/i)).toBeVisible();
  });

  test("discard button clears pending changes", async ({ page }) => {
    await mockPermissionsRPCs(page);
    await page.goto(PERMISSIONS_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    const interactiveCheckboxes = page
      .getByRole("checkbox")
      .filter({ hasNot: page.locator("[disabled]") });

    const count = await interactiveCheckboxes.count();
    if (count === 0) {
      test.skip(true, "No interactive checkboxes found in mocked data");
      return;
    }

    await interactiveCheckboxes.first().click();

    // Discard button appears after a pending change
    const discardBtn = page.getByRole("button", {
      name: /discard unsaved changes/i,
    });
    await expect(discardBtn).toBeVisible();
    await discardBtn.click();

    // After discarding, the save button goes back to disabled
    await expect(
      page.getByRole("button", { name: /save permission changes/i }),
    ).toBeDisabled();

    // The unsaved-changes badge disappears
    await expect(page.getByText(/unsaved change/i)).not.toBeVisible();
  });

  test("disabled (inherited) checkboxes are present when grant source is not direct", async ({
    page,
  }) => {
    // Override the mock to include an inherited grant
    await page.route("**/api/gibson-proxy**", async (route) => {
      const url = route.request().url();
      if (url.includes("ListTenantMembers")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            members: [
              {
                subject: "user-e2e-002",
                email: ADMIN_EMAIL,
                name: "E2E Admin",
                roles: ["admin"],
              },
            ],
            total: 1,
          }),
        });
        return;
      }
      if (url.includes("ListComponentGrants")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            grants: [
              {
                componentRef: "component:subfinder",
                userId: "user-e2e-002",
                canExecute: true,
                canConfigure: false,
                canRead: true,
                // Non-"direct" source means inherited
                grantSource: "team:red",
              },
            ],
            total: 1,
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(PERMISSIONS_URL);
    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    // Inherited grants render as disabled checkboxes
    const disabledCheckboxes = page.locator(
      '[role="checkbox"][disabled], [role="checkbox"][aria-disabled="true"]',
    );
    await expect(disabledCheckboxes.first()).toBeVisible({ timeout: 10_000 });
  });

  test("component filter hides non-matching rows", async ({ page }) => {
    await mockPermissionsRPCs(page);
    await page.goto(PERMISSIONS_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    const filterInput = page.getByRole("textbox", {
      name: /filter components/i,
    });
    // Type a string that matches only "nmap" from the mocked data
    await filterInput.fill("nmap");

    // httpx row should be hidden
    await expect(page.getByRole("cell", { name: /httpx/i })).not.toBeVisible();
    // nmap row should still be present
    await expect(
      page.getByText("nmap", { exact: false }).first(),
    ).toBeVisible();
  });

  test("empty state shown when no component grants exist", async ({ page }) => {
    // Return empty grants list
    await page.route("**/api/gibson-proxy**", async (route) => {
      const url = route.request().url();
      if (url.includes("ListTenantMembers")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ members: [], total: 0 }),
        });
        return;
      }
      if (url.includes("ListComponentGrants")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ grants: [], total: 0 }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(PERMISSIONS_URL);

    // The empty-state paragraph is rendered instead of a table
    await expect(
      page.getByText(/no component grants found/i),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("error alert is shown when the RPC fails", async ({ page }) => {
    await page.route("**/api/gibson-proxy**", async (route) => {
      await route.fulfill({ status: 503, body: "service unavailable" });
    });

    await page.goto(PERMISSIONS_URL);

    // The ErrorAlert component should render
    await expect(
      page.getByText(/failed to load permissions/i),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("clicking a component row button opens the detail panel", async ({
    page,
  }) => {
    await mockPermissionsRPCs(page);
    await page.goto(PERMISSIONS_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    // Each component row has a button with aria-label "View details for <name>"
    const detailBtn = page
      .getByRole("button", { name: /view details for/i })
      .first();
    await expect(detailBtn).toBeVisible();
    await detailBtn.click();

    // The ComponentDetailPanel is a Sheet — it should appear
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Non-admin (member) suite
// ---------------------------------------------------------------------------

test.describe("Permissions Settings — non-admin access denied", () => {
  test("non-admin user sees the access-restricted message", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      await loginAs(page, MEMBER_EMAIL, MEMBER_PASSWORD);
      await page.goto(PERMISSIONS_URL);

      // The page renders a "Access restricted" heading for non-admins
      await expect(
        page.getByRole("heading", { name: /access restricted/i }),
      ).toBeVisible({ timeout: 15_000 });

      // Descriptive copy is also visible
      await expect(
        page.getByText(/only tenant admins can view/i),
      ).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Accessibility — basic ARIA sanity on the permissions page
// ---------------------------------------------------------------------------

test.describe("Permissions Settings — accessibility checks", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("all matrix checkboxes have aria-labels when grants are present", async ({
    page,
  }) => {
    await mockPermissionsRPCs(page);
    await page.goto(PERMISSIONS_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    const checkboxes = await page.getByRole("checkbox").all();
    for (const cb of checkboxes) {
      const label = await cb.getAttribute("aria-label");
      expect(label, "Every checkbox in the matrix must have an aria-label").toBeTruthy();
    }
  });

  test("filter inputs have accessible labels", async ({ page }) => {
    await mockPermissionsRPCs(page);
    await page.goto(PERMISSIONS_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    const componentFilter = page.getByRole("textbox", {
      name: /filter components/i,
    });
    const userFilter = page.getByRole("textbox", { name: /filter users/i });

    await expect(componentFilter).toBeVisible();
    await expect(userFilter).toBeVisible();
  });
});
