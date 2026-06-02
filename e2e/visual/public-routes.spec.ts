/**
 * Visual regression — public surfaces.
 *
 * Spec: dashboard#60, single dark brand #654. Captures full-page screenshots
 * of every customer-facing route that doesn't require an authenticated
 * session, against the local dev server. There is one immutable dark brand —
 * each route is captured once. Failures here mean the design system's tokens
 * drifted or a consumer started reaching outside them.
 *
 * Auth routes (/dashboard, /dashboard/missions, …) are intentionally NOT in
 * this file. They require a complete session-plus-daemon mock harness which
 * is a separate slice; once that exists, a sibling auth-routes.spec.ts adds
 * the equivalent coverage with the same theme-cookie + screenshot pattern.
 *
 * Baselines live under e2e/visual/__screenshots__/. Regenerate with
 * `pnpm test:visual:update`; commit alongside the design change that caused
 * the drift.
 *
 * Wall-clock budget: ≤ 90s on local dev. CI runs the dev-server webServer
 * defined in playwright.config.ts.
 */

import { test, expect, type Page } from "@playwright/test";

const PUBLIC_ROUTES = [
  { name: "landing", path: "/" },
  { name: "pricing", path: "/pricing" },
  { name: "login", path: "/login" },
  { name: "signup", path: "/signup" },
  { name: "design-tokens", path: "/design-tokens" },
  { name: "contact-sales", path: "/contact-sales" },
] as const;

/**
 * Steady-state wait: scanlines + glow utilities use animations whose
 * intermediate frames cause pixel-level diff noise. Force a stable
 * sample by pinning the animation play state to paused before capture.
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

test.describe("visual regression — public routes", () => {
  // Visual baselines are chromium-only — one browser as the source of truth.
  // Firefox/webkit projects add per-browser font-rendering variance that
  // bloats the diff without improving signal.
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "visual baselines are chromium-only",
  );

  for (const route of PUBLIC_ROUTES) {
    test(route.name, async ({ page }) => {
      await page.goto(route.path);
      await stabilise(page);
      await expect(page).toHaveScreenshot(`${route.name}-dark.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});
