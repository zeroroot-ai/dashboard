/**
 * agents.spec.ts
 *
 * End-to-end tests for:
 *   /dashboard/pages/settings/agents  — Agent Auth management page
 *   /dashboard/pages/settings/audit   — Audit log page
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
 *   The daemon RPC endpoints are mocked via page.route() so that the UI
 *   renders predictably without a live backend.  Tests verify structure,
 *   interactive behaviour (dialog open/close, TTL options), and error
 *   handling — not the correctness of gRPC wire encoding.
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

const AGENTS_URL = `${BASE_URL}/dashboard/pages/settings/agents`;
const AUDIT_URL = `${BASE_URL}/dashboard/pages/settings/audit`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Log in via the Better Auth email/password form.
 */
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
 * Mock the ListCapabilityGrantAgents RPC so the agents page renders with zero agents
 * (empty state) without a real daemon.
 */
async function mockEmptyAgentList(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();
    if (url.includes("ListCapabilityGrant") || url.includes("CapabilityGrant")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ agents: [], total: 0 }),
      });
      return;
    }
    await route.continue();
  });
}

/**
 * Mock the ListCapabilityGrantAgents RPC so the agents page renders with two sample
 * registered agents.
 */
async function mockAgentList(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();
    if (url.includes("ListCapabilityGrant") || url.includes("CapabilityGrant")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          agents: [
            {
              agentId: "agent-abc123def456",
              mode: "autonomous",
              status: "active",
              ownerUserId: "user-e2e-001",
              capabilities: ["nmap", "httpx"],
              lastActiveAt: "1700000000",
            },
            {
              agentId: "agent-xyz789ghi012",
              mode: "delegated",
              status: "pending",
              ownerUserId: "user-e2e-001",
              capabilities: [],
              lastActiveAt: "0",
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

/**
 * Mock the ListAuditLog RPC so the audit page renders without a real daemon.
 */
async function mockAuditLog(page: Page, entries: object[] = []) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();
    if (url.includes("ListAuditLog") || url.includes("AuditLog")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entries,
          total: entries.length,
        }),
      });
      return;
    }
    await route.continue();
  });
}

// ---------------------------------------------------------------------------
// Agents page — admin suite
// ---------------------------------------------------------------------------

test.describe("Agents Settings — admin view", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("page renders Agent Auth section heading", async ({ page }) => {
    await mockEmptyAgentList(page);
    await page.goto(AGENTS_URL);

    // The AgentsContent component renders an "Agent Auth" heading
    await expect(
      page.getByText(/agent auth/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("page renders 'Registered agents' card", async ({ page }) => {
    await mockEmptyAgentList(page);
    await page.goto(AGENTS_URL);

    await expect(
      page.getByText(/registered agents/i),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("page renders 'Host registration tokens' card", async ({ page }) => {
    await mockEmptyAgentList(page);
    await page.goto(AGENTS_URL);

    await expect(
      page.getByText(/host registration tokens/i),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("shows empty state message when no agents are registered", async ({
    page,
  }) => {
    await mockEmptyAgentList(page);
    await page.goto(AGENTS_URL);

    // The AgentList component renders this text when agents = []
    await expect(
      page.getByText(/no agents registered/i),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("shows agent rows when agents are present", async ({ page }) => {
    await mockAgentList(page);
    await page.goto(AGENTS_URL);

    // The mocked list has 2 agents — at least one row with a truncated agent ID
    await expect(
      page.getByText(/agent-abc123def456/i, { exact: false }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("agent rows show mode and status badges", async ({ page }) => {
    await mockAgentList(page);
    await page.goto(AGENTS_URL);

    // Mode badge for the first mocked agent
    await expect(page.getByText("autonomous")).toBeVisible({ timeout: 15_000 });
    // Status badge
    await expect(page.getByText("active")).toBeVisible({ timeout: 15_000 });
    // Second agent
    await expect(page.getByText("delegated")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("pending")).toBeVisible({ timeout: 15_000 });
  });

  // -------------------------------------------------------------------------
  // Create registration token dialog
  // -------------------------------------------------------------------------

  test("'Create registration token' button is visible", async ({ page }) => {
    await mockEmptyAgentList(page);
    await page.goto(AGENTS_URL);

    await expect(
      page.getByRole("button", { name: /create registration token/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("clicking the button opens the token creation dialog", async ({
    page,
  }) => {
    await mockEmptyAgentList(page);
    await page.goto(AGENTS_URL);

    await page
      .getByRole("button", { name: /create registration token/i })
      .click();

    // Dialog should appear
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // The dialog title should mention "Create host registration token"
    await expect(
      dialog.getByText(/create host registration token/i),
    ).toBeVisible();
  });

  test("dialog contains a token name input", async ({ page }) => {
    await mockEmptyAgentList(page);
    await page.goto(AGENTS_URL);

    await page
      .getByRole("button", { name: /create registration token/i })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await expect(dialog.getByLabel(/token name/i)).toBeVisible();
  });

  test("dialog contains an expiry (TTL) select", async ({ page }) => {
    await mockEmptyAgentList(page);
    await page.goto(AGENTS_URL);

    await page
      .getByRole("button", { name: /create registration token/i })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // The select trigger is labelled "Expiry"
    await expect(dialog.getByLabel(/expiry/i)).toBeVisible();
  });

  test("TTL select contains 1 hour, 24 hours, and 7 days options", async ({
    page,
  }) => {
    await mockEmptyAgentList(page);
    await page.goto(AGENTS_URL);

    await page
      .getByRole("button", { name: /create registration token/i })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Open the select
    await dialog.getByLabel(/expiry/i).click();

    // Check the option list is present with all three values
    await expect(page.getByRole("option", { name: /1 hour/i })).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByRole("option", { name: /24 hours/i }),
    ).toBeVisible();
    await expect(page.getByRole("option", { name: /7 days/i })).toBeVisible();
  });

  test("create button is disabled when token name is empty", async ({
    page,
  }) => {
    await mockEmptyAgentList(page);
    await page.goto(AGENTS_URL);

    await page
      .getByRole("button", { name: /create registration token/i })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Name field is empty by default → Create button should be disabled
    const createBtn = dialog.getByRole("button", { name: /^create$/i });
    await expect(createBtn).toBeDisabled();
  });

  test("create button becomes enabled when token name is filled", async ({
    page,
  }) => {
    await mockEmptyAgentList(page);
    await page.goto(AGENTS_URL);

    await page
      .getByRole("button", { name: /create registration token/i })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.getByLabel(/token name/i).fill("prod-worker-01");

    await expect(
      dialog.getByRole("button", { name: /^create$/i }),
    ).toBeEnabled();
  });

  test("cancel button closes the dialog without submission", async ({
    page,
  }) => {
    await mockEmptyAgentList(page);
    await page.goto(AGENTS_URL);

    await page
      .getByRole("button", { name: /create registration token/i })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.getByRole("button", { name: /cancel/i }).click();

    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("dialog closes on Escape key", async ({ page }) => {
    await mockEmptyAgentList(page);
    await page.goto(AGENTS_URL);

    await page
      .getByRole("button", { name: /create registration token/i })
      .click();

    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("RPC error renders an error alert on the agents page", async ({
    page,
  }) => {
    await page.route("**/api/gibson-proxy**", async (route) => {
      await route.fulfill({ status: 503, body: "service unavailable" });
    });

    await page.goto(AGENTS_URL);

    // AgentsContent shows an Alert when listCapabilityGrantAgents rejects
    await expect(
      page.locator('[role="alert"]').first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Agents page — non-admin access denied
// ---------------------------------------------------------------------------

test.describe("Agents Settings — non-admin access denied", () => {
  test("non-admin sees permission-required alert", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      await loginAs(page, MEMBER_EMAIL, MEMBER_PASSWORD);
      await page.goto(AGENTS_URL);

      // PermissionGate renders a destructive Alert for non-admins
      await expect(
        page.locator('[role="alert"]').filter({
          hasText: /admin permissions/i,
        }),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Audit log page — admin suite
// ---------------------------------------------------------------------------

test.describe("Audit Log Settings — admin view", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("page renders 'Audit Log' heading", async ({ page }) => {
    await mockAuditLog(page);
    await page.goto(AUDIT_URL);

    await expect(
      page.getByText(/audit log/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("filter controls are present — Action, Actor, Target type", async ({
    page,
  }) => {
    await mockAuditLog(page);
    await page.goto(AUDIT_URL);

    // Wait for the filter card to render
    await expect(page.getByLabel(/filter by actor id/i)).toBeVisible({
      timeout: 15_000,
    });

    // Action select trigger
    const actionSelect = page.locator("#audit-action");
    await expect(actionSelect).toBeVisible();

    // Target type input
    await expect(page.getByLabel(/filter by target type/i)).toBeVisible();

    // Since and Until date inputs
    await expect(page.getByLabel(/filter from date/i)).toBeVisible();
    await expect(page.getByLabel(/filter until date/i)).toBeVisible();
  });

  test("audit table columns are present", async ({ page }) => {
    await mockAuditLog(page);
    await page.goto(AUDIT_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByRole("columnheader", { name: /timestamp/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: /actor/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: /action/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: /decision/i }),
    ).toBeVisible();
  });

  test("empty state message shown when no log entries exist", async ({
    page,
  }) => {
    await mockAuditLog(page, []);
    await page.goto(AUDIT_URL);

    await expect(
      page.getByText(/no audit log entries match/i),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("log rows are rendered when entries are mocked", async ({ page }) => {
    await mockAuditLog(page, [
      {
        id: "entry-001",
        actorId: "user-e2e-001",
        actorType: "user",
        action: "grant_created",
        targetType: "component",
        targetId: "component:nmap",
        decision: "allow",
        createdAt: "1700000000",
      },
      {
        id: "entry-002",
        actorId: "agent-abc123",
        actorType: "agent",
        action: "capability_executed",
        targetType: "tool",
        targetId: "component:httpx",
        decision: "allow",
        createdAt: "1700000001",
      },
    ]);
    await page.goto(AUDIT_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    // Action badges from the mocked data
    await expect(page.getByText("grant_created")).toBeVisible();
    await expect(page.getByText("capability_executed")).toBeVisible();

    // Decision badges
    const allowBadges = page.getByText("allow");
    await expect(allowBadges.first()).toBeVisible();
  });

  test("action filter select contains expected options", async ({ page }) => {
    await mockAuditLog(page);
    await page.goto(AUDIT_URL);

    // Wait for the filter card
    await expect(page.locator("#audit-action")).toBeVisible({
      timeout: 15_000,
    });

    // Open the select
    await page.locator("#audit-action").click();

    await expect(
      page.getByRole("option", { name: /all actions/i }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("option", { name: /grant_created/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: /agent_registered/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: /agent_revoked/i }),
    ).toBeVisible();
  });

  test("typing in actor filter debounces and triggers fetch", async ({
    page,
  }) => {
    let fetchCount = 0;
    await page.route("**/api/gibson-proxy**", async (route) => {
      const url = route.request().url();
      if (url.includes("ListAuditLog") || url.includes("AuditLog")) {
        fetchCount++;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ entries: [], total: 0 }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(AUDIT_URL);

    const actorInput = page.getByLabel(/filter by actor id/i);
    await expect(actorInput).toBeVisible({ timeout: 15_000 });

    // Type a value — the debounce fires after ~400 ms
    await actorInput.fill("user-e2e");

    // Wait for debounce + re-render
    await page.waitForTimeout(600);

    // At least one additional fetch was triggered after initial load
    expect(fetchCount).toBeGreaterThan(1);
  });

  test("clear filters button appears and resets filters", async ({ page }) => {
    await mockAuditLog(page);
    await page.goto(AUDIT_URL);

    // Wait for filter card
    await expect(page.getByLabel(/filter by actor id/i)).toBeVisible({
      timeout: 15_000,
    });

    // Set a filter value to make the Clear button appear
    await page.getByLabel(/filter by actor id/i).fill("somebody");
    // Debounce
    await page.waitForTimeout(600);

    const clearBtn = page.getByRole("button", { name: /clear all filters/i });
    await expect(clearBtn).toBeVisible();

    await clearBtn.click();

    // The actor input should be empty after clearing
    await expect(page.getByLabel(/filter by actor id/i)).toHaveValue("");

    // Clear button should disappear once no filters are active
    await expect(clearBtn).not.toBeVisible();
  });

  test("pagination controls are present", async ({ page }) => {
    await mockAuditLog(page);
    await page.goto(AUDIT_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByRole("navigation", { name: /audit log pagination/i }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: /previous page/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /next page/i }),
    ).toBeVisible();
  });

  test("previous page button is disabled on the first page", async ({
    page,
  }) => {
    await mockAuditLog(page);
    await page.goto(AUDIT_URL);

    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByRole("button", { name: /previous page/i }),
    ).toBeDisabled();
  });

  test("RPC error renders an error alert on the audit page", async ({
    page,
  }) => {
    await page.route("**/api/gibson-proxy**", async (route) => {
      await route.fulfill({ status: 503, body: "service unavailable" });
    });

    await page.goto(AUDIT_URL);

    await expect(
      page.locator('[role="alert"]').first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Audit log page — non-admin access denied
// ---------------------------------------------------------------------------

test.describe("Audit Log Settings — non-admin access denied", () => {
  test("non-admin sees access-restricted message", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      await loginAs(page, MEMBER_EMAIL, MEMBER_PASSWORD);
      await page.goto(AUDIT_URL);

      // AuditLogContent renders this when isAdmin = false
      await expect(
        page.getByText(/audit log access requires admin privileges/i),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await ctx.close();
    }
  });
});
