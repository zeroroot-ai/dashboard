/**
 * agent-install-dialog.spec.ts
 *
 * End-to-end tests for the AgentInstallDialog component. Four scenarios:
 *   1. required-blocked       — required permission missing blocks Install
 *   2. optional-warned        — optional permissions the caller lacks are
 *                               silently dropped with a warning banner
 *   3. full-approval success  — happy path writes tuples and closes dialog
 *   4. prosumer-default       — solo-tier tenant has every approval checked
 *                               by default for minimum friction
 *
 * Spec: access-matrix-finish task 28, R5 AC 1-3, 7, 9.
 *
 * The dialog is driven by a small harness page at /dev/agent-install-harness
 * which accepts query parameters for the component + permissions YAML and
 * opens the dialog on mount. Live CI provisions this harness as a test-only
 * route under the dashboard's dev-flag guard.
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const E2E_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const E2E_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^log ?in$|^sign ?in$/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 20_000,
  });
}

async function mockValidateComponent(
  page: Page,
  opts: {
    accessErrors?: Array<{
      target: string;
      action: "read" | "write" | "execute";
      required: boolean;
      reason: string;
    }>;
  } = {},
) {
  await page.route("**/*validateAgentManifest*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          ok: (opts.accessErrors?.length ?? 0) === 0,
          schemaErrors: [],
          accessErrors: opts.accessErrors ?? [],
          slotErrors: [],
          protoViolations: [],
        },
      }),
    });
  });
}

async function mockListAccessible(
  page: Page,
  rwx: { read: boolean; write: boolean; execute: boolean },
) {
  await page.route("**/*listAccessibleComponents*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: [
          {
            kind: "plugin",
            name: "gitlab",
            rwx,
            denyingGates: [],
          },
        ],
      }),
    });
  });
}

async function mockInstallAgent(page: Page, ok: boolean, error?: string) {
  await page.route("**/*installAgent*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        ok
          ? { ok: true, data: { agentInstallationId: "principal-uuid-test" } }
          : { ok: false, error: error ?? "rolled back" },
      ),
    });
  });
}

const HARNESS = (component: string, permissions: string) =>
  `${BASE_URL}/dev/agent-install-harness?component=${encodeURIComponent(
    component,
  )}&permissions=${encodeURIComponent(permissions)}`;

const COMPONENT_YAML = `apiVersion: gibson.zeroroot.ai/v1\nkind: Agent\nmetadata:\n  name: test-agent\n`;
const PERMISSIONS_REQUIRED_WRITE = `permissions:\n  - target: component:plugin/gitlab\n    action: write\n    required: true\n`;
const PERMISSIONS_OPTIONAL_READ = `permissions:\n  - target: component:plugin/gitlab\n    action: read\n    required: false\n`;
const PERMISSIONS_ALL = `permissions:\n  - target: component:plugin/gitlab\n    action: read\n    required: true\n  - target: component:plugin/gitlab\n    action: write\n    required: true\n  - target: component:plugin/gitlab\n    action: execute\n    required: true\n`;

test.describe("AgentInstallDialog", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, E2E_EMAIL, E2E_PASSWORD);
  });

  test("required-blocked: dialog blocks Install when required is denied", async ({
    page,
  }) => {
    await mockValidateComponent(page);
    await mockListAccessible(page, { read: true, write: false, execute: false });
    await page.goto(HARNESS(COMPONENT_YAML, PERMISSIONS_REQUIRED_WRITE));

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(
      dialog.getByText(/requires access you don'?t currently hold/i),
    ).toBeVisible();

    // Install button is disabled when required permissions aren't met.
    const install = dialog.getByRole("button", { name: /install/i });
    await expect(install).toBeDisabled();
  });

  test("optional-warned: dropped optional approvals surface in a warning", async ({
    page,
  }) => {
    await mockValidateComponent(page);
    await mockListAccessible(page, { read: false, write: true, execute: true });
    await page.goto(HARNESS(COMPONENT_YAML, PERMISSIONS_OPTIONAL_READ));

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(
      dialog.getByText(/optional requests skipped/i),
    ).toBeVisible();
  });

  test("full-approval success closes the dialog", async ({ page }) => {
    await mockValidateComponent(page);
    await mockListAccessible(page, { read: true, write: true, execute: true });
    await mockInstallAgent(page, true);
    await page.goto(HARNESS(COMPONENT_YAML, PERMISSIONS_ALL));

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    const install = dialog.getByRole("button", { name: /install with/i });
    await expect(install).toBeEnabled();
    await install.click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  });

  test("prosumer default-all-checked: every request checked on open", async ({
    page,
  }) => {
    // Override useTierLimits to return the prosumer shape.
    await page.route("**/api/settings/tier", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          config: {
            tier: "solo",
            displayName: "Solo",
            maxTeamMembers: 1,
            maxAPIKeys: Infinity,
            customRolesEnabled: false,
            auditLogRetentionDays: 30,
            ssoEnabled: false,
            prioritySupport: false,
          },
          usage: {
            teamMemberCount: 1,
            apiKeyCount: 0,
            customRoleCount: 0,
            pendingInvitationCount: 0,
          },
        }),
      });
    });
    await mockValidateComponent(page);
    await mockListAccessible(page, { read: true, write: true, execute: true });
    await page.goto(HARNESS(COMPONENT_YAML, PERMISSIONS_ALL));

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    const checkboxes = dialog.getByRole("checkbox");
    const total = await checkboxes.count();
    expect(total).toBeGreaterThan(0);
    for (let i = 0; i < total; i++) {
      await expect(checkboxes.nth(i)).toBeChecked();
    }
  });
});
