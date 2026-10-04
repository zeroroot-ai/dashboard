// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * routes.spec.ts
 *
 * Every page under app/ renders on staging. The spec walks the app tree at
 * load time, so a new page.tsx is covered the day it lands and a deleted one
 * stops being tested the same day. There is no manifest to keep in step
 * (gibson#591: the old YAML manifest fell 96 routes behind its tree because
 * nothing read it).
 *
 * Two walks per static page:
 *   - signed out: the server answers below 500. A page under (auth) lands on
 *     /login; a public page renders.
 *   - signed in as the admin account: 200, no Next.js error boundary, and a
 *     non-empty <main>.
 *
 * A dynamic segment ([id], [name], [token]) needs a fixture the walk does not
 * have, so each one skips with a reason that names the segment. The skip
 * floor (skip-floor.mjs) still requires the static pages to run.
 *
 * Credentials: E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ADMIN_TOTP_SECRET.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { test, expect, type BrowserContext, type Page } from "@playwright/test";

import { BASE_URL, requireAdmin, signIn } from "./auth/helpers/accounts";

const APP_DIR = join(__dirname, "..", "app");

/** A page as the walk sees it: its URL path and whether it needs a fixture. */
interface Route {
  path: string;
  dynamic: boolean;
  isAuth: boolean;
}

/**
 * routesUnder lists every page.tsx below dir as a URL path. A route group
 * such as (auth) or (public) is dropped from the URL, as Next.js does; a
 * dynamic segment such as [id] marks the route dynamic.
 */
function routesUnder(dir: string): Route[] {
  const out: Route[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry === "page.tsx") {
        const rel = relative(dir, current).split("/").filter(Boolean);
        const isAuth = rel.includes("(auth)");
        const segments = rel.filter((s) => !(s.startsWith("(") && s.endsWith(")")));
        out.push({
          path: "/" + segments.join("/"),
          dynamic: segments.some((s) => s.startsWith("[")),
          isAuth,
        });
      }
    }
  };
  walk(dir);
  return out;
}

const routes = routesUnder(APP_DIR);

/** Text a Next.js error boundary or a 404 page renders. */
const ERROR_TEXT = /Application error|This page could not be found|Internal Server Error/;

test.describe("every page renders on staging", () => {
  test("the walk found the app tree", () => {
    // A walk that found nothing would make every other test vacuous.
    expect(routes.length).toBeGreaterThan(50);
  });

  test.describe("signed out", () => {
    for (const route of routes) {
      test(`GET ${route.path} signed out`, async ({ page }) => {
        test.skip(route.dynamic, `${route.path} has a dynamic segment and no fixture`);
        const response = await page.goto(`${BASE_URL}${route.path}`);
        expect(response, `no response for ${route.path}`).not.toBeNull();
        expect(response!.status(), `${route.path} answered ${response!.status()}`).toBeLessThan(500);
        if (route.isAuth) {
          // The (auth) layout redirects a visitor without a session to /login.
          await expect(page).toHaveURL(/\/login/);
        } else {
          await expect(page.locator("body")).not.toContainText(ERROR_TEXT);
        }
      });
    }
  });

  test.describe("signed in", () => {
    let context: BrowserContext;
    let page: Page;

    test.beforeAll(async ({ browser }) => {
      // One sign-in for the whole walk: Zitadel's hosted login with TOTP is
      // the slow part, and the session cookie is what every page needs.
      const account = requireAdmin();
      context = await browser.newContext();
      page = await context.newPage();
      await signIn(page, context, account);
    });

    test.afterAll(async () => {
      await context?.close();
    });

    for (const route of routes) {
      test(`GET ${route.path} signed in`, async () => {
        test.skip(route.dynamic, `${route.path} has a dynamic segment and no fixture`);
        test.skip(!route.isAuth, `${route.path} is a public page; the signed-out walk covers it`);
        const response = await page.goto(`${BASE_URL}${route.path}`);
        expect(response, `no response for ${route.path}`).not.toBeNull();
        expect(response!.status(), `${route.path} answered ${response!.status()}`).toBe(200);
        await expect(page).not.toHaveURL(/\/login/);
        await expect(page.locator("body")).not.toContainText(ERROR_TEXT);
        const main = page.locator("main").first();
        await expect(main, `${route.path} rendered no <main>`).toBeVisible();
        expect((await main.innerText()).trim().length, `${route.path} rendered an empty <main>`).toBeGreaterThan(0);
      });
    }
  });
});
