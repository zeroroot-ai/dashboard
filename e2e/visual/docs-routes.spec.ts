/**
 * Visual regression, docs routes.
 *
 * Spec: dashboard#98, single dark brand #654. Captures full-page screenshots
 * of every page listed in `content/docs/meta.json` against the local dev
 * server. There is one immutable dark brand, each route is captured once.
 * Failures here mean the Fumadocs theme tokens drifted (most commonly: an
 * `--color-fd-*` mapping in `components/gibson/docs/docs-theme.css` regressed
 * to a saturated/atmospheric value that's unreadable as body prose).
 *
 * The body-text contrast fix in #98 remaps `--color-fd-foreground` (and the
 * matching card/popover foregrounds) to a high-luminance base token so
 * customer developers can read the page without squinting. These baselines
 * lock that in.
 *
 * Baselines live under e2e/visual/docs-routes.spec.ts-snapshots/. Regenerate
 * with `pnpm test:visual:update` and commit alongside the design change.
 *
 * Wall-clock budget: ≤ 60s on local dev (16 routes, dark only). CI runs
 * against the dev-server webServer in playwright.config.ts.
 */

import { test, expect, type Page } from "@playwright/test";

// Source of truth: keep in sync with `content/docs/meta.json`. The `---`
// separator entries from meta.json are dropped here; only real page slugs.
const DOCS_ROUTES = [
  { name: "docs-index", path: "/docs" },
  { name: "docs-getting-started", path: "/docs/getting-started" },
  { name: "docs-install", path: "/docs/install" },
  { name: "docs-first-agent", path: "/docs/first-agent" },
  { name: "docs-component-bootstrap", path: "/docs/component-bootstrap" },
  { name: "docs-missions", path: "/docs/missions" },
  { name: "docs-findings", path: "/docs/findings" },
  { name: "docs-tools", path: "/docs/tools" },
  { name: "docs-plugins", path: "/docs/plugins" },
  { name: "docs-secrets-management", path: "/docs/secrets-management" },
  { name: "docs-knowledge-graph", path: "/docs/knowledge-graph" },
  { name: "docs-taxonomy", path: "/docs/taxonomy" },
  { name: "docs-ontology", path: "/docs/ontology" },
  { name: "docs-rbac", path: "/docs/rbac" },
  { name: "docs-observability", path: "/docs/observability" },
  { name: "docs-cli-reference", path: "/docs/cli-reference" },
] as const;

/**
 * Steady-state wait: pause every animation + transition so intermediate
 * frames don't add pixel diff noise. Mirrors the helper in
 * public-routes.spec.ts.
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

test.describe("visual regression, docs routes", () => {
  // Chromium-only, match the convention from public-routes + auth-routes
  // specs. Per-browser font rendering bloats diffs without adding signal.
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "visual baselines are chromium-only",
  );

  // MDX routes compile on first hit; Turbopack cold-compile can blow past
  // the default 30s test budget. Public-routes don't need this because
  // they're prebuilt React pages.
  test.describe.configure({ timeout: 60_000 });

  for (const route of DOCS_ROUTES) {
    test(route.name, async ({ page }) => {
      await page.goto(route.path);
      await stabilise(page);
      await expect(page).toHaveScreenshot(`${route.name}-dark.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
        // MDX routes can be slow on cold Turbopack compile. Public-route
        // pages use the default 5s; docs routes need more breathing room.
        timeout: 20_000,
      });
    });
  }
});
