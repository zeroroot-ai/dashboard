/**
 * Sidebar nav smoke, assert every visible sidebar link resolves to a
 * page rendered inside the authenticated app shell.
 *
 * Regression guard for issue #143, the original Teams/Security Policy
 * 404 bug came from the sidebar pointing at URLs that didn't exist
 * inside the `app/dashboard/(auth)/` shell. A failing nav-smoke
 * indicates either:
 *   (a) a sidebar link points at a non-existent route, or
 *   (b) a sidebar link points at a route that exists but renders
 *       outside the authenticated app shell (no AppSidebar in DOM).
 *
 * Auth + data wiring: same TEST_AUTH_BYPASS path as e2e/visual/
 * auth-routes.spec.ts. Skips gracefully when the env var is not set.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { encodeTestSession } from "@/src/lib/test-fixtures/encode-session";

const MOCK_USER = {
  sub: "test-user-nav-smoke",
  name: "Nav Smoke",
  email: "nav-smoke@test.zeroroot.local",
};
const MOCK_TENANT_ID = "tenant-nav-smoke";

async function setAuthSession(context: BrowserContext) {
  const { cookieName, cookieValue } = await encodeTestSession(MOCK_USER);
  await context.addCookies([
    {
      name: cookieName,
      value: cookieValue,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
    {
      name: "gibson_active_tenant",
      value: MOCK_TENANT_ID,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      sameSite: "Lax",
    },
  ]);
}

async function stubDataLayer(page: Page) {
  await page.route("**/api/auth/my-memberships**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeTenantId: MOCK_TENANT_ID,
        byTenant: { [MOCK_TENANT_ID]: { role: "tenant_admin" } },
      }),
    });
  });
  await page.route("**/api/gibson-proxy**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}

test.describe("sidebar nav smoke", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "smoke runs on a single browser",
  );
  test.skip(
    () => process.env.TEST_AUTH_BYPASS !== "1",
    "nav smoke requires TEST_AUTH_BYPASS=1",
  );

  test("every sidebar link reaches a 200 page inside the authenticated app shell", async ({
    page,
    context,
  }) => {
    await setAuthSession(context);
    await stubDataLayer(page);

    const dashboardResponse = await page.goto("/dashboard");
    expect(dashboardResponse?.status(), "/dashboard initial load").toBeLessThan(400);

    // Wait for the sidebar to mount before we enumerate it.
    await expect(page.locator('[data-sidebar="sidebar"]')).toBeVisible();

    // Collect every <a> with an href that lives inside the sidebar menu.
    // We resolve to a unique list because some links repeat in the
    // collapsible dropdown variant for icon-only sidebars.
    const hrefs = await page
      .locator('[data-sidebar="menu"] a[href]')
      .evaluateAll((nodes) =>
        Array.from(
          new Set(
            nodes
              .map((node) => (node as HTMLAnchorElement).getAttribute("href"))
              .filter(
                (href): href is string =>
                  typeof href === "string" &&
                  href.startsWith("/") &&
                  !href.startsWith("//"),
              ),
          ),
        ),
      );

    expect(hrefs.length, "sidebar exposed at least one link").toBeGreaterThan(0);

    const failures: string[] = [];
    for (const href of hrefs) {
      const response = await page.goto(href, { waitUntil: "domcontentloaded" });
      const status = response?.status() ?? 0;
      if (status >= 400) {
        failures.push(`${href} → HTTP ${status}`);
        continue;
      }
      // The authenticated app shell is identified by the AppSidebar
      // mounting under [data-sidebar="sidebar"]. Pages rendered outside
      // app/dashboard/(auth)/layout.tsx, e.g. left in the bare
      // /(dashboard)/ segment group, will reach the DOM without it.
      const shellVisible = await page
        .locator('[data-sidebar="sidebar"]')
        .isVisible()
        .catch(() => false);
      if (!shellVisible) {
        failures.push(`${href} → 200 but no AppSidebar (rendered outside authenticated shell)`);
      }
    }

    expect(failures, `broken sidebar links:\n  ${failures.join("\n  ")}`).toEqual([]);
  });
});
