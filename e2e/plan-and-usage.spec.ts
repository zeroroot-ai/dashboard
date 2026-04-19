/**
 * plan-and-usage.spec.ts
 *
 * End-to-end tests for the /dashboard/pages/settings/billing page's
 * Plan & Usage section. Seven parametrised plan-id scenarios plus
 * quota-threshold boundary cases.
 *
 * Spec: access-matrix-finish task 27, R4 AC 1, 3, 4, 5, 8.
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";
const BILLING_URL = `${BASE_URL}/dashboard/pages/settings/billing`;

const PLAN_IDS = [
  "solo",
  "squad",
  "org",
  "platform",
  "enterprise-cloud",
  "enterprise-onprem",
  "public-sector",
] as const;

type PlanID = (typeof PLAN_IDS)[number];

const CONTACT_ONLY_PLANS = new Set<PlanID>([
  "enterprise-cloud",
  "enterprise-onprem",
  "public-sector",
]);

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^log ?in$|^sign ?in$/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 20_000,
  });
}

async function mockTier(page: Page, tier: PlanID) {
  await page.route("**/api/settings/tier", async (route) => {
    const displayNames: Record<PlanID, string> = {
      solo: "Solo",
      squad: "Squad",
      org: "Organization",
      platform: "Platform",
      "enterprise-cloud": "Enterprise Cloud",
      "enterprise-onprem": "Enterprise On-Prem",
      "public-sector": "Public Sector",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        config: {
          tier,
          displayName: displayNames[tier],
          maxTeamMembers: tier === "solo" ? 1 : 50,
          maxAPIKeys: Infinity,
          customRolesEnabled: tier !== "solo" && tier !== "squad",
          auditLogRetentionDays: 90,
          ssoEnabled: tier !== "solo" && tier !== "squad",
          prioritySupport: tier === "org" || tier === "platform",
        },
        usage: {
          teamMemberCount: 0,
          apiKeyCount: 0,
          customRoleCount: 0,
          pendingInvitationCount: 0,
        },
      }),
    });
  });
}

async function mockQuota(
  page: Page,
  opts: { percent?: number; unavailable?: boolean } = {},
) {
  const percent = opts.percent ?? 25;
  await page.route("**/*getTenantQuota*", async (route) => {
    if (opts.unavailable) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: "daemon unavailable",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          seats: 10,
          concurrentAgents: 10,
          storageGb: 100,
          retentionDays: 90,
          sandboxLaunchesPerMonth: 1000,
          updatedAt: new Date().toISOString(),
          currentSeats: Math.floor(10 * (percent / 100)),
          currentConcurrentAgents: Math.floor(10 * (percent / 100)),
          currentStorageGb: Math.floor(100 * (percent / 100)),
          currentSandboxLaunchesThisMonth: Math.floor(1000 * (percent / 100)),
        },
      }),
    });
  });
}

test.describe("Plan & Usage — plan-id parametrisation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  for (const tier of PLAN_IDS) {
    test(`renders for ${tier}`, async ({ page }) => {
      await mockTier(page, tier);
      await mockQuota(page, { percent: 25 });
      await page.goto(BILLING_URL);

      // Plan header renders
      await expect(page.getByText(/Plan & Usage/i)).toBeVisible({
        timeout: 15_000,
      });

      // Feature list card renders
      await expect(page.getByText(/Features included/i)).toBeVisible();

      // CTA button is the right variant
      if (CONTACT_ONLY_PLANS.has(tier)) {
        await expect(
          page.getByRole("button", { name: /contact sales/i }),
        ).toBeVisible();
      } else {
        await expect(
          page.getByRole("button", { name: /manage subscription/i }),
        ).toBeVisible();
      }
    });
  }
});

test.describe("Plan & Usage — quota threshold colouring", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("79% utilisation stays in the default (green) tone", async ({ page }) => {
    await mockTier(page, "org");
    await mockQuota(page, { percent: 79 });
    await page.goto(BILLING_URL);
    const bars = page.locator('[role="progressbar"]');
    await expect(bars.first()).toBeVisible({ timeout: 15_000 });
    // Explicit amber / red tone classes should be absent.
    for (let i = 0; i < await bars.count(); i++) {
      const cls = await bars.nth(i).getAttribute("class");
      expect(cls ?? "").not.toMatch(/bg-amber-500/);
      expect(cls ?? "").not.toMatch(/bg-red-500/);
    }
  });

  test("80% utilisation triggers amber tone", async ({ page }) => {
    await mockTier(page, "org");
    await mockQuota(page, { percent: 80 });
    await page.goto(BILLING_URL);
    await expect(
      page.locator('[role="progressbar"].\\[\\&\\>div\\]\\:bg-amber-500'),
    ).toHaveCount(
      // 4 numeric quotas are affected (seats, concurrent agents, storage,
      // sandbox launches). Retention is a static days value so it sits at 0%
      // in the mock.
      4,
      { timeout: 15_000 },
    );
  });

  test("95% utilisation triggers red tone", async ({ page }) => {
    await mockTier(page, "org");
    await mockQuota(page, { percent: 95 });
    await page.goto(BILLING_URL);
    await expect(
      page.locator('[role="progressbar"].\\[\\&\\>div\\]\\:bg-red-500'),
    ).toHaveCount(4, { timeout: 15_000 });
  });

  test("unavailable quota shows the fallback banner + keeps feature list", async ({
    page,
  }) => {
    await mockTier(page, "org");
    await mockQuota(page, { unavailable: true });
    await page.goto(BILLING_URL);
    await expect(
      page.getByText(/Usage temporarily unavailable/i),
    ).toBeVisible({ timeout: 15_000 });
    // Feature list still renders.
    await expect(page.getByText(/Features included/i)).toBeVisible();
  });
});
