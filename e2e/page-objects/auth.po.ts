/**
 * auth.po.ts — Authentication page-object helpers.
 *
 * Provides reusable helpers for setting up authenticated browser contexts
 * using the test-only session encoder (src/lib/test-fixtures/encode-session.ts).
 *
 * The encoder is guarded by NODE_ENV !== "production" AND TEST_AUTH_BYPASS=1.
 * All specs that import this module must gate their test blocks with:
 *
 *   test.skip(!process.env.TEST_AUTH_BYPASS, "requires TEST_AUTH_BYPASS=1");
 *
 * to ensure graceful degradation in CI environments that haven't opted in.
 */

import type { BrowserContext } from "@playwright/test";
import { encodeTestSession } from "@/src/lib/test-fixtures/encode-session";

export interface MockUser {
  sub: string;
  name?: string;
  email?: string;
}

/**
 * Injects a synthetic Auth.js session cookie and an active-tenant cookie into
 * the given Playwright browser context. After calling this, any page.goto()
 * in the same context will behave as if the user is logged in.
 *
 * @param context      - Playwright BrowserContext.
 * @param user         - User identity for the minted session.
 * @param tenantId     - Tenant ID stored in the gibson_active_tenant cookie.
 */
export async function injectAuthSession(
  context: BrowserContext,
  user: MockUser,
  tenantId: string,
): Promise<void> {
  const { cookieName, cookieValue } = await encodeTestSession(user);
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
      value: tenantId,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      sameSite: "Lax",
    },
  ]);
}

/**
 * Stubs /api/auth/my-memberships to return a canned admin membership for
 * the given tenantId. Call page.route() before navigating to protected routes.
 *
 * @param context  - Playwright BrowserContext (routes are set on context, not page, to persist across navigations).
 * @param tenantId - Active tenant ID to inject into the membership response.
 * @param role     - Role for the tenant. Defaults to "tenant_admin".
 */
export async function stubMemberships(
  context: BrowserContext,
  tenantId: string,
  role: "tenant_admin" | "tenant_member" | "tenant_owner" = "tenant_admin",
): Promise<void> {
  await context.route("**/api/auth/my-memberships**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeTenantId: tenantId,
        byTenant: { [tenantId]: { role } },
      }),
    });
  });
}
