/**
 * secrets-backend.spec.ts
 *
 * End-to-end tests for the /dashboard/pages/settings/secrets-backend page.
 *
 * Covers:
 *   - Provider switch (warning dialog appears when switching with existing secrets)
 *   - Probe failure (inline structured error rendered)
 *   - Probe success (structured success state rendered)
 *   - Save flow with each provider type
 *   - Sensitive field isolation (no localStorage/sessionStorage trace)
 *
 * Requirements: 3, R3.1–R3.5.
 *
 * Pre-conditions:
 *   PLAYWRIGHT_BASE_URL, target cluster URL (default: http://localhost:3000)
 *   E2E_ADMIN_EMAIL    , admin user email
 *   E2E_ADMIN_PASSWORD , admin user password
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";

const BACKEND_URL = `${BASE_URL}/dashboard/pages/settings/secrets-backend`;

/** Vault token used in tests, not a real credential. */
const TEST_VAULT_TOKEN = "e2e-vault-token-Xk9mN!";

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

/** Mock: Gibson-hosted Vault currently configured, no existing secrets. */
async function mockGibsonHostedBroker(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();
    if (
      url.includes("GetBrokerConfig") ||
      url.includes("GetTenantBrokerConfig")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          provider: "gibson_vault",
          configured: true,
          hasExistingSecrets: false,
        }),
      });
      return;
    }
    await route.continue();
  });
}

/** Mock: Gibson-hosted Vault with existing secrets (triggers migration warning on switch). */
async function mockGibsonHostedWithSecrets(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();
    if (
      url.includes("GetBrokerConfig") ||
      url.includes("GetTenantBrokerConfig")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          provider: "gibson_vault",
          configured: true,
          hasExistingSecrets: true,
        }),
      });
      return;
    }
    await route.continue();
  });
}

/** Mock probe failure with structured error. */
async function mockProbeFailure(page: Page, errorClass = "auth_failed") {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();
    if (
      url.includes("ProbeBrokerConfig") ||
      url.includes("ProbeSecretsBroker")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          errorClass,
          errorMessage:
            errorClass === "auth_failed"
              ? "Vault returned 403 Forbidden, check token permissions"
              : "Cannot reach vault at https://vault.example.com:8200",
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
        body: JSON.stringify({ provider: "gibson_vault", configured: false }),
      });
      return;
    }
    await route.continue();
  });
}

/** Mock probe success. */
async function mockProbeSuccess(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();
    if (
      url.includes("ProbeBrokerConfig") ||
      url.includes("ProbeSecretsBroker")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          latencyMs: 42,
          message: "Vault connection verified",
        }),
      });
      return;
    }
    if (
      url.includes("SetBrokerConfig") ||
      url.includes("SetTenantBrokerConfig")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ saved: true }),
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
        body: JSON.stringify({ provider: "vault_byo", configured: false }),
      });
      return;
    }
    await route.continue();
  });
}

// ---------------------------------------------------------------------------
// Test suite: page structure
// ---------------------------------------------------------------------------

test.describe("Secrets-backend, page structure", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockGibsonHostedBroker(page);
  });

  test("page renders provider display heading", async ({ page }) => {
    await page.goto(BACKEND_URL);

    await expect(
      page.getByText(/secrets.?backend|broker.*config|provider/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("provider switcher / dropdown is present", async ({ page }) => {
    await page.goto(BACKEND_URL);

    await expect(
      page
        .getByRole("combobox", { name: /provider/i })
        .or(page.getByLabel(/provider/i))
        .or(page.getByRole("button", { name: /provider|vault|aws|gcp|azure/i }))
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Probe button is present", async ({ page }) => {
    await page.goto(BACKEND_URL);

    await expect(
      page.getByRole("button", { name: /probe|test.*connection|verify/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Save button is present", async ({ page }) => {
    await page.goto(BACKEND_URL);

    await expect(
      page.getByRole("button", { name: /^save$|^save.*config/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Test suite: provider switch warning dialog
// ---------------------------------------------------------------------------

test.describe("Secrets-backend, provider switch warning", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockGibsonHostedWithSecrets(page);
  });

  test("switching provider when secrets exist shows migration warning dialog", async ({
    page,
  }) => {
    await page.goto(BACKEND_URL);

    // Find provider switcher
    const switcher = page
      .getByRole("combobox", { name: /provider/i })
      .or(page.getByLabel(/provider/i))
      .first();

    await expect(switcher).toBeVisible({ timeout: 15_000 });

    // Switch provider
    const switcherTagName = await switcher.evaluate((el) =>
      el.tagName.toLowerCase(),
    );

    if (switcherTagName === "select") {
      // Use the first non-Gibson-hosted option available
      const options = await switcher.locator("option").allTextContents();
      const altOption = options.find((o) =>
        /aws|hashicorp|vault.*byo|byo|azure|gcp/i.test(o),
      );
      if (altOption) {
        await switcher.selectOption({ label: altOption });
      }
    } else {
      await switcher.click();
      const option = page
        .getByRole("option", { name: /aws.*secrets|hashicorp|vault|byo/i })
        .first();
      if ((await option.count()) > 0) {
        await option.click();
      }
    }

    // R3.2, warning about no automatic migration must appear
    await expect(
      page
        .getByText(/switch.*provider.*not.*migrat|existing secrets remain/i)
        .or(page.getByRole("dialog").getByText(/migrat|existing/i))
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("warning dialog mentions that existing secrets remain in old provider", async ({
    page,
  }) => {
    await page.goto(BACKEND_URL);

    const switcher = page
      .getByRole("combobox", { name: /provider/i })
      .or(page.getByLabel(/provider/i))
      .first();

    await expect(switcher).toBeVisible({ timeout: 15_000 });

    const switcherTagName = await switcher.evaluate((el) =>
      el.tagName.toLowerCase(),
    );
    if (switcherTagName === "select") {
      const options = await switcher.locator("option").allTextContents();
      const altOption = options.find((o) =>
        /aws|hashicorp|vault.*byo|byo|azure|gcp/i.test(o),
      );
      if (altOption) {
        await switcher.selectOption({ label: altOption });
      }
    } else {
      await switcher.click();
      const option = page
        .getByRole("option", { name: /aws|vault.*byo|hashicorp/i })
        .first();
      if ((await option.count()) > 0) {
        await option.click();
      }
    }

    // The warning must specifically say existing secrets won't migrate
    await expect(
      page.getByText(/existing secrets|old provider|not.*migrat/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Test suite: probe failure
// ---------------------------------------------------------------------------

test.describe("Secrets-backend, probe failure", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockProbeFailure(page, "auth_failed");
  });

  test("probe failure renders structured inline error", async ({ page }) => {
    await page.goto(BACKEND_URL);

    await page
      .getByRole("button", { name: /probe|test.*connection|verify/i })
      .first()
      .click();

    // Structured error must appear inline, not generic "something went wrong"
    await expect(
      page
        .getByText(/auth_failed|403|forbidden|token.*permission|probe.*failed/i)
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("network unreachable probe failure shows network error class", async ({
    page,
  }) => {
    await mockProbeFailure(page, "network_unreachable");
    await page.goto(BACKEND_URL);

    await page
      .getByRole("button", { name: /probe|test.*connection|verify/i })
      .first()
      .click();

    await expect(
      page
        .getByText(/network_unreachable|cannot reach|unreachable|network/i)
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("probe failure does NOT reveal sensitive auth fields in error message", async ({
    page,
  }) => {
    await page.goto(BACKEND_URL);

    // Fill a vault token (sensitive field)
    const tokenInput = page
      .locator('input[type="password"]')
      .or(page.getByLabel(/token|secret|key/i))
      .first();

    if ((await tokenInput.count()) > 0) {
      await tokenInput.fill(TEST_VAULT_TOKEN);
    }

    await page
      .getByRole("button", { name: /probe|test.*connection|verify/i })
      .first()
      .click();

    await page.waitForTimeout(500);

    // The error message must NOT contain the token value
    const bodyText = await page.textContent("body");
    expect(
      (bodyText ?? "").includes(TEST_VAULT_TOKEN),
      `SECURITY REGRESSION: Vault token leaked into error message visible in DOM`,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test suite: probe success
// ---------------------------------------------------------------------------

test.describe("Secrets-backend, probe success", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockProbeSuccess(page);
  });

  test("probe success renders success state", async ({ page }) => {
    await page.goto(BACKEND_URL);

    await page
      .getByRole("button", { name: /probe|test.*connection|verify/i })
      .first()
      .click();

    await expect(
      page
        .getByText(/success|connection.*verified|vault.*verified|probe.*pass/i)
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("save flow succeeds after probe success", async ({ page }) => {
    await page.goto(BACKEND_URL);

    // Probe first
    await page
      .getByRole("button", { name: /probe|test.*connection|verify/i })
      .first()
      .click();

    await expect(
      page.getByText(/success|verified/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Then save
    const saveBtn = page
      .getByRole("button", { name: /^save$|^save.*config/i })
      .first();
    await saveBtn.click();

    // Should show success or navigate
    await expect(
      page.getByText(/saved|configuration.*saved|backend.*updated/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Test suite: sensitive field storage isolation
// ---------------------------------------------------------------------------

test.describe("Secrets-backend, sensitive field isolation (NFR Security)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockProbeSuccess(page);
  });

  test("Vault token must NOT appear in localStorage or sessionStorage", async ({
    page,
  }) => {
    await page.goto(BACKEND_URL);

    const tokenInput = page
      .locator('input[type="password"]')
      .or(page.getByLabel(/token|vault.*token/i))
      .first();

    if ((await tokenInput.count()) === 0) {
      // Provider form may not render a token field by default, skip gracefully
      test.skip();
      return;
    }

    await tokenInput.fill(TEST_VAULT_TOKEN);

    // Submit via Save
    await page
      .getByRole("button", { name: /^save$|^save.*config/i })
      .first()
      .click();

    await page.waitForTimeout(800);

    const storageAnalysis = await page.evaluate((sensitiveValue) => {
      const localSerialized = JSON.stringify(
        Object.fromEntries(
          Array.from({ length: window.localStorage.length }, (_, i) => {
            const k = window.localStorage.key(i)!;
            return [k, window.localStorage.getItem(k) ?? ""];
          }),
        ),
      );
      const sessionSerialized = JSON.stringify(
        Object.fromEntries(
          Array.from({ length: window.sessionStorage.length }, (_, i) => {
            const k = window.sessionStorage.key(i)!;
            return [k, window.sessionStorage.getItem(k) ?? ""];
          }),
        ),
      );
      return {
        inLocalStorage: localSerialized.includes(sensitiveValue),
        inSessionStorage: sessionSerialized.includes(sensitiveValue),
      };
    }, TEST_VAULT_TOKEN);

    expect(
      storageAnalysis.inLocalStorage,
      "SECURITY REGRESSION: Vault token leaked to localStorage",
    ).toBe(false);

    expect(
      storageAnalysis.inSessionStorage,
      "SECURITY REGRESSION: Vault token leaked to sessionStorage",
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test suite: sensitive fields rendered as password inputs
// ---------------------------------------------------------------------------

test.describe("Secrets-backend, sensitive field UI (NFR Usability)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockGibsonHostedBroker(page);
  });

  test("auth credential fields use type=password with autocomplete=off", async ({
    page,
  }) => {
    await page.goto(BACKEND_URL);

    // Find any password-type inputs (token, key, etc.)
    const passwordInputs = page.locator('input[type="password"]');
    const count = await passwordInputs.count();

    for (let i = 0; i < count; i++) {
      const input = passwordInputs.nth(i);
      const autocomplete = await input.getAttribute("autocomplete");
      expect(
        autocomplete,
        `Sensitive input at index ${i} must have autocomplete=off`,
      ).toBe("off");
    }
  });
});
