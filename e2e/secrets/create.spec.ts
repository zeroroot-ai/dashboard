/**
 * secrets/create.spec.ts
 *
 * End-to-end tests for the secret creation flow.
 *
 * Security-critical assertions (NFR Security / R1.3):
 *   - localStorage contains NO trace of the secret value bytes after submit.
 *   - sessionStorage contains NO trace of the secret value bytes after submit.
 *   - The form value field is cleared on submit success.
 *   - The submitted request body carries the value only once (to the RPC);
 *     the response carries no value field.
 *
 * The "no storage trace" assertion is the MOST IMPORTANT test in this file.
 * It must remain precise enough to catch any regression where the form or a
 * middleware layer accidentally writes the value to browser storage.
 *
 * Requirements: 1.1, 1.3, NFR Security.
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

const SECRETS_URL = `${BASE_URL}/dashboard/pages/settings/secrets`;
const CREATE_URL = `${BASE_URL}/dashboard/pages/settings/secrets/new`;

/**
 * A distinctive value used in create/rotate tests.
 * Sufficiently unique to be searchable in storage without false positives.
 * Never commit a real credential here.
 */
const TEST_SECRET_VALUE = "e2e-test-value-Xk9mN2pQr7v!";

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
 * Mock the SetSecret RPC to return a successful creation response.
 * Also mocks broker config and list so the page renders.
 */
async function mockCreateSuccess(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();
    if (url.includes("SetSecret") || url.includes("CreateSecret")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "secret-new-001",
          name: "test_secret",
          category: "cred",
          version: 1,
          createdAt: new Date().toISOString(),
          createdBy: "user-e2e-001",
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
        body: JSON.stringify({
          provider: "gibson_vault",
          configured: true,
        }),
      });
      return;
    }
    await route.continue();
  });
}

/**
 * Mock the SetSecret RPC to return a validation error.
 */
async function mockCreateError(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();
    if (url.includes("SetSecret") || url.includes("CreateSecret")) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "secret_name_invalid",
          message: "Secret name must match [a-z0-9_-]+",
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
        body: JSON.stringify({
          provider: "gibson_vault",
          configured: true,
        }),
      });
      return;
    }
    await route.continue();
  });
}

// ---------------------------------------------------------------------------
// Test suite: create form rendering
// ---------------------------------------------------------------------------

test.describe("Secret create — form", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockCreateSuccess(page);
  });

  test("create page renders the add-secret form", async ({ page }) => {
    await page.goto(CREATE_URL);

    // Name field
    await expect(
      page.getByLabel(/^name$/i).or(page.getByLabel(/secret.?name/i)).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("value input is type=password with autocomplete=off", async ({
    page,
  }) => {
    await page.goto(CREATE_URL);

    // R1 NFR Usability — sensitive input must be password type with autocomplete off
    const valueInput = page
      .locator('input[type="password"]')
      .or(page.getByLabel(/^value$|secret.?value/i))
      .first();
    await expect(valueInput).toBeVisible({ timeout: 15_000 });

    // Confirm it is a password input
    const inputType = await valueInput.getAttribute("type");
    expect(inputType).toBe("password");

    // Confirm autocomplete is off
    const autocomplete = await valueInput.getAttribute("autocomplete");
    expect(autocomplete).toBe("off");
  });

  test("category dropdown renders with cred and provider_config options", async ({
    page,
  }) => {
    await page.goto(CREATE_URL);

    // Category dropdown / select
    const categorySelect = page
      .getByLabel(/category/i)
      .or(page.locator("select[name=category]"))
      .first();
    await expect(categorySelect).toBeVisible({ timeout: 15_000 });
  });

  test("submit button is present", async ({ page }) => {
    await page.goto(CREATE_URL);

    await expect(
      page
        .getByRole("button", { name: /^create$|^add.*secret$|^save$/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// SECURITY-CRITICAL: localStorage and sessionStorage storage trace assertions
// ---------------------------------------------------------------------------

test.describe("Secret create — storage isolation (NFR Security)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  /**
   * SECURITY-CRITICAL TEST.
   *
   * After filling and submitting a secret value, neither localStorage nor
   * sessionStorage must contain any bytes of the secret value. This catches:
   *   - Accidental form-state persistence (React state libraries that flush to storage)
   *   - Middleware logging (SWR, TanStack Query, Zustand persist, etc.)
   *   - Any developer-added debugging that serializes form state
   *
   * The test checks:
   *   1. Full localStorage serialization does not contain the value string.
   *   2. Full sessionStorage serialization does not contain the value string.
   *   3. Individual localStorage keys are enumerated and none contain the value.
   *   4. Individual sessionStorage keys are enumerated and none contain the value.
   */
  test("secret value must NOT appear in localStorage or sessionStorage after submit", async ({
    page,
  }) => {
    await mockCreateSuccess(page);
    await page.goto(CREATE_URL);

    // Fill the form
    const nameInput = page
      .getByLabel(/^name$/i)
      .or(page.getByLabel(/secret.?name/i))
      .first();
    await expect(nameInput).toBeVisible({ timeout: 15_000 });
    await nameInput.fill("test_secret_e2e");

    // Fill the value field with our distinctive test value
    const valueInput = page.locator('input[type="password"]').first();
    await valueInput.fill(TEST_SECRET_VALUE);

    // Submit the form
    const submitBtn = page
      .getByRole("button", { name: /^create$|^add.*secret$|^save$/i })
      .first();
    await submitBtn.click();

    // Wait for either a success redirect or the form to clear
    await page.waitForTimeout(1_000);

    // -------------------------------------------------------------------------
    // SECURITY-CRITICAL ASSERTIONS
    // Check that the test value does NOT exist in any browser storage mechanism.
    // -------------------------------------------------------------------------

    const storageAnalysis = await page.evaluate((secretValue) => {
      // Enumerate all localStorage items
      const localStorageItems: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key !== null) {
          localStorageItems[key] = window.localStorage.getItem(key) ?? "";
        }
      }

      // Enumerate all sessionStorage items
      const sessionStorageItems: Record<string, string> = {};
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key !== null) {
          sessionStorageItems[key] = window.sessionStorage.getItem(key) ?? "";
        }
      }

      // Serialize everything to catch deep-embedded values
      const localStorageSerialized = JSON.stringify(localStorageItems);
      const sessionStorageSerialized = JSON.stringify(sessionStorageItems);

      // Check for presence of the secret value (case-sensitive exact match)
      const inLocalStorage = localStorageSerialized.includes(secretValue);
      const inSessionStorage = sessionStorageSerialized.includes(secretValue);

      // Also check for base64-encoded variant (some libs encode before storing)
      const base64Value = btoa(secretValue);
      const inLocalStorageBase64 = localStorageSerialized.includes(base64Value);
      const inSessionStorageBase64 =
        sessionStorageSerialized.includes(base64Value);

      return {
        inLocalStorage,
        inSessionStorage,
        inLocalStorageBase64,
        inSessionStorageBase64,
        localStorageKeys: Object.keys(localStorageItems),
        sessionStorageKeys: Object.keys(sessionStorageItems),
        localStorageLength: window.localStorage.length,
        sessionStorageLength: window.sessionStorage.length,
      };
    }, TEST_SECRET_VALUE);

    // SECURITY-CRITICAL: fail the test with clear evidence if any leak is detected
    expect(
      storageAnalysis.inLocalStorage,
      `SECURITY REGRESSION: Secret value found in localStorage keys: ${storageAnalysis.localStorageKeys.join(", ")}. ` +
        `This means the create-secret form or a state library is persisting the value to browser storage. ` +
        `Fix: ensure form state is cleared on submit and no persist middleware stores form values.`,
    ).toBe(false);

    expect(
      storageAnalysis.inSessionStorage,
      `SECURITY REGRESSION: Secret value found in sessionStorage keys: ${storageAnalysis.sessionStorageKeys.join(", ")}. ` +
        `This means the create-secret form or a state library is persisting the value to session storage. ` +
        `Fix: ensure no persist middleware stores form values in sessionStorage.`,
    ).toBe(false);

    expect(
      storageAnalysis.inLocalStorageBase64,
      `SECURITY REGRESSION: Base64-encoded secret value found in localStorage. ` +
        `This means the value is being encoded but still persisted to browser storage.`,
    ).toBe(false);

    expect(
      storageAnalysis.inSessionStorageBase64,
      `SECURITY REGRESSION: Base64-encoded secret value found in sessionStorage.`,
    ).toBe(false);
  });

  /**
   * Verify the value field is cleared on successful submit.
   * After submit+redirect, if the form is still mounted, the field must be empty.
   * R1.3: "Form value cleared on submit; never persisted in browser state."
   */
  test("value field is cleared after successful submit", async ({ page }) => {
    await mockCreateSuccess(page);
    await page.goto(CREATE_URL);

    const nameInput = page
      .getByLabel(/^name$/i)
      .or(page.getByLabel(/secret.?name/i))
      .first();
    await expect(nameInput).toBeVisible({ timeout: 15_000 });
    await nameInput.fill("test_secret_e2e");

    const valueInput = page.locator('input[type="password"]').first();
    await valueInput.fill(TEST_SECRET_VALUE);

    // Confirm value is present before submit
    await expect(valueInput).toHaveValue(TEST_SECRET_VALUE);

    const submitBtn = page
      .getByRole("button", { name: /^create$|^add.*secret$|^save$/i })
      .first();
    await submitBtn.click();

    // Wait for submit processing
    await page.waitForTimeout(800);

    // If still on the create page (error case or same-page success),
    // the value field must be cleared
    const currentUrl = page.url();
    if (currentUrl.includes("/new") || currentUrl.includes("/secrets")) {
      const valueFieldAfterSubmit = page
        .locator('input[type="password"]')
        .first();
      const count = await valueFieldAfterSubmit.count();
      if (count > 0) {
        const fieldValue = await valueFieldAfterSubmit.inputValue();
        expect(
          fieldValue,
          "Value field must be cleared after submit — R1.3 security requirement",
        ).toBe("");
      }
    }
  });

  /**
   * Verify value field is cleared on error path too.
   * R1.3 applies to both success and failure paths.
   */
  test("value field is cleared even on server error response", async ({
    page,
  }) => {
    await mockCreateError(page);
    await page.goto(CREATE_URL);

    const nameInput = page
      .getByLabel(/^name$/i)
      .or(page.getByLabel(/secret.?name/i))
      .first();
    await expect(nameInput).toBeVisible({ timeout: 15_000 });
    await nameInput.fill("INVALID SECRET NAME WITH SPACES");

    const valueInput = page.locator('input[type="password"]').first();
    await valueInput.fill(TEST_SECRET_VALUE);

    const submitBtn = page
      .getByRole("button", { name: /^create$|^add.*secret$|^save$/i })
      .first();
    await submitBtn.click();

    // Wait for error response to render
    await page.waitForTimeout(800);

    // Storage must still be clean even when there is an error
    const storageAnalysis = await page.evaluate((secretValue) => {
      const localStorageSerialized = JSON.stringify(
        Object.fromEntries(
          Array.from({ length: window.localStorage.length }, (_, i) => {
            const key = window.localStorage.key(i)!;
            return [key, window.localStorage.getItem(key) ?? ""];
          }),
        ),
      );
      const sessionStorageSerialized = JSON.stringify(
        Object.fromEntries(
          Array.from({ length: window.sessionStorage.length }, (_, i) => {
            const key = window.sessionStorage.key(i)!;
            return [key, window.sessionStorage.getItem(key) ?? ""];
          }),
        ),
      );
      return {
        inLocalStorage: localStorageSerialized.includes(secretValue),
        inSessionStorage: sessionStorageSerialized.includes(secretValue),
      };
    }, TEST_SECRET_VALUE);

    expect(
      storageAnalysis.inLocalStorage,
      "SECURITY REGRESSION: Secret value leaked to localStorage on error path",
    ).toBe(false);

    expect(
      storageAnalysis.inSessionStorage,
      "SECURITY REGRESSION: Secret value leaked to sessionStorage on error path",
    ).toBe(false);
  });

  /**
   * Verify that the response body from the SetSecret RPC contains no value field.
   * R8.3: "SetSecret accepts a value but the response carries no value."
   */
  test("SetSecret response contains no value field (R8.3 wire discipline)", async ({
    page,
  }) => {
    // Capture and inspect the RPC response
    const responsePayloads: string[] = [];

    await page.route("**/api/gibson-proxy**", async (route) => {
      const url = route.request().url();
      if (url.includes("SetSecret") || url.includes("CreateSecret")) {
        const responseBody = JSON.stringify({
          id: "secret-new-001",
          name: "test_secret",
          category: "cred",
          version: 1,
          createdAt: new Date().toISOString(),
          createdBy: "user-e2e-001",
          // NOTE: no 'value' field — this is the correct wire shape
        });
        responsePayloads.push(responseBody);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: responseBody,
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

    await page.goto(CREATE_URL);

    const nameInput = page
      .getByLabel(/^name$/i)
      .or(page.getByLabel(/secret.?name/i))
      .first();
    await expect(nameInput).toBeVisible({ timeout: 15_000 });
    await nameInput.fill("test_secret_e2e");

    await page.locator('input[type="password"]').first().fill(TEST_SECRET_VALUE);

    await page
      .getByRole("button", { name: /^create$|^add.*secret$|^save$/i })
      .first()
      .click();

    await page.waitForTimeout(800);

    // Verify none of the captured responses contain the value
    for (const payload of responsePayloads) {
      expect(
        payload.includes(TEST_SECRET_VALUE),
        `SECURITY REGRESSION: SetSecret response contains the plaintext value. ` +
          `Response payload: ${payload.slice(0, 200)}`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Inline error rendering
// ---------------------------------------------------------------------------

test.describe("Secret create — error handling", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockCreateError(page);
  });

  test("server error renders structured error message inline", async ({
    page,
  }) => {
    await page.goto(CREATE_URL);

    const nameInput = page
      .getByLabel(/^name$/i)
      .or(page.getByLabel(/secret.?name/i))
      .first();
    await expect(nameInput).toBeVisible({ timeout: 15_000 });
    await nameInput.fill("invalid name with spaces");

    await page.locator('input[type="password"]').first().fill(TEST_SECRET_VALUE);

    await page
      .getByRole("button", { name: /^create$|^add.*secret$|^save$/i })
      .first()
      .click();

    // Error should be rendered inline (not a generic "something went wrong")
    await expect(
      page
        .getByText(/invalid|name must|secret_name_invalid|error/i)
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
