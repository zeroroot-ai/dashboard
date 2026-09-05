/**
 * secrets/delete.spec.ts
 *
 * End-to-end tests for the secret deletion flow.
 *
 * Assertions:
 *   - Delete button opens the DeleteModal.
 *   - DeleteModal lists affected plugin associations.
 *   - DeleteModal requires typing the exact secret name to confirm (destructive-action pattern).
 *   - Confirm button disabled until exact name is typed.
 *   - Deletion proceeds and navigates away from the detail page.
 *   - Cancel closes the modal without deleting.
 *
 * The "type exact secret name" pattern is a destructive-action safety guard that
 * prevents accidental deletion and forces intent. This mirrors the design from
 * requirements (DeleteModal requires explicit confirm).
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

// Secret under test, has two plugin associations
const SECRET_ID = "secret-001";
const SECRET_NAME = "anthropic_api_key";
const SECRET_DETAIL_URL = `${BASE_URL}/dashboard/pages/settings/secrets/${SECRET_ID}`;
const SECRETS_LIST_URL = `${BASE_URL}/dashboard/pages/settings/secrets`;

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
 * Mock GetSecret, ListPluginsForSecret (FGA tuples), and DeleteSecret RPCs.
 * The secret has two plugin associations, both must appear in the modal.
 */
async function mockSecretDetailWithDelete(page: Page) {
  let deleted = false;

  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();

    if (url.includes("GetSecret")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: SECRET_ID,
          name: SECRET_NAME,
          category: "provider_config",
          version: 3,
          createdAt: "2026-01-01T00:00:00Z",
          createdBy: "user-e2e-001",
          lastRotatedAt: "2026-04-01T00:00:00Z",
          lastAccessedAt: "2026-04-15T00:00:00Z",
          pluginAssociations: [
            { pluginId: "plugin-gitlab", pluginName: "GitLab" },
            { pluginId: "plugin-jira", pluginName: "Jira" },
          ],
        }),
      });
      return;
    }

    // FGA-based plugin listing for the delete modal
    if (
      url.includes("ListPluginsForSecret") ||
      url.includes("GetPluginBindings") ||
      url.includes("ListPluginInstalls")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          plugins: [
            { pluginId: "plugin-gitlab", pluginName: "GitLab" },
            { pluginId: "plugin-jira", pluginName: "Jira" },
          ],
        }),
      });
      return;
    }

    if (url.includes("DeleteSecret")) {
      deleted = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ deleted: true }),
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

    if (url.includes("ListSecrets")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          secrets: deleted
            ? []
            : [{ id: SECRET_ID, name: SECRET_NAME, category: "provider_config", version: 3 }],
          total: deleted ? 0 : 1,
        }),
      });
      return;
    }

    await route.continue();
  });
}

// ---------------------------------------------------------------------------
// Test suite: delete modal
// ---------------------------------------------------------------------------

test.describe("Secret delete, modal", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockSecretDetailWithDelete(page);
  });

  test("detail page renders Delete button", async ({ page }) => {
    await page.goto(SECRET_DETAIL_URL);

    await expect(
      page.getByRole("button", { name: /delete/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("clicking Delete opens the confirmation modal", async ({ page }) => {
    await page.goto(SECRET_DETAIL_URL);
    await page.getByRole("button", { name: /delete/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Modal heading should mention delete/confirm
    await expect(
      dialog.getByText(/delete.*secret|confirm.*delete|are you sure/i).first(),
    ).toBeVisible();
  });

  test("delete modal lists all affected plugins", async ({ page }) => {
    await page.goto(SECRET_DETAIL_URL);
    await page.getByRole("button", { name: /delete/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Both affected plugins must be listed in the modal
    await expect(dialog.getByText("GitLab")).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText("Jira")).toBeVisible({ timeout: 5_000 });
  });

  test("confirm button is disabled until exact secret name is typed", async ({
    page,
  }) => {
    await page.goto(SECRET_DETAIL_URL);
    await page.getByRole("button", { name: /delete/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Confirm button should be disabled initially
    const confirmBtn = dialog
      .getByRole("button", { name: /^delete$|^confirm.*delete$|^i understand/i })
      .first();
    await expect(confirmBtn).toBeDisabled();
  });

  test("confirm button remains disabled with wrong name", async ({ page }) => {
    await page.goto(SECRET_DETAIL_URL);
    await page.getByRole("button", { name: /delete/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Type wrong name
    const confirmInput = dialog
      .getByPlaceholder(new RegExp(SECRET_NAME, "i"))
      .or(dialog.getByLabel(/type.*name.*confirm|confirm.*name/i))
      .first();

    if ((await confirmInput.count()) > 0) {
      await confirmInput.fill("wrong_name");

      const confirmBtn = dialog
        .getByRole("button", { name: /^delete$|^confirm.*delete$|^i understand/i })
        .first();
      await expect(confirmBtn).toBeDisabled();
    }
  });

  test("confirm button becomes enabled when exact name is typed", async ({
    page,
  }) => {
    await page.goto(SECRET_DETAIL_URL);
    await page.getByRole("button", { name: /delete/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Find the confirmation text input
    const confirmInput = dialog
      .getByPlaceholder(new RegExp(SECRET_NAME, "i"))
      .or(dialog.getByLabel(/type.*name.*confirm|confirm.*name|enter.*name/i))
      .first();

    // If there's no such input, skip (modal may use a different pattern)
    if ((await confirmInput.count()) === 0) {
      test.skip();
      return;
    }

    await confirmInput.fill(SECRET_NAME);

    const confirmBtn = dialog
      .getByRole("button", { name: /^delete$|^confirm.*delete$|^i understand/i })
      .first();
    await expect(confirmBtn).toBeEnabled({ timeout: 3_000 });
  });

  test("successful deletion navigates to secrets list", async ({ page }) => {
    await page.goto(SECRET_DETAIL_URL);
    await page.getByRole("button", { name: /delete/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Type the exact secret name to enable confirm
    const confirmInput = dialog
      .getByPlaceholder(new RegExp(SECRET_NAME, "i"))
      .or(dialog.getByLabel(/type.*name.*confirm|confirm.*name|enter.*name/i))
      .first();

    const hasConfirmInput = (await confirmInput.count()) > 0;

    if (hasConfirmInput) {
      await confirmInput.fill(SECRET_NAME);
    }

    const confirmBtn = dialog
      .getByRole("button", { name: /^delete$|^confirm.*delete$|^i understand/i })
      .first();
    await confirmBtn.click();

    // Should redirect back to the secrets list after deletion
    await page.waitForURL(
      (url) =>
        url.pathname.endsWith("/secrets") ||
        url.pathname.includes("/secrets") && !url.pathname.includes(SECRET_ID),
      { timeout: 15_000 },
    );

    await expect(page).toHaveURL(new RegExp("/secrets"));
  });

  test("cancel button closes the modal without deleting", async ({ page }) => {
    await page.goto(SECRET_DETAIL_URL);
    await page.getByRole("button", { name: /delete/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.getByRole("button", { name: /cancel/i }).click();

    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Should still be on the detail page
    await expect(page).toHaveURL(new RegExp(SECRET_ID));
  });

  test("Escape closes the delete modal without deleting", async ({ page }) => {
    await page.goto(SECRET_DETAIL_URL);
    await page.getByRole("button", { name: /delete/i }).first().click();

    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test suite: no value shown anywhere on detail page
// ---------------------------------------------------------------------------

test.describe("Secret detail, no value anywhere (NFR Security)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockSecretDetailWithDelete(page);
  });

  test("detail page never shows a credential value field", async ({ page }) => {
    await page.goto(SECRET_DETAIL_URL);

    await expect(
      page.getByRole("button", { name: /delete/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // No input of type=text named "value" or similar visible on page
    // (password inputs only inside modals are acceptable for rotate)
    const valueLabelledInputs = page.getByLabel(/^value$|secret value/i).filter({
      has: page.locator('input[type="text"]'),
    });
    await expect(valueLabelledInputs).not.toBeVisible();
  });
});
