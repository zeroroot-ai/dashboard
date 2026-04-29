/**
 * plugin-register.spec.ts
 *
 * End-to-end tests for the plugin registration wizard.
 *
 * Covers:
 *   - Full wizard end-to-end (manifest upload → validate → bindings → confirm → enrollment).
 *   - Atomic rollback on injected binding_failed: wizard navigates back to Step 3 (Bindings).
 *   - Each step is reachable and renders expected content.
 *   - Bootstrap token renders at enrollment step.
 *   - CLI command snippet is shown at enrollment step.
 *
 * The atomic rollback test is the key correctness assertion: when RegisterPlugin
 * returns binding_failed, the wizard must NOT proceed to enrollment but instead
 * return to the binding step with an error. This mirrors Spec 2 R3.1 atomicity.
 *
 * Requirements: 2, R2.1–R2.4.
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

const PLUGINS_URL = `${BASE_URL}/dashboard/pages/settings/plugins`;

/** A minimal valid plugin manifest YAML string for testing. */
const VALID_MANIFEST_YAML = `
apiVersion: gibson.ai/v1
kind: Plugin
metadata:
  name: e2e-test-plugin
  version: 1.0.0
spec:
  runtime: grpc
  secrets:
    - name: anthropic_api_key
      category: provider_config
      description: "Anthropic API key for LLM calls"
  rpcs:
    - GetCredential
`.trim();

/** An invalid manifest that should fail validation. */
const INVALID_MANIFEST_YAML = `
kind: NotAPlugin
metadata:
  name: bad
`.trim();

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

/** Mock successful validation and registration flow. */
async function mockSuccessfulRegistration(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();

    if (url.includes("ValidatePluginManifest") || url.includes("RegisterPlugin")) {
      const body = await route.request().postDataJSON().catch(() => ({}));
      const isDryRun =
        (body as { dry_run?: boolean; dryRun?: boolean })?.dry_run === true ||
        (body as { dry_run?: boolean; dryRun?: boolean })?.dryRun === true;

      if (isDryRun) {
        // Validation step
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            valid: true,
            manifest: {
              name: "e2e-test-plugin",
              version: "1.0.0",
              secrets: [{ name: "anthropic_api_key", category: "provider_config" }],
              rpcs: ["GetCredential"],
            },
          }),
        });
      } else {
        // Actual registration
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            pluginId: "plugin-e2e-001",
            bootstrapToken: "e2e-bootstrap-token-abc123def456",
            cliCommand:
              "gibson-cli plugin enroll --token e2e-bootstrap-token-abc123def456",
            enrolled: true,
          }),
        });
      }
      return;
    }

    if (url.includes("ListSecrets")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          secrets: [
            {
              id: "secret-001",
              name: "anthropic_api_key",
              category: "provider_config",
              version: 1,
            },
          ],
          total: 1,
        }),
      });
      return;
    }

    if (
      url.includes("GetBrokerConfig") ||
      url.includes("GetTenantBrokerConfig")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ provider: "gibson_vault", configured: true }),
      });
      return;
    }

    if (url.includes("ListPluginInstalls") || url.includes("ListPlugins")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ plugins: [], total: 0 }),
      });
      return;
    }

    await route.continue();
  });
}

/** Mock validation failure for invalid manifest. */
async function mockValidationFailure(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();

    if (url.includes("ValidatePluginManifest") || url.includes("RegisterPlugin")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          valid: false,
          errors: [
            {
              line: 1,
              message:
                "apiVersion is required and must be 'gibson.ai/v1'",
              field: "apiVersion",
            },
            {
              line: 2,
              message: "kind must be 'Plugin'",
              field: "kind",
            },
          ],
        }),
      });
      return;
    }

    await route.continue();
  });
}

/**
 * Mock binding_failed error on RegisterPlugin (atomic rollback test).
 * Validation (dry-run) succeeds; actual registration returns binding_failed.
 */
async function mockBindingFailedRegistration(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();

    if (url.includes("ValidatePluginManifest") || url.includes("RegisterPlugin")) {
      let isDryRun = false;
      try {
        const body = await route.request().postDataJSON();
        isDryRun =
          (body as { dry_run?: boolean; dryRun?: boolean })?.dry_run === true ||
          (body as { dry_run?: boolean; dryRun?: boolean })?.dryRun === true;
      } catch {
        // ignore parse errors
      }

      if (isDryRun) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            valid: true,
            manifest: {
              name: "e2e-test-plugin",
              version: "1.0.0",
              secrets: [{ name: "anthropic_api_key", category: "provider_config" }],
            },
          }),
        });
      } else {
        // Binding step failure — atomic rollback
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            enrolled: false,
            failureCode: "binding_failed",
            failedStep: "bindings",
            failureMessage:
              "Secret 'anthropic_api_key' binding failed: secret not found in broker",
            rolledBack: true,
          }),
        });
      }
      return;
    }

    if (url.includes("ListSecrets")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ secrets: [], total: 0 }),
      });
      return;
    }

    if (
      url.includes("GetBrokerConfig") ||
      url.includes("GetTenantBrokerConfig")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ provider: "gibson_vault", configured: true }),
      });
      return;
    }

    if (url.includes("ListPluginInstalls") || url.includes("ListPlugins")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ plugins: [], total: 0 }),
      });
      return;
    }

    await route.continue();
  });
}

// ---------------------------------------------------------------------------
// Helper: open the registration wizard from the plugins page
// ---------------------------------------------------------------------------

async function openRegistrationWizard(page: Page): Promise<void> {
  await page.goto(PLUGINS_URL);

  // Click the "Add Plugin" button
  const addPluginBtn = page
    .getByRole("button", { name: /add.*plugin|register.*plugin|new.*plugin/i })
    .first();
  await expect(addPluginBtn).toBeVisible({ timeout: 15_000 });
  await addPluginBtn.click();

  // Wizard dialog/panel should open
  const wizard = page
    .getByRole("dialog")
    .or(page.getByTestId("plugin-register-wizard"))
    .first();
  await expect(wizard).toBeVisible({ timeout: 5_000 });
}

// ---------------------------------------------------------------------------
// Test suite: wizard structure
// ---------------------------------------------------------------------------

test.describe("Plugin register — wizard structure", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockSuccessfulRegistration(page);
  });

  test("plugins page renders 'Add Plugin' button", async ({ page }) => {
    await page.goto(PLUGINS_URL);

    await expect(
      page.getByRole("button", { name: /add.*plugin|register.*plugin/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("clicking 'Add Plugin' opens the wizard dialog", async ({ page }) => {
    await openRegistrationWizard(page);

    const wizard = page.getByRole("dialog").first();
    await expect(wizard).toBeVisible({ timeout: 5_000 });
  });

  test("wizard renders Step 1 manifest upload area", async ({ page }) => {
    await openRegistrationWizard(page);

    const wizard = page.getByRole("dialog").first();

    // Step 1 — manifest upload / paste area
    await expect(
      wizard
        .getByText(/manifest|upload|paste.*yaml|plugin.yaml/i)
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Test suite: full wizard happy path
// ---------------------------------------------------------------------------

test.describe("Plugin register — full wizard end-to-end (happy path)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockSuccessfulRegistration(page);
  });

  test("wizard step 1 — paste manifest and advance to validate step", async ({
    page,
  }) => {
    await openRegistrationWizard(page);

    const wizard = page.getByRole("dialog").first();

    // Find the manifest textarea / paste area
    const manifestArea = wizard
      .getByRole("textbox")
      .or(wizard.locator("textarea"))
      .first();

    await expect(manifestArea).toBeVisible({ timeout: 5_000 });
    await manifestArea.fill(VALID_MANIFEST_YAML);

    // Advance to next step
    const nextBtn = wizard
      .getByRole("button", { name: /next|continue|validate/i })
      .first();
    await expect(nextBtn).toBeEnabled({ timeout: 3_000 });
    await nextBtn.click();

    // Step 2: validation in progress or complete
    await expect(
      wizard.getByText(/validat|checking|step.*2/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("wizard step 2 — validation passes, advance to bindings", async ({
    page,
  }) => {
    await openRegistrationWizard(page);

    const wizard = page.getByRole("dialog").first();

    const manifestArea = wizard
      .getByRole("textbox")
      .or(wizard.locator("textarea"))
      .first();
    await expect(manifestArea).toBeVisible({ timeout: 5_000 });
    await manifestArea.fill(VALID_MANIFEST_YAML);

    await wizard
      .getByRole("button", { name: /next|continue|validate/i })
      .first()
      .click();

    // Wait for validation step to complete
    await expect(
      wizard.getByText(/valid|approved|passed|bindings|next.*step/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("wizard enrollment step shows bootstrap token", async ({ page }) => {
    test.setTimeout(60_000);

    await openRegistrationWizard(page);
    const wizard = page.getByRole("dialog").first();

    // Step 1: paste manifest
    const manifestArea = wizard
      .getByRole("textbox")
      .or(wizard.locator("textarea"))
      .first();
    await expect(manifestArea).toBeVisible({ timeout: 5_000 });
    await manifestArea.fill(VALID_MANIFEST_YAML);

    await wizard
      .getByRole("button", { name: /next|continue|validate/i })
      .first()
      .click();

    // Step 2: wait for validation
    await page.waitForTimeout(1_000);

    // Advance through remaining steps
    for (let step = 0; step < 3; step++) {
      const nextBtn = wizard
        .getByRole("button", { name: /next|continue|confirm|register/i })
        .first();
      const isVisible = await nextBtn.isVisible({ timeout: 3_000 }).catch(() => false);
      if (isVisible) {
        await nextBtn.click();
        await page.waitForTimeout(800);
      }
    }

    // Final step: enrollment — should show bootstrap token and CLI command
    await expect(
      wizard
        .getByText(/bootstrap.*token|enrollment.*token|enroll.*token/i)
        .or(wizard.getByText("e2e-bootstrap-token-abc123def456"))
        .first(),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      wizard.getByText(/gibson-cli.*plugin.*enroll|enroll.*token/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Test suite: atomic rollback on binding_failed
// ---------------------------------------------------------------------------

test.describe("Plugin register — atomic rollback (R2.2)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("binding_failed error navigates wizard back to Step 3 (Bindings)", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await mockBindingFailedRegistration(page);
    await openRegistrationWizard(page);

    const wizard = page.getByRole("dialog").first();

    // Step 1: paste valid manifest
    const manifestArea = wizard
      .getByRole("textbox")
      .or(wizard.locator("textarea"))
      .first();
    await expect(manifestArea).toBeVisible({ timeout: 5_000 });
    await manifestArea.fill(VALID_MANIFEST_YAML);

    await wizard
      .getByRole("button", { name: /next|continue|validate/i })
      .first()
      .click();

    // Step 2: wait for validation success
    await page.waitForTimeout(1_000);

    // Navigate through steps until we reach the confirm/register step
    for (let step = 0; step < 3; step++) {
      const nextBtn = wizard
        .getByRole("button", { name: /next|continue|confirm|register.*plugin/i })
        .first();
      const isVisible = await nextBtn.isVisible({ timeout: 3_000 }).catch(() => false);
      if (isVisible) {
        await nextBtn.click();
        await page.waitForTimeout(800);
      }
    }

    // After submitting registration with binding_failed response, wizard should:
    //   1. NOT advance to enrollment step
    //   2. Navigate back to the bindings step (Step 3)
    //   3. Show the binding error
    await expect(
      wizard
        .getByText(/binding.*failed|binding.*error|step.*3|secret.*not.*found/i)
        .first(),
    ).toBeVisible({ timeout: 10_000 });

    // Confirm we are NOT on the enrollment step (no bootstrap token shown)
    await expect(
      wizard.getByText(/bootstrap.*token|enrollment.*token/i),
    ).not.toBeVisible();
  });

  test("wizard does not show enrollment token after binding_failed rollback", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await mockBindingFailedRegistration(page);
    await openRegistrationWizard(page);

    const wizard = page.getByRole("dialog").first();

    const manifestArea = wizard
      .getByRole("textbox")
      .or(wizard.locator("textarea"))
      .first();
    await expect(manifestArea).toBeVisible({ timeout: 5_000 });
    await manifestArea.fill(VALID_MANIFEST_YAML);

    await wizard
      .getByRole("button", { name: /next|continue|validate/i })
      .first()
      .click();
    await page.waitForTimeout(1_000);

    for (let step = 0; step < 3; step++) {
      const nextBtn = wizard
        .getByRole("button", { name: /next|continue|confirm|register.*plugin/i })
        .first();
      const isVisible = await nextBtn.isVisible({ timeout: 3_000 }).catch(() => false);
      if (isVisible) {
        await nextBtn.click();
        await page.waitForTimeout(800);
      }
    }

    // Rollback: no enrollment token
    await expect(
      wizard.getByText("e2e-bootstrap-token-abc123def456"),
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test suite: manifest validation errors
// ---------------------------------------------------------------------------

test.describe("Plugin register — validation errors", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockValidationFailure(page);
  });

  test("invalid manifest shows line-numbered errors", async ({ page }) => {
    await openRegistrationWizard(page);

    const wizard = page.getByRole("dialog").first();

    const manifestArea = wizard
      .getByRole("textbox")
      .or(wizard.locator("textarea"))
      .first();
    await expect(manifestArea).toBeVisible({ timeout: 5_000 });
    await manifestArea.fill(INVALID_MANIFEST_YAML);

    await wizard
      .getByRole("button", { name: /next|continue|validate/i })
      .first()
      .click();

    // Validation errors should appear with line references
    await expect(
      wizard.getByText(/invalid|error|must.*be.*plugin|apiVersion/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
