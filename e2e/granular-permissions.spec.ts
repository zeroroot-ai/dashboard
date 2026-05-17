/**
 * granular-permissions.spec.ts
 *
 * End-to-end tests for the granular permissions admin flow.
 * Tests run against a live Kind cluster (gibson context) seeded with a fresh tenant.
 *
 * Requirements: 11.1–11.7
 *
 * Environment variables expected:
 *   PLAYWRIGHT_BASE_URL        - Dashboard URL (default: http://localhost:30081)
 *   E2E_ADMIN_EMAIL            - Admin user email (seeded in Zitadel)
 *   E2E_ADMIN_PASSWORD         - Admin user password
 *   E2E_MEMBER_EMAIL           - Member user email (seeded in Zitadel)
 *   E2E_MEMBER_PASSWORD        - Member user password
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:30081";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL ?? "member@example.com";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginAs(page: Page, email: string, password: string) {
  // Dashboard uses Auth.js v5 Server Actions — sign-in is an email+password
  // form at /login that posts to the signInAction (see app/actions/auth/signin.ts).
  // NOTE: field selectors below match the current form markup; update them if
  // the login UI changes.
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(new RegExp(`${BASE_URL}/(dashboard|login/tenant-picker)`));
}

async function waitForToast(page: Page, text: RegExp | string) {
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: text });
  await expect(toast).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Test suite — Requirement 11
// ---------------------------------------------------------------------------

test.describe("Granular Permissions Admin Flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  // -------------------------------------------------------------------------
  // Requirement 11.1 — Admin can log in after fresh cluster setup
  // -------------------------------------------------------------------------
  test("admin dashboard loads after login", async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: /dashboard/i }).first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Requirement 11.2 — Create three teams
  // -------------------------------------------------------------------------
  test("admin can create teams", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/teams`);
    await expect(page.getByRole("heading", { name: /teams/i })).toBeVisible();

    for (const teamName of ["red", "blue", "appsec"]) {
      await page.getByRole("button", { name: /create team/i }).click();
      await page.getByLabel(/team name/i).fill(teamName);
      await page.getByRole("button", { name: /create/i }).click();
      await waitForToast(page, /team created/i);
      await expect(page.getByRole("cell", { name: teamName })).toBeVisible();
    }
  });

  // -------------------------------------------------------------------------
  // Requirement 11.2 — Teams appear in the list
  // -------------------------------------------------------------------------
  test("teams list shows all created teams", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/teams`);
    for (const name of ["red", "blue", "appsec"]) {
      await expect(page.getByRole("cell", { name })).toBeVisible();
    }
  });

  // -------------------------------------------------------------------------
  // Requirement 11.4 — Configure crosstalk "blue can view data from red"
  // -------------------------------------------------------------------------
  test("admin can configure team crosstalk", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/teams`);

    // Navigate to blue team detail
    await page.getByRole("link", { name: /blue/i }).first().click();
    await page.waitForURL(/\/teams\//);

    // Switch to Crosstalk tab
    await page.getByRole("tab", { name: /crosstalk/i }).click();
    await expect(page.getByRole("tab", { name: /crosstalk/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Grant crosstalk from blue to red
    await page.getByRole("button", { name: /grant crosstalk/i }).click();
    await page.getByRole("option", { name: /red/i }).click();
    await page.getByRole("button", { name: /grant/i }).last().click();
    await waitForToast(page, /crosstalk granted/i);

    // Verify it appears in the list
    await expect(page.getByText(/red/i)).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Requirement 11.5 — Revoke component grant via permissions matrix
  // -------------------------------------------------------------------------
  test("admin can revoke a component grant for a member", async ({ page }) => {
    // Navigate to users and find the member
    await page.goto(`${BASE_URL}/dashboard/organization/users`);
    const memberRow = page.getByRole("row").filter({ hasText: MEMBER_EMAIL });
    await memberRow.getByRole("link", { name: /permissions/i }).click();
    await page.waitForURL(/\/permissions/);

    // Find the nmap tool row and revoke can_execute
    const nmapRow = page.getByRole("row").filter({ hasText: /nmap/i });
    const execCheckbox = nmapRow
      .getByRole("checkbox", { name: /execute.*nmap|nmap.*execute/i })
      .first();

    // If it's checked, uncheck it (revoke)
    const isChecked = await execCheckbox.isChecked();
    if (isChecked) {
      await execCheckbox.click();
      await page.getByRole("button", { name: /save changes/i }).click();
      await waitForToast(page, /saved/i);
    }

    // Verify the checkbox is now unchecked
    await expect(execCheckbox).not.toBeChecked();
  });

  // -------------------------------------------------------------------------
  // Requirement 11.6 — Audit log shows permission events
  // -------------------------------------------------------------------------
  test("audit log shows recent permission events", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/audit`);
    await expect(page.getByRole("heading", { name: /audit log/i })).toBeVisible();

    // Wait for table to load
    const table = page.getByRole("table");
    await expect(table).toBeVisible();

    // At least one event should be present (from team creation above)
    const rows = table.getByRole("row").filter({ hasNotText: /time.*actor.*event/i });
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
  });

  // -------------------------------------------------------------------------
  // Requirement 11.7 (client-side) — Non-admin does not see admin buttons
  // -------------------------------------------------------------------------
  test("non-admin does not see Create Team or edit buttons", async ({
    browser,
  }) => {
    // Open a new context as member user
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();

    await loginAs(memberPage, MEMBER_EMAIL, ADMIN_PASSWORD);
    await memberPage.goto(`${BASE_URL}/dashboard/teams`);

    // Admin-only buttons should not be visible
    await expect(
      memberPage.getByRole("button", { name: /create team/i }),
    ).not.toBeVisible();

    // Audit log should show permission denied message
    await memberPage.goto(`${BASE_URL}/dashboard/audit`);
    await expect(
      memberPage.getByText(/you do not have permission/i),
    ).toBeVisible();

    await memberContext.close();
  });
});

// ---------------------------------------------------------------------------
// Accessibility checks — Requirement 11.9 (basic Playwright a11y sweep)
// ---------------------------------------------------------------------------

test.describe("Accessibility checks on new pages", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  const NEW_PAGES = [
    { name: "Teams list", path: "/dashboard/teams" },
    { name: "Permissions overview", path: "/dashboard/permissions" },
    { name: "Audit log", path: "/dashboard/audit" },
  ];

  for (const { name, path } of NEW_PAGES) {
    test(`${name} page has no obvious ARIA violations`, async ({ page }) => {
      await page.goto(`${BASE_URL}${path}`);
      // Wait for content to load
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });

      // Check that every interactive element within the main content area
      // has an accessible name (button, link, input, checkbox, select).
      // This is a basic heuristic — full Lighthouse audit via CI workflow.
      const interactives = await page
        .locator(
          "main button:not([aria-hidden='true']), main a:not([aria-hidden='true']), main input, main select",
        )
        .all();

      for (const el of interactives) {
        const ariaLabel = await el.getAttribute("aria-label");
        const ariaLabelledBy = await el.getAttribute("aria-labelledby");
        const textContent = await el.textContent();
        const hasTitle = await el.getAttribute("title");
        const hasValue = await el.getAttribute("value");

        const hasAccessibleName =
          !!ariaLabel ||
          !!ariaLabelledBy ||
          !!(textContent?.trim()) ||
          !!hasTitle ||
          !!hasValue;

        expect(
          hasAccessibleName,
          `Element should have accessible name: ${await el.evaluate((e) => e.outerHTML.slice(0, 120))}`,
        ).toBe(true);
      }
    });
  }

  test("Permissions matrix checkboxes have aria-labels", async ({ page }) => {
    // This requires a user with permissions page
    // Find any user and navigate to their permissions page
    await page.goto(`${BASE_URL}/dashboard/organization/users`);
    const firstPermLink = page.getByRole("link", { name: /permissions/i }).first();
    if (await firstPermLink.isVisible()) {
      await firstPermLink.click();
      await page.waitForURL(/\/permissions/);

      const checkboxes = await page.getByRole("checkbox").all();
      for (const cb of checkboxes.slice(0, 20)) {
        // Check first 20 to keep test fast
        const label = await cb.getAttribute("aria-label");
        expect(label).toBeTruthy();
      }
    }
  });

  test("Help panel opens and closes with keyboard", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/teams`);
    const helpBtn = page.getByRole("button", { name: /help/i });
    await expect(helpBtn).toBeVisible();

    // Open with Enter
    await helpBtn.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("Crosstalk graph has table fallback toggle", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/permissions`);
    await page.waitForLoadState("networkidle");

    // Find the "Table view" button in the Crosstalk card
    const tableViewBtn = page.getByRole("button", { name: /table view/i });
    if (await tableViewBtn.isVisible()) {
      await tableViewBtn.click();
      // After switching, table should be visible
      await expect(page.getByRole("table", { name: /team crosstalk/i })).toBeVisible();

      // Switch back
      await page.getByRole("button", { name: /graph view/i }).click();
      await expect(page.getByRole("table", { name: /team crosstalk/i })).not.toBeVisible();
    }
  });
});
