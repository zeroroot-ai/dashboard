/**
 * Visual regression — authenticated surfaces.
 *
 * Spec: dashboard#60. Captures full-page screenshots of /dashboard,
 * /dashboard/pages/missions, /dashboard/pages/findings, and
 * /dashboard/pages/settings/account in both light and dark mode.
 *
 * Authentication: synthesised via the test-only session encoder at
 * src/lib/test-fixtures/encode-session.ts. The encoder mints a JWE
 * under the dashboard's own AUTH_SECRET that decodes through the
 * same Auth.js pipeline as a real sign-in. The encoder refuses to
 * run unless BOTH NODE_ENV !== "production" AND TEST_AUTH_BYPASS=1
 * are true — see #84 for the security rationale.
 *
 * Data: daemon proxy + memberships are stubbed via page.route() so
 * the page renders empty-state content regardless of cluster state.
 * Visual regression cares about chrome + layout + tokens, not
 * specific data rows.
 *
 * Theme: selected via the `theme_choice` cookie (same SSR-aware
 * mechanism as the public-routes spec).
 */

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { encodeTestSession } from "@/src/lib/test-fixtures/encode-session";

const AUTH_ROUTES = [
  { name: "dashboard", path: "/dashboard" },
  { name: "missions", path: "/dashboard/pages/missions" },
  { name: "findings", path: "/dashboard/pages/findings" },
  { name: "settings", path: "/dashboard/pages/settings/account" },
] as const;

const MODES = ["light", "dark"] as const;

const MOCK_USER = {
  sub: "test-user-visual-regression",
  name: "Visual Regression",
  email: "visual@test.zero-day.local",
};
const MOCK_TENANT_ID = "tenant-visual-test";

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

async function setTheme(context: BrowserContext, mode: (typeof MODES)[number]) {
  await context.addCookies([
    {
      name: "theme_choice",
      value: mode,
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

async function stabilise(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-play-state: paused !important;
        transition-duration: 0s !important;
        scroll-behavior: auto !important;
      }
    `,
  });
  await page.waitForLoadState("networkidle");
}

test.describe("visual regression — auth routes", () => {
  // Chromium-only — same rationale as the public-routes spec.
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "visual baselines are chromium-only",
  );
  // Encoder requires TEST_AUTH_BYPASS=1 + NODE_ENV !== production. Skip
  // gracefully when those aren't set so CI doesn't fail on environments
  // that haven't opted in.
  test.skip(
    () => process.env.TEST_AUTH_BYPASS !== "1",
    "auth-route visual regression requires TEST_AUTH_BYPASS=1",
  );

  for (const mode of MODES) {
    test.describe(`${mode} mode`, () => {
      for (const route of AUTH_ROUTES) {
        test(route.name, async ({ page, context }) => {
          await setAuthSession(context);
          await setTheme(context, mode);
          await stubDataLayer(page);
          await page.goto(route.path);
          await stabilise(page);
          await expect(page).toHaveScreenshot(`auth-${route.name}-${mode}.png`, {
            fullPage: true,
            maxDiffPixelRatio: 0.01,
          });
        });
      }
    });
  }
});
