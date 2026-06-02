/**
 * Visual regression — graph surfaces.
 *
 * Spec: dashboard#637. Captures full-page screenshots of:
 *   - /dashboard (GraphHero canvas + surrounding chrome)
 *   - /dashboard/graph (KnowledgeGraph3D full-page)
 * in dark mode (the graph always renders in dark-terminal style).
 *
 * Authentication: synthesised via the test-only session encoder
 * (same mechanism as auth-routes.spec.ts). Skips gracefully when
 * TEST_AUTH_BYPASS is unset so CI environments without a cluster
 * don't fail.
 *
 * Determinism: three techniques are combined so every run produces
 * the same pixels:
 *   1. prefers-reduced-motion: reduce — pauses the CRT scanline
 *      so it freezes at y=0 rather than scrolling.
 *   2. All CSS animations + transitions are paused via injected style.
 *   3. Graph data API is stubbed to return the empty-state payload
 *      (nodes: [], edges: []) so the canvas renders the "no data"
 *      empty-state component, which is fully static.
 *
 * The empty-state approach is the cleanest for determinism: the
 * force-directed layout converges differently every run when nodes
 * are present. The visual regression tests the theme (background,
 * overlay chrome, token usage) rather than graph topology.
 *
 * Theme: dark mode only — the graph canvas uses a fixed dark palette
 * regardless of the theme_choice cookie (resolvedTheme = 'dark' in
 * KnowledgeGraph3D). We still set the cookie to dark to ensure the
 * surrounding UI chrome (sidebar, header) also renders in dark mode.
 */

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { encodeTestSession } from "@/src/lib/test-fixtures/encode-session";

// ============================================================================
// Routes captured by this spec
// ============================================================================

const GRAPH_ROUTES = [
  { name: "dashboard-graph-hero", path: "/dashboard" },
  { name: "full-graph", path: "/dashboard/graph" },
] as const;

// ============================================================================
// Shared helpers (mirrors auth-routes.spec.ts)
// ============================================================================

const MOCK_USER = {
  sub: "test-user-graph-visual",
  name: "Graph Visual",
  email: "graph-visual@test.zeroroot.local",
};
const MOCK_TENANT_ID = "tenant-graph-visual-test";

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

async function setDarkTheme(context: BrowserContext) {
  await context.addCookies([
    {
      name: "theme_choice",
      value: "dark",
      domain: "localhost",
      path: "/",
      httpOnly: false,
      sameSite: "Lax",
    },
  ]);
}

/**
 * Stub out API calls so the page renders deterministically.
 *
 * - /api/auth/my-memberships → admin role (so all chrome is visible)
 * - /api/gibson-proxy        → empty graph data (nodes/edges: [])
 * - /api/graph               → empty graph data
 */
async function stubDataLayer(page: Page) {
  // Auth memberships — always admin so UI chrome is fully rendered
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

  // Gibson proxy (catches generic RPC calls)
  await page.route("**/api/gibson-proxy**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  // Graph data API — return empty graph so the canvas renders the
  // "No graph data available" empty state (fully deterministic, no
  // force-directed layout to converge).
  await page.route("**/api/graph**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ nodes: [], edges: [] }),
    });
  });
}

/**
 * Stabilise the page for screenshot capture:
 *   1. Apply prefers-reduced-motion: reduce to freeze the CRT scanline
 *   2. Pause all CSS animations and transitions
 *   3. Wait for network idle so fonts/assets are loaded
 */
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

// ============================================================================
// Test suite
// ============================================================================

test.describe("visual regression — graph routes", () => {
  // Chromium-only — same rationale as auth-routes spec:
  // baselines are single-browser per the platform convention.
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "visual baselines are chromium-only",
  );

  // Encoder requires TEST_AUTH_BYPASS=1 + NODE_ENV !== production.
  // Skip gracefully when unset so CI environments without a cluster
  // don't fail; they just skip.
  test.skip(
    () => process.env.TEST_AUTH_BYPASS !== "1",
    "graph visual regression requires TEST_AUTH_BYPASS=1",
  );

  test.describe("dark mode", () => {
    for (const route of GRAPH_ROUTES) {
      test(route.name, async ({ page, context }) => {
        await setAuthSession(context);
        await setDarkTheme(context);
        await stubDataLayer(page);
        await page.goto(route.path);
        await stabilise(page);
        await expect(page).toHaveScreenshot(`graph-${route.name}-dark.png`, {
          fullPage: true,
          maxDiffPixelRatio: 0.01,
        });
      });
    }
  });
});
