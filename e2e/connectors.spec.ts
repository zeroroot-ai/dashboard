/**
 * connectors.spec.ts, the exit test for the ADR-0067 connector arc
 * (dashboard#1128).
 *
 * Covers, in ADR-0067 terms:
 *
 *   - an admin enables a connector from the catalog and it appears in
 *     the enabled list;
 *   - a plain member sees no Enable / Disable controls;
 *   - a team-scoped execute deny on the connector flips the execute
 *     state for that team while another team keeps execute (asserted
 *     against the deny-wins matrix, the same way
 *     granular-permissions.spec.ts asserts scope-level denies);
 *   - the connector appears in the security-policy matrix alongside the
 *     other component kinds;
 *   - a per-agent execute grant on a connector round-trips into the
 *     agent's Permissions tab (CatalogPicker → writeAgentGrantsAction →
 *     Direct grants).
 *
 * Two test groups, same convention as tenant-provision.spec.ts:
 *
 *   1. Stubbed (no kind cluster), synthetic session via
 *      TEST_AUTH_BYPASS=1; asserts the client-side authz gating and the
 *      static security-policy kind selector. The connector catalog and
 *      matrix data need the daemon, so the positive counterparts of
 *      these assertions live in group 2.
 *
 *   2. Integration (kind cluster + E2E_KIND_AVAILABLE=1), real login,
 *      drives the daemon-backed flows end to end.
 *
 * Environment variables:
 *   PLAYWRIGHT_BASE_URL   - Dashboard URL (default: http://localhost:3000)
 *   TEST_AUTH_BYPASS      - enables the stubbed group
 *   E2E_KIND_AVAILABLE    - enables the integration group
 *   E2E_ADMIN_EMAIL       - Admin user email (seeded in the cluster IdP)
 *   E2E_ADMIN_PASSWORD    - Admin user password
 *   E2E_MEMBER_EMAIL      - Non-admin member email
 *   E2E_MEMBER_PASSWORD   - Non-admin member password
 *   E2E_CONNECTOR_ID      - Catalog connector to drive (default: gitlab)
 *   E2E_CONNECTOR_NAME    - Its display name (default: GitLab)
 */

import { test, expect, type Page } from "@playwright/test";
import { injectAuthSession, stubMemberships } from "./page-objects/auth.po";
import { stubDaemonProxy, stubTierEndpoint } from "./page-objects/dashboard.po";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL ?? "member@example.com";
const MEMBER_PASSWORD = process.env.E2E_MEMBER_PASSWORD ?? ADMIN_PASSWORD;
const CONNECTOR_ID = process.env.E2E_CONNECTOR_ID ?? "gitlab";
const CONNECTOR_NAME = process.env.E2E_CONNECTOR_NAME ?? "GitLab";

// Teams for the team-scoped deny assertion. Created on demand.
const DENIED_TEAM = "conn-denied";
const ALLOWED_TEAM = "conn-allowed";

// ---------------------------------------------------------------------------
// Skip guards
// ---------------------------------------------------------------------------

const needsBypass = !process.env.TEST_AUTH_BYPASS;
const needsCluster = !process.env.E2E_KIND_AVAILABLE;

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

async function waitForToast(page: Page, text: RegExp | string) {
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: text });
  await expect(toast).toBeVisible({ timeout: 10_000 });
}

/** Select a kind in the security-policy matrix's kind dropdown. */
async function selectKind(page: Page, label: string) {
  await page.getByRole("combobox").last().click();
  await page.getByRole("option", { name: label }).click();
}

/** Create a team via /dashboard/teams if it does not exist yet. */
async function ensureTeam(page: Page, teamName: string) {
  await page.goto(`${BASE_URL}/dashboard/teams`);
  await expect(page.getByRole("heading", { name: /teams/i })).toBeVisible();
  if (await page.getByRole("cell", { name: teamName }).isVisible()) return;
  await page.getByRole("button", { name: /create team/i }).click();
  await page.getByLabel(/team name/i).fill(teamName);
  await page.getByRole("button", { name: /create/i }).click();
  await waitForToast(page, /team created/i);
  await expect(page.getByRole("cell", { name: teamName })).toBeVisible();
}

/** The execute switch for the connector row in an RWX matrix. */
function executeSwitch(page: Page) {
  return page.getByRole("switch", {
    name: new RegExp(`execute for ${CONNECTOR_NAME}`, "i"),
  });
}

// ---------------------------------------------------------------------------
// Group 1, stubbed UI state (no kind cluster required)
// ---------------------------------------------------------------------------

const MOCK_USER = {
  sub: "e2e-connectors-user",
  name: "Connectors Test",
  email: "connectors@e2e.zeroroot.local",
};
const MOCK_TENANT_ID = "tenant-e2e-connectors-test";

test.describe("connectors, UI state (stubbed)", () => {
  test.skip(needsBypass, "requires TEST_AUTH_BYPASS=1");

  test.beforeEach(async ({ context }) => {
    await injectAuthSession(context, MOCK_USER, MOCK_TENANT_ID);
    await stubDaemonProxy(context);
    await stubTierEndpoint(context, "team");
  });

  test("a plain member sees no Enable or Disable controls", async ({
    context,
    page,
  }) => {
    // EnableConnector / DisableConnector carry the admin relation in the
    // AuthRegistry; useAuthorize fails closed for a tenant_member, so the
    // controls never enter the DOM (hide-on-loading, no FOUC).
    await stubMemberships(context, MOCK_TENANT_ID, "tenant_member");
    await page.goto("/dashboard/connectors");
    await expect(
      page.getByRole("heading", { name: "Connectors", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /^enable$|^enabled$/i }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /disable/i })).toHaveCount(0);
  });

  test("the security-policy matrix offers the connector kind", async ({
    context,
    page,
  }) => {
    await stubMemberships(context, MOCK_TENANT_ID, "tenant_admin");
    await page.goto("/dashboard/organization/security-policy");
    await expect(
      page.getByRole("heading", { name: /security policy/i }),
    ).toBeVisible({ timeout: 15_000 });
    // The kind selector is static client UI: Connectors sits alongside
    // plugins / tools / agents (dashboard#1130).
    await page.getByRole("combobox").last().click();
    await expect(
      page.getByRole("option", { name: "Connectors" }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Group 2, integration (kind cluster required)
// ---------------------------------------------------------------------------

test.describe("connectors, integration (kind cluster)", () => {
  test.skip(needsCluster, "requires kind cluster + E2E_KIND_AVAILABLE=1");
  // Later tests depend on the connector enabled by the first one.
  test.describe.configure({ mode: "serial" });

  test("admin enables a connector from the catalog and it appears in the enabled list", async ({
    page,
  }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`${BASE_URL}/dashboard/connectors`);
    await expect(page.getByRole("heading", { name: /catalog/i })).toBeVisible({
      timeout: 15_000,
    });

    const card = page
      .locator("[data-slot='card']")
      .filter({ hasText: CONNECTOR_NAME })
      .first();
    await expect(card).toBeVisible();

    const enableBtn = card.getByRole("button", { name: /^enable$/i });
    if (await enableBtn.isVisible()) {
      await enableBtn.click();
      await waitForToast(page, /enabled/i);
    }

    // The Enabled section now lists the connector.
    const enabledSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: /^enabled$/i }) });
    await expect(
      enabledSection.getByText(CONNECTOR_NAME).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("a plain member sees no Enable or Disable controls while the catalog renders", async ({
    browser,
  }) => {
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await loginAs(memberPage, MEMBER_EMAIL, MEMBER_PASSWORD);

    await memberPage.goto(`${BASE_URL}/dashboard/connectors`);
    await expect(
      memberPage.getByRole("heading", { name: /catalog/i }),
    ).toBeVisible({ timeout: 15_000 });
    // The catalog card is visible, so the absence assertion is not vacuous.
    await expect(
      memberPage.getByText(CONNECTOR_NAME).first(),
    ).toBeVisible();

    await expect(
      memberPage.getByRole("button", { name: /^enable$|^enabled$/i }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("button", { name: /disable/i }),
    ).toHaveCount(0);

    await memberContext.close();
  });

  test("the connector appears in the security-policy matrix alongside the other kinds", async ({
    page,
  }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`${BASE_URL}/dashboard/organization/security-policy`);
    await expect(
      page.getByRole("heading", { name: /security policy/i }),
    ).toBeVisible({ timeout: 15_000 });

    await selectKind(page, "Connectors");
    const row = page.getByRole("row").filter({ hasText: CONNECTOR_NAME });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(executeSwitch(page)).toBeVisible();
  });

  test("a team-scoped execute deny flips that team while the other team keeps execute", async ({
    page,
  }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await ensureTeam(page, DENIED_TEAM);
    await ensureTeam(page, ALLOWED_TEAM);

    await page.goto(`${BASE_URL}/dashboard/organization/security-policy`);
    await selectKind(page, "Connectors");
    await expect(
      page.getByRole("row").filter({ hasText: CONNECTOR_NAME }),
    ).toBeVisible({ timeout: 15_000 });

    // Per-team scope, target the denied team, and install the execute deny.
    await page.getByRole("tab", { name: /per-team/i }).click();
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: DENIED_TEAM }).click();

    const exec = executeSwitch(page);
    await expect(exec).toBeVisible({ timeout: 15_000 });
    if (await exec.isChecked()) {
      await exec.click();
    }
    await expect(exec).not.toBeChecked();

    // A member of the other team keeps execute: the same matrix evaluated
    // for the allowed team still shows execute on.
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: ALLOWED_TEAM }).click();
    await expect(executeSwitch(page)).toBeChecked({ timeout: 15_000 });

    // Lift the deny again so the suite stays re-runnable.
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: DENIED_TEAM }).click();
    const execAgain = executeSwitch(page);
    await expect(execAgain).toBeVisible({ timeout: 15_000 });
    if (!(await execAgain.isChecked())) {
      await execAgain.click();
    }
    await expect(execAgain).toBeChecked();
  });

  test("a per-agent execute grant on a connector round-trips into the grants tab", async ({
    page,
  }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Open the first agent's detail page.
    await page.goto(`${BASE_URL}/dashboard/agents`);
    const firstAgent = page
      .getByRole("link", { name: /view|detail/i })
      .or(page.getByRole("table").getByRole("link"))
      .first();
    await expect(firstAgent).toBeVisible({ timeout: 15_000 });
    await firstAgent.click();
    await page.waitForURL(/\/dashboard\/agents\//);

    // Permissions tab → Add grant → the Connectors section lists the
    // enabled connector with the three action checkboxes.
    await page.getByRole("tab", { name: /permissions/i }).click();
    await page.getByRole("button", { name: /add grant/i }).click();
    await expect(
      page.getByText(/Connectors \(\d+\)/).first(),
    ).toBeVisible({ timeout: 15_000 });

    const execBox = page.getByRole("checkbox", {
      name: new RegExp(`can_execute on ${CONNECTOR_NAME}`, "i"),
    });
    await expect(execBox).toBeVisible();

    // Already granted from a previous run? Then it renders disabled and
    // the round trip is already proven by the Direct grants list.
    if (await execBox.isEnabled()) {
      await execBox.click();
      await page.getByRole("button", { name: /^add/i }).click();
      await waitForToast(page, /grant.* added/i);
    } else {
      await page.getByRole("button", { name: /cancel/i }).click();
    }

    // The grant is visible in the Direct grants list with the connector
    // as the OBJECT (component:connector/<id>); the principal stays the
    // agent (ADR-0067, no connector-side permissions surface).
    await expect(
      page.getByText(`component:connector/${CONNECTOR_ID}`).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
