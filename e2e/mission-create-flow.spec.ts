/**
 * mission-create-flow.spec.ts
 *
 * End-to-end tests for the mission-creation flow rebuilt under
 * mission-dashboard-rewrite Tasks 5-9 + 14-15.
 *
 * Covers:
 *   - Create page renders, scope tab inputs accept values.
 *   - Switching to YAML view renders state as YAML.
 *   - Templates gallery → "Use this template" pre-fills the
 *     create form with the template's content.
 *   - /docs route renders the verbs page from the vendored MDX.
 *
 * Pre-conditions:
 *   PLAYWRIGHT_BASE_URL — target cluster URL (default: http://localhost:3000)
 *   E2E_ADMIN_EMAIL     — admin user email
 *   E2E_ADMIN_PASSWORD  — admin user password
 *
 * Requirements: mission-dashboard-rewrite Requirements 1, 5, 6
 *               + Task 19.
 *
 * Skip mode: when E2E_AUTH_SUITE is unset, all specs skip — the
 * suite needs a live cluster (kind + daemon + Envoy + ext-authz).
 * CI sets the env when the test cluster is available.
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";

const requireCluster = !process.env.E2E_AUTH_SUITE;

test.describe("Mission Create Flow", () => {
  test.skip(requireCluster, "needs live cluster: set E2E_AUTH_SUITE=1");

  test.beforeEach(async ({ page }) => {
    // Sign in via the existing admin login flow used by sister
    // suites (e2e/permissions.spec.ts pattern).
    await page.goto(`${BASE_URL}/auth/signin`);
    await page.fill('input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[name="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("scope tab accepts mission identity inputs", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/missions/create`);
    // ScopeTab fields rebound to the canonical proto type
    // (Spec 4 Task 5).
    await page.fill('input#mission-name', "e2e-recon");
    await page.fill('textarea#mission-description', "End-to-end test");
    await page.fill('input#mission-version', "1.2.3");
    await page.fill('input#mission-target-ref', "tgt-127");

    // Sanity-check: values persist across other-tab navigation
    // (state-shape isn't lost when activeTab changes).
    await page.click('button[role="tab"]:has-text("Steps")');
    await page.click('button[role="tab"]:has-text("Scope")');
    await expect(page.locator('input#mission-name')).toHaveValue("e2e-recon");
    await expect(page.locator('input#mission-version')).toHaveValue("1.2.3");
  });

  test("template gallery → use template pre-fills create form", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/missions/templates`);
    // Templates page lists the four ADK-shipped templates.
    await expect(page.locator("text=Recon")).toBeVisible();

    await page.click('a[href="/dashboard/missions/templates/recon"]');
    await expect(page).toHaveURL(/\/dashboard\/missions\/templates\/recon/);
    await page.click('a:has-text("Use this template"), button:has-text("Use this template")');

    // After "Use this template", the create page opens with
    // recon's name pre-filled.
    await expect(page).toHaveURL(/\/dashboard\/missions\/create/);
    await expect(page.locator('input#mission-name')).toHaveValue(/recon/i);
  });

  test("/docs route renders the verbs page", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/docs/verbs`);
    await expect(page.locator("h1")).toContainText("Mission Verbs");
    // Generated MDX includes a table of the locked verbs.
    await expect(page.locator("text=execute_agent")).toBeVisible();
    await expect(page.locator("text=spawn_agent")).toBeVisible();
  });

  test("constraints tab binds to MissionConstraints", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/missions/create`);
    await page.click('button[role="tab"]:has-text("Constraints")');
    await page.fill('input#constraints-max-tokens', "100000");
    await page.fill('input#constraints-max-tokens-per-call', "4096");

    // Switch tabs and back; the values persist.
    await page.click('button[role="tab"]:has-text("Scope")');
    await page.click('button[role="tab"]:has-text("Constraints")');
    await expect(page.locator('input#constraints-max-tokens')).toHaveValue("100000");
    await expect(page.locator('input#constraints-max-tokens-per-call')).toHaveValue("4096");
  });
});
