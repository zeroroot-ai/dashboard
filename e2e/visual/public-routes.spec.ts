/**
 * Visual regression — public surfaces.
 *
 * Spec: dashboard#60. Captures full-page screenshots of every customer-facing
 * route that doesn't require an authenticated session, in both light and dark
 * mode, against the local dev server. Failures here mean the design system's
 * tokens drifted or a consumer started reaching outside them.
 *
 * Theme is selected via the `theme_choice` cookie that #57 wired into
 * app/layout.tsx — setting it before navigation causes the server render to
 * pick up the chosen mode without dark-flash, so the snapshot captures the
 * stable state.
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

const MODES = ["light", "dark"] as const;

async function setTheme(page: Page, mode: (typeof MODES)[number]) {
  await page.context().clearCookies();
  await page.context().addCookies([
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
  for (const mode of MODES) {
    test.describe(`${mode} mode`, () => {
      for (const route of PUBLIC_ROUTES) {
        test(route.name, async ({ page }) => {
          await setTheme(page, mode);
          await page.goto(route.path);
          await stabilise(page);
          await expect(page).toHaveScreenshot(`${route.name}-${mode}.png`, {
            fullPage: true,
            maxDiffPixelRatio: 0.01,
          });
        });
      }
    });
  }
});
