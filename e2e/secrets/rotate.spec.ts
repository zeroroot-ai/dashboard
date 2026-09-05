/**
 * secrets/rotate.spec.ts
 *
 * End-to-end tests for the secret rotation flow.
 *
 * Assertions:
 *   - Rotate button opens the RotateModal.
 *   - New value field is password-type with autocomplete=off.
 *   - Submitting the rotation calls the RotateSecret RPC.
 *   - Version field increments after a successful rotation.
 *   - Storage isolation (same rules as create.spec.ts, no value in storage).
 *
 * Requirements: 1.1, NFR Security.
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

// URL for the detail page of a specific secret
const SECRET_ID = "secret-001";
const SECRET_DETAIL_URL = `${BASE_URL}/dashboard/pages/settings/secrets/${SECRET_ID}`;

/** Distinctive value for rotation tests, never a real credential. */
const ROTATE_SECRET_VALUE = "e2e-rotated-value-Yz4kL8wS!2m";

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
 * Mock all RPCs needed for the secret detail page, including rotate.
 * The initial GetSecret returns version 3; after rotation, version 4.
 */
async function mockSecretDetailWithRotate(page: Page) {
  let version = 3;

  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();

    if (url.includes("GetSecret")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: SECRET_ID,
          name: "anthropic_api_key",
          category: "provider_config",
          version,
          createdAt: "2026-01-01T00:00:00Z",
          createdBy: "user-e2e-001",
          lastRotatedAt: "2026-04-01T00:00:00Z",
          lastAccessedAt: "2026-04-15T00:00:00Z",
          pluginAssociations: [
            { pluginId: "plugin-gitlab", pluginName: "GitLab" },
          ],
        }),
      });
      return;
    }

    if (url.includes("RotateSecret")) {
      // Increment version to simulate rotation
      version = version + 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: SECRET_ID,
          name: "anthropic_api_key",
          category: "provider_config",
          version,
          // NOTE: no 'value' field in response (NFR Security, R8.3)
          lastRotatedAt: new Date().toISOString(),
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

    await route.continue();
  });
}

// ---------------------------------------------------------------------------
// Test suite: rotate modal
// ---------------------------------------------------------------------------

test.describe("Secret rotate, modal", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockSecretDetailWithRotate(page);
  });

  test("detail page renders Rotate button", async ({ page }) => {
    await page.goto(SECRET_DETAIL_URL);

    await expect(
      page.getByRole("button", { name: /rotate/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("clicking Rotate opens the rotation modal", async ({ page }) => {
    await page.goto(SECRET_DETAIL_URL);

    await page.getByRole("button", { name: /rotate/i }).first().click();

    // Modal / dialog should appear
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Modal should have a heading related to rotation
    await expect(
      dialog.getByText(/rotate.*secret|new.*value|update.*secret/i).first(),
    ).toBeVisible();
  });

  test("rotation modal value input is type=password with autocomplete=off", async ({
    page,
  }) => {
    await page.goto(SECRET_DETAIL_URL);
    await page.getByRole("button", { name: /rotate/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const valueInput = dialog.locator('input[type="password"]').first();
    await expect(valueInput).toBeVisible();

    const inputType = await valueInput.getAttribute("type");
    expect(inputType).toBe("password");

    const autocomplete = await valueInput.getAttribute("autocomplete");
    expect(autocomplete).toBe("off");
  });

  test("submitting rotation increments the version number", async ({
    page,
  }) => {
    await page.goto(SECRET_DETAIL_URL);

    // Confirm initial version is 3
    await expect(page.getByText(/version.*3|v3/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Open rotate modal
    await page.getByRole("button", { name: /rotate/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Fill the new value
    const valueInput = dialog.locator('input[type="password"]').first();
    await valueInput.fill(ROTATE_SECRET_VALUE);

    // Submit the rotation
    const confirmBtn = dialog
      .getByRole("button", { name: /rotate|confirm|update|save/i })
      .first();
    await confirmBtn.click();

    // Wait for rotation to complete and version to update
    await page.waitForTimeout(1_000);

    // Version should now be 4 (incremented by 1 on rotation)
    await expect(page.getByText(/version.*4|v4/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("cancel button closes rotation modal without submitting", async ({
    page,
  }) => {
    await page.goto(SECRET_DETAIL_URL);
    await page.getByRole("button", { name: /rotate/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.getByRole("button", { name: /cancel/i }).click();

    await expect(page.getByRole("dialog")).not.toBeVisible();
  });

  test("Escape key closes rotation modal", async ({ page }) => {
    await page.goto(SECRET_DETAIL_URL);
    await page.getByRole("button", { name: /rotate/i }).first().click();

    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Security: storage isolation during rotation
// ---------------------------------------------------------------------------

test.describe("Secret rotate, storage isolation (NFR Security)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockSecretDetailWithRotate(page);
  });

  test("rotated value must NOT appear in localStorage or sessionStorage", async ({
    page,
  }) => {
    await page.goto(SECRET_DETAIL_URL);
    await page.getByRole("button", { name: /rotate/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Fill the new value
    await dialog
      .locator('input[type="password"]')
      .first()
      .fill(ROTATE_SECRET_VALUE);

    // Submit rotation
    await dialog
      .getByRole("button", { name: /rotate|confirm|update|save/i })
      .first()
      .click();

    await page.waitForTimeout(1_000);

    const storageAnalysis = await page.evaluate((secretValue) => {
      const localItems: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) localItems[key] = window.localStorage.getItem(key) ?? "";
      }
      const sessionItems: Record<string, string> = {};
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key) sessionItems[key] = window.sessionStorage.getItem(key) ?? "";
      }
      return {
        inLocalStorage: JSON.stringify(localItems).includes(secretValue),
        inSessionStorage: JSON.stringify(sessionItems).includes(secretValue),
        base64InLocalStorage: JSON.stringify(localItems).includes(
          btoa(secretValue),
        ),
        base64InSessionStorage: JSON.stringify(sessionItems).includes(
          btoa(secretValue),
        ),
      };
    }, ROTATE_SECRET_VALUE);

    expect(
      storageAnalysis.inLocalStorage,
      "SECURITY REGRESSION: Rotated secret value leaked to localStorage",
    ).toBe(false);

    expect(
      storageAnalysis.inSessionStorage,
      "SECURITY REGRESSION: Rotated secret value leaked to sessionStorage",
    ).toBe(false);

    expect(
      storageAnalysis.base64InLocalStorage,
      "SECURITY REGRESSION: Base64-encoded rotated value found in localStorage",
    ).toBe(false);

    expect(
      storageAnalysis.base64InSessionStorage,
      "SECURITY REGRESSION: Base64-encoded rotated value found in sessionStorage",
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Security: no "Show value" affordance on detail page
// ---------------------------------------------------------------------------

test.describe("Secret detail, no value reveal (NFR Security R1.2)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockSecretDetailWithRotate(page);
  });

  test("detail page has no 'Show value' or 'Reveal value' button", async ({
    page,
  }) => {
    await page.goto(SECRET_DETAIL_URL);

    // Wait for the page to fully load
    await expect(
      page.getByRole("button", { name: /rotate/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // R1.2, no "Show value" affordance
    await expect(
      page.getByRole("button", { name: /show.?value|reveal.?value|view.?value/i }),
    ).not.toBeVisible();

    await expect(
      page.getByText(/show.?value|reveal.?value|view.?value/i),
    ).not.toBeVisible();
  });
});
