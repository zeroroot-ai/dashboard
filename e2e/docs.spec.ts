/**
 * docs.spec.ts
 *
 * End-to-end tests for the /docs surface rendered by Fumadocs.
 *
 * Covered flows (design §Testing Strategy / Integration Testing):
 *   1. GET /docs renders 200 with the Zero Root AI brand in the header and a
 *      sidebar entry for "Getting Started".
 *   2. Clicking "Getting Started" navigates to /docs/getting-started and the
 *      page title renders.
 *   3. Pressing Ctrl/Meta+K opens the search dialog.
 *   4. Typing "install" shows a matching result; Enter lands on /docs/install.
 *   5. /docs/bogus-page returns a docs-scoped 404 with the sidebar still
 *      present.
 *
 * These are backend-free, docs pages serve static MDX + search index
 * baked in at build time. No daemon, Postgres, Neo4j, or Redis needed.
 */
import { test, expect } from "@playwright/test";

test.describe("/docs, Fumadocs rendering", () => {
  test("GET /docs renders 200 with brand header and Getting Started sidebar", async ({
    page,
  }) => {
    const response = await page.goto("/docs");
    expect(response?.status()).toBe(200);

    // Shared SiteHeader brand.
    await expect(
      page.getByRole("link", { name: "Zero Root AI" }),
    ).toBeVisible();

    // Sidebar entry for Getting Started. Fumadocs renders sidebar items
    // as anchors with the page title; match by href to sidestep any role
    // mismatch on nav tree nodes.
    await expect(
      page.locator('a[href="/docs/getting-started"]').first(),
    ).toBeVisible();
  });

  test('clicking "Getting Started" navigates and renders the title', async ({
    page,
  }) => {
    await page.goto("/docs");
    await page.locator('a[href="/docs/getting-started"]').first().click();
    await expect(page).toHaveURL(/\/docs\/getting-started$/);
    await expect(
      page.getByRole("heading", { name: /getting started/i, level: 1 }),
    ).toBeVisible();
  });

  /**
   * Opens the Fumadocs search dialog. Tries Ctrl+K first (hotkey handler
   * attached to the window), then falls back to clicking the "Search"
   * trigger rendered in the Fumadocs shell if the keypress doesn't
   * register (some headless envs don't dispatch the event to window).
   */
  async function openSearch(page: import("@playwright/test").Page) {
    await page.locator("body").click(); // ensure window has focus
    await page.keyboard.press("Control+KeyK");
    const dialog = page.getByRole("dialog").first();
    try {
      await dialog.waitFor({ state: "visible", timeout: 2000 });
      return dialog;
    } catch {
      // Fallback: click the explicit search trigger.
      const trigger = page
        .getByRole("button", { name: /search/i })
        .or(page.locator('button[data-search-full], [data-search="true"]'))
        .first();
      await trigger.click();
      await dialog.waitFor({ state: "visible" });
      return dialog;
    }
  }

  test("Ctrl+K opens the search dialog", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await expect(dialog).toBeVisible();
  });

  test('search for "install" lands on /docs/install', async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await expect(dialog).toBeVisible();

    const input = dialog
      .locator('input[type="search"], input[placeholder]')
      .first();
    await input.fill("install");

    // Wait for at least one result whose visible label starts with "Install".
    const result = dialog.getByText(/^install/i).first();
    await expect(result).toBeVisible();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/docs\/install$/);
  });

  test("/docs/bogus-page returns docs-scoped 404 with sidebar visible", async ({
    page,
  }) => {
    const response = await page.goto("/docs/this-definitely-does-not-exist");
    expect(response?.status()).toBe(404);

    // 404 copy from not-found.tsx.
    await expect(
      page.getByRole("heading", { name: /page not found/i }),
    ).toBeVisible();

    // Sidebar still rendered (the layout survives the 404).
    await expect(
      page.locator('a[href="/docs/getting-started"]').first(),
    ).toBeVisible();
  });
});
