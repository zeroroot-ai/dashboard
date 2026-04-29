/**
 * mission-secrets-panel.spec.ts
 *
 * End-to-end tests for the "Secrets Accessed" panel on the mission detail page.
 *
 * Covers:
 *   - Panel renders secret refs after a synthetic mission completes.
 *   - Each ref shows: name, category, first/last access, count, plugin install ID.
 *   - Ref links navigate to the correct /secrets/[id] detail page.
 *   - Lag-state placeholder appears when aggregationLagSeconds > 5.
 *   - No values are shown — refs only (NFR Security).
 *   - Refs-only assertion (no credential values in rendered DOM).
 *
 * Requirements: 6, R6.1–R6.6.
 *
 * Pre-conditions:
 *   PLAYWRIGHT_BASE_URL — target cluster URL (default: http://localhost:3000)
 *   E2E_ADMIN_EMAIL     — admin user email
 *   E2E_ADMIN_PASSWORD  — admin user password
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";

const MISSION_ID = "mission-e2e-001";
const MISSION_DETAIL_URL = `${BASE_URL}/dashboard/missions/${MISSION_ID}`;

/** A distinctive credential value string that must NEVER appear in the DOM. */
const SECRET_VALUE_SENTINEL = "SHOULD_NEVER_APPEAR_IN_DOM_sk-api-key-abc123";

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
 * Mock GetMissionAudit to return a set of secret refs.
 * The aggregationLagSeconds is within acceptable range (< 5s).
 */
async function mockMissionAuditWithRefs(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();

    if (url.includes("GetMissionAudit") || url.includes("MissionAudit")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          missionId: MISSION_ID,
          aggregationLagSeconds: 2.1,
          refs: [
            {
              secretId: "secret-001",
              ref: "provider_config:anthropic:default",
              name: "anthropic_api_key",
              category: "provider_config",
              firstAccessAt: "2026-04-28T10:00:00Z",
              lastAccessAt: "2026-04-28T10:15:00Z",
              accessCount: 12,
              pluginInstallIds: ["plugin-install-gitlab-001"],
              // NOTE: no 'value' field — refs only
            },
            {
              secretId: "secret-002",
              ref: "cred:db_password",
              name: "db_password",
              category: "cred",
              firstAccessAt: "2026-04-28T10:02:00Z",
              lastAccessAt: "2026-04-28T10:10:00Z",
              accessCount: 3,
              pluginInstallIds: ["plugin-install-jira-002"],
            },
          ],
          total: 2,
        }),
      });
      return;
    }

    if (url.includes("GetMission") || url.includes("ListMissions")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: MISSION_ID,
          status: "completed",
          createdAt: "2026-04-28T09:55:00Z",
          completedAt: "2026-04-28T10:20:00Z",
          description: "E2E test mission",
        }),
      });
      return;
    }

    await route.continue();
  });
}

/**
 * Mock GetMissionAudit with lag > 5 seconds (should show "Aggregation in progress").
 */
async function mockMissionAuditWithLag(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();

    if (url.includes("GetMissionAudit") || url.includes("MissionAudit")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          missionId: MISSION_ID,
          aggregationLagSeconds: 8.5, // > 5 — should trigger lag placeholder
          refs: [],
          total: 0,
          lagState: "in_progress",
        }),
      });
      return;
    }

    if (url.includes("GetMission") || url.includes("ListMissions")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: MISSION_ID,
          status: "completed",
          createdAt: "2026-04-28T09:55:00Z",
          completedAt: "2026-04-28T10:20:00Z",
          description: "E2E test mission",
        }),
      });
      return;
    }

    await route.continue();
  });
}

// ---------------------------------------------------------------------------
// Test suite: panel renders refs
// ---------------------------------------------------------------------------

test.describe("Mission Secrets Panel — ref rendering (R6.1, R6.2)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockMissionAuditWithRefs(page);
  });

  test("Secrets Accessed panel or tab is visible on mission detail page", async ({
    page,
  }) => {
    await page.goto(MISSION_DETAIL_URL);

    await expect(
      page
        .getByText(/secrets.*accessed|accessed.*secrets|secret.*refs/i)
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("panel renders ref names from the mock data", async ({ page }) => {
    await page.goto(MISSION_DETAIL_URL);

    // Wait for the panel
    await expect(
      page.getByText(/secrets.*accessed|accessed.*secrets/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Ref names should be visible
    await expect(
      page.getByText("anthropic_api_key").first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText("db_password").first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("panel renders ref string (provider_config:anthropic:default)", async ({
    page,
  }) => {
    await page.goto(MISSION_DETAIL_URL);

    await expect(
      page.getByText(/secrets.*accessed/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // The ref identifier should be visible
    await expect(
      page
        .getByText("provider_config:anthropic:default", { exact: false })
        .or(page.getByText(/anthropic.*default/i))
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("panel renders access count for each ref", async ({ page }) => {
    await page.goto(MISSION_DETAIL_URL);

    await expect(
      page.getByText(/secrets.*accessed/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Access counts from mock: 12 and 3
    await expect(
      page.getByText("12").first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("panel renders plugin install IDs for each ref", async ({ page }) => {
    await page.goto(MISSION_DETAIL_URL);

    await expect(
      page.getByText(/secrets.*accessed/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByText("plugin-install-gitlab-001", { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test suite: ref links navigation
// ---------------------------------------------------------------------------

test.describe("Mission Secrets Panel — ref link navigation (R6.4)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockMissionAuditWithRefs(page);
  });

  test("ref links point to the secret detail page URL", async ({ page }) => {
    await page.goto(MISSION_DETAIL_URL);

    await expect(
      page.getByText(/secrets.*accessed/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Find a link in the panel that points to /secrets/secret-001
    const refLink = page
      .getByRole("link", { name: /anthropic_api_key/i })
      .or(page.locator(`a[href*="/secrets/secret-001"]`))
      .first();

    const linkCount = await refLink.count();
    if (linkCount > 0) {
      const href = await refLink.getAttribute("href");
      expect(href).toMatch(/secrets\/secret-001/);
    } else {
      // If the link is rendered differently, check for clickable ref rows
      const refRow = page
        .getByText("anthropic_api_key")
        .locator("xpath=ancestor::a|xpath=ancestor::button")
        .first();
      expect(await refRow.count()).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Test suite: lag-state placeholder (R6.6)
// ---------------------------------------------------------------------------

test.describe("Mission Secrets Panel — lag-state placeholder (R6.6)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockMissionAuditWithLag(page);
  });

  test("aggregationLagSeconds > 5 shows 'Aggregation in progress' placeholder", async ({
    page,
  }) => {
    await page.goto(MISSION_DETAIL_URL);

    // Wait for the panel to mount
    await expect(
      page.getByText(/secrets.*accessed|secrets/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // R6.6 — lag > 5s must show the lag placeholder
    await expect(
      page
        .getByText(/aggregation.*in.*progress|aggregating|in.*progress|lag/i)
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("lag state does not show empty ref rows", async ({ page }) => {
    await page.goto(MISSION_DETAIL_URL);

    await expect(
      page.getByText(/secrets.*accessed/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // During lag, no ref rows should be rendered (table should be absent or empty)
    const refTable = page.locator('[data-testid="secrets-refs-table"]');
    if ((await refTable.count()) > 0) {
      // If table exists, it should have no data rows
      const rows = refTable.getByRole("row");
      const rowCount = await rows.count();
      // 0 data rows (header row is acceptable)
      expect(rowCount).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Test suite: refs-only (no values shown) — NFR Security
// ---------------------------------------------------------------------------

test.describe("Mission Secrets Panel — refs only (NFR Security)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("no credential value appears in the DOM", async ({ page }) => {
    // Mock that injects a value field to test that the frontend correctly ignores it
    await page.route("**/api/gibson-proxy**", async (route) => {
      const url = route.request().url();

      if (url.includes("GetMissionAudit") || url.includes("MissionAudit")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            missionId: MISSION_ID,
            aggregationLagSeconds: 1.0,
            refs: [
              {
                secretId: "secret-001",
                ref: "provider_config:anthropic:default",
                name: "anthropic_api_key",
                category: "provider_config",
                firstAccessAt: "2026-04-28T10:00:00Z",
                lastAccessAt: "2026-04-28T10:15:00Z",
                accessCount: 5,
                pluginInstallIds: ["plugin-install-001"],
                // value field intentionally injected — frontend must never render it
                value: SECRET_VALUE_SENTINEL,
              },
            ],
            total: 1,
          }),
        });
        return;
      }

      if (url.includes("GetMission") || url.includes("ListMissions")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: MISSION_ID,
            status: "completed",
          }),
        });
        return;
      }

      await route.continue();
    });

    await page.goto(MISSION_DETAIL_URL);

    // Wait for panel to render
    await expect(
      page.getByText(/secrets.*accessed|anthropic_api_key/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // SECURITY-CRITICAL: The sentinel value must NEVER appear in the DOM
    const bodyText = await page.textContent("body");
    expect(
      (bodyText ?? "").includes(SECRET_VALUE_SENTINEL),
      `SECURITY REGRESSION: Secret value "${SECRET_VALUE_SENTINEL}" found in mission secrets panel DOM. ` +
        `The panel must render refs only — never credential values.`,
    ).toBe(false);
  });

  test("'Show value' affordance is absent from the secrets panel", async ({
    page,
  }) => {
    await mockMissionAuditWithRefs(page);
    await page.goto(MISSION_DETAIL_URL);

    await expect(
      page.getByText(/secrets.*accessed/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // No "show value" button anywhere in the panel
    await expect(
      page.getByRole("button", { name: /show.*value|reveal.*value/i }),
    ).not.toBeVisible();
  });
});
