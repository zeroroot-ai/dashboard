/**
 * dashboard.po.ts, Dashboard page-object helpers.
 *
 * Shared helpers for navigating and asserting core dashboard chrome
 * (tenant display, membership list, quota panel, navigation).
 */

import { type Page, type BrowserContext, expect } from "@playwright/test";

/**
 * Navigate to the dashboard root and wait for the page chrome to stabilise.
 * Returns the page after navigation completes.
 */
export async function goToDashboard(page: Page): Promise<void> {
  await page.goto("/dashboard");
  await page.waitForLoadState("domcontentloaded");
}

/**
 * Stub the daemon proxy endpoint so authenticated dashboard pages render
 * without a live cluster. Any /api/gibson-proxy/** request returns an empty
 * JSON object.
 */
export async function stubDaemonProxy(context: BrowserContext): Promise<void> {
  await context.route("**/api/gibson-proxy**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}

/**
 * Stub the /api/settings/tier endpoint with a canned tier config.
 * Useful for quota-panel and billing-page tests.
 */
export async function stubTierEndpoint(
  context: BrowserContext,
  tier: string = "team",
  opts: {
    maxSeats?: number;
    maxAgents?: number;
    maxStorageGb?: number;
    currentSeats?: number;
    currentAgents?: number;
    currentStorageGb?: number;
  } = {},
): Promise<void> {
  const maxSeats = opts.maxSeats ?? 10;
  const maxAgents = opts.maxAgents ?? 5;
  const maxStorageGb = opts.maxStorageGb ?? 50;

  await context.route("**/api/settings/tier**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        config: {
          tier,
          displayName: tier.charAt(0).toUpperCase() + tier.slice(1),
          maxTeamMembers: maxSeats,
          maxAPIKeys: 100,
          customRolesEnabled: true,
          auditLogRetentionDays: 90,
          ssoEnabled: true,
          prioritySupport: false,
        },
        usage: {
          teamMemberCount: opts.currentSeats ?? 0,
          apiKeyCount: 0,
          customRoleCount: 0,
          pendingInvitationCount: 0,
        },
      }),
    });
  });

  await context.route("**/*getTenantQuota*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          seats: maxSeats,
          concurrentAgents: maxAgents,
          storageGb: maxStorageGb,
          retentionDays: 90,
          sandboxLaunchesPerMonth: 1000,
          updatedAt: new Date().toISOString(),
          currentSeats: opts.currentSeats ?? 0,
          currentConcurrentAgents: opts.currentAgents ?? 0,
          currentStorageGb: opts.currentStorageGb ?? 0,
          currentSandboxLaunchesThisMonth: 0,
        },
      }),
    });
  });
}

/**
 * Assert the dashboard chrome is visible and not showing the "No workspace"
 * fallback (which would indicate a session/FGA regression).
 */
export async function assertDashboardChrome(page: Page): Promise<void> {
  // Banner (header) should be visible.
  const header = page.getByRole("banner");
  await expect(header).toBeVisible({ timeout: 10_000 });
  await expect(header).not.toContainText("No workspace", { timeout: 5_000 });
}
