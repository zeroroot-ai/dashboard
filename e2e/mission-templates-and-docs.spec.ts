/**
 * mission-templates-and-docs.spec.ts
 *
 * End-to-end tests for the templates gallery and /docs surfaces
 * shipped under mission-dashboard-rewrite Tasks 12 + 14 + 15.
 *
 * Covers:
 *   - Templates gallery lists the four ADK-shipped templates.
 *   - Each template detail page renders MDX + JSON preview.
 *   - /docs index links navigate to verbs / nouns /
 *     schema-reference / templates pages.
 *   - Generated MDX surfaces the locked verb + noun catalogs.
 *
 * Pre-conditions: same as mission-create-flow.spec.ts.
 *
 * Requirements: mission-dashboard-rewrite Requirement 6 + Task 20.
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";

const requireCluster = !process.env.E2E_AUTH_SUITE;

const ALL_TEMPLATES = [
  "recon",
  "webapp-scan",
  "secrets-audit",
  "compliance-check",
];

test.describe("Mission Templates + Docs", () => {
  test.skip(requireCluster, "needs live cluster: set E2E_AUTH_SUITE=1");

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/auth/signin`);
    await page.fill('input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[name="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("templates gallery lists every shipped template", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/missions/templates`);
    for (const name of ALL_TEMPLATES) {
      // Each template renders as a card linking to its detail.
      await expect(
        page.locator(`a[href="/dashboard/missions/templates/${name}"]`),
      ).toBeVisible();
    }
  });

  test("template detail page renders MDX + JSON preview", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/missions/templates/recon`);
    // Title + description from the template's MDX frontmatter.
    await expect(page.locator("h1")).toContainText(/recon/i);
    // JSON preview block is present.
    await expect(page.locator("pre code")).toBeVisible();
    // "Use this template" CTA wires to the create page.
    await expect(
      page.locator('a:has-text("Use this template"), button:has-text("Use this template")'),
    ).toBeVisible();
  });

  test("/docs index links navigate to all four catalog pages", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/docs`);
    for (const slug of ["verbs", "nouns", "schema-reference", "templates"]) {
      const link = page.locator(`a[href="/dashboard/docs/${slug}"]`);
      await expect(link).toBeVisible();
    }
  });

  test("verbs page surfaces locked verb catalog", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/docs/verbs`);
    for (const verb of [
      "execute_agent",
      "skip_agent",
      "modify_params",
      "retry",
      "spawn_agent",
      "complete",
      "request_approval",
      "abort",
      "escalate",
      "rollback",
      "reflect",
      "recall",
    ]) {
      await expect(page.locator(`text=${verb}`)).toBeVisible();
    }
  });

  test("nouns page surfaces every NodeType + MergeStrategy", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/docs/nouns`);
    for (const noun of [
      "NODE_TYPE_AGENT",
      "NODE_TYPE_TOOL",
      "NODE_TYPE_PLUGIN",
      "NODE_TYPE_CONDITION",
      "NODE_TYPE_PARALLEL",
      "NODE_TYPE_JOIN",
    ]) {
      await expect(page.locator(`text=${noun}`)).toBeVisible();
    }
    // MergeStrategy table appears alongside JOIN.
    await expect(page.locator("text=MERGE_STRATEGY_CONCAT")).toBeVisible();
    await expect(page.locator("text=MERGE_STRATEGY_CUSTOM")).toBeVisible();
  });

  test("schema-reference page lists key proto messages", async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/docs/schema-reference`);
    await expect(
      page.locator("text=gibson.mission.v1.MissionDefinition"),
    ).toBeVisible();
    await expect(
      page.locator("text=gibson.mission.v1.JoinNodeConfig"),
    ).toBeVisible();
    await expect(
      page.locator("text=gibson.daemon.v1.MissionConstraints"),
    ).toBeVisible();
  });
});
