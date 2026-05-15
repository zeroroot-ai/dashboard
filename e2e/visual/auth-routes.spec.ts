/**
 * Visual regression — authenticated surfaces.
 *
 * Spec: dashboard#60 acceptance criteria explicitly list /dashboard,
 * /dashboard/missions, /dashboard/findings, /dashboard/settings. This
 * file ships the scaffolding (route list, theme cookie, snapshot
 * matcher) for those captures.
 *
 * STATUS: tests are gated behind `E2E_VISUAL_AUTH=1`. They require an
 * Auth.js session cookie established before the snapshot — minting
 * that cookie requires either:
 *
 *   (a) a real signed-in browser context (Playwright global-setup
 *       walks through /signup or /login against the Kind dev cluster),
 *       OR
 *   (b) a test-only session-encoder that uses Auth.js's `encode` to
 *       mint a synthetic JWE under AUTH_SECRET for a mock user.
 *
 * Both approaches need a small piece of new infrastructure that's
 * outside the design-system slice's scope and is security-sensitive
 * (option (b) effectively forges a session — must be guarded against
 * accidental production activation). Tracked as a follow-up.
 *
 * Until that lands the spec runs only when E2E_VISUAL_AUTH=1 AND a
 * `__Secure-authjs.session-token` cookie is exported via the
 * `E2E_AUTH_COOKIE` env (developers running locally against a live
 * Kind cluster can paste their dev session cookie). CI doesn't set
 * those vars so this file is effectively no-op there until the
 * harness lands.
 *
 * When it does, drop the gating and the tests "just work" — the route
 * list, theme switching, daemon-proxy stubs, and screenshot
 * comparators are all in place.
 */

import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const AUTH_ROUTES = [
  { name: "dashboard", path: "/dashboard" },
  { name: "missions", path: "/dashboard/pages/missions" },
  { name: "findings", path: "/dashboard/pages/findings" },
  { name: "settings", path: "/dashboard/pages/settings/account" },
] as const;

const MODES = ["light", "dark"] as const;

const SHOULD_RUN =
  process.env.E2E_VISUAL_AUTH === "1" && !!process.env.E2E_AUTH_COOKIE;

async function setAuthSession(context: BrowserContext) {
  const sessionCookie = process.env.E2E_AUTH_COOKIE;
  if (!sessionCookie) {
    throw new Error(
      "E2E_AUTH_COOKIE not set. Export your dev __Secure-authjs.session-token (browser devtools → Application → Cookies) to run this suite locally.",
    );
  }
  await context.addCookies([
    {
      name: "__Secure-authjs.session-token",
      value: sessionCookie,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
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

/**
 * Stub the daemon proxy + memberships so the page renders with stable
 * empty-state data regardless of cluster state. Visual regression cares
 * about the chrome + layout + token-driven styling, not specific
 * mission/finding rows.
 */
async function stubDataLayer(page: Page) {
  await page.route("**/api/auth/my-memberships**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeTenantId: "tenant-visual-test",
        byTenant: { "tenant-visual-test": { role: "tenant_admin" } },
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
  test.skip(!SHOULD_RUN, "set E2E_VISUAL_AUTH=1 + E2E_AUTH_COOKIE to run");

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
