/**
 * authz/non-admin.spec.ts
 *
 * E2E gating suite: verifies admin chrome is hidden from a tenant_member.
 *
 * Spec: dashboard-authz-ui-gating, Task 18, Requirement 9.3.
 *
 * Strategy:
 *   The first admin user who signs up for a tenant becomes tenant_admin by
 *   default. A SECOND user who registers independently is an unaffiliated
 *   user with no membership in that tenant. To simulate a genuine tenant_member
 *   we exploit the fact that the sidebar and all gated UI elements read from
 *   useAuthorize / assertAuthorized which both resolve the active-tenant role
 *   from the memberships API. When there is no membership record for the active
 *   tenant the hook returns allowed=false (relation-not-met path), which is
 *   exactly the same hide-path as the tenant_member role not meeting the
 *   required relation.
 *
 *   For a live Kind cluster run we sign up a second user who has no tenant
 *   membership. The suite also works in mocked mode (see mockMemberSession
 *   below) so it compiles and lints cleanly without a live cluster.
 *
 * Approach (option a — two-user approach):
 *   1. Sign up as user A (adminCreds) — becomes tenant_admin of tenant-A.
 *   2. Sign up as user B (memberCreds) — becomes tenant_admin of their own
 *      tenant-B but has no membership in tenant-A.
 *   3. The suite tests as user B navigating to tenant-A routes.
 *
 *   In practice the existing harness always creates a fresh tenant per signup,
 *   so there is no straightforward way to add user B as a *member* of tenant-A
 *   without a Zitadel admin API call. Instead we use Playwright API route
 *   mocking to return a memberships payload that simulates the member role,
 *   which exercises the exact same code path as a real member would hit.
 *
 * Mock approach:
 *   - Mock /api/auth/my-memberships to return tenant_member role.
 *   - All other routes continue normally (or are intercepted per the existing
 *     pattern using the gibson-proxy glob route).
 *
 * Pre-conditions (Kind cluster):
 *   make deploy-local running against `kind-gibson` context.
 *   PLAYWRIGHT_BASE_URL  — cluster URL (default: http://localhost:3000)
 *   E2E_ADMIN_EMAIL      — any valid user email (used for auth session)
 *   E2E_ADMIN_PASSWORD   — corresponding password
 *
 * Wall-clock budget: ≤ 2 minutes.
 * Requirements: 9.3.
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

/**
 * We need a valid authenticated session. Re-use the admin credentials for the
 * login step — the auth session itself is then overridden at the memberships
 * API layer to look like a member session. This is consistent with the design:
 * the gating decision comes from the memberships response, not from the
 * session token itself.
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";

const PLUGINS_URL = `${BASE_URL}/dashboard/plugins`;
const SECRETS_URL = `${BASE_URL}/dashboard/pages/settings/secrets`;
const SECRETS_NEW_URL = `${BASE_URL}/dashboard/pages/settings/secrets/new`;
const GRANTS_URL = `${BASE_URL}/dashboard/pages/settings/grants`;
const SETTINGS_URL = `${BASE_URL}/dashboard/pages/settings`;

/** Synthetic tenant ID used in the mocked membership payload. */
const MOCK_TENANT_ID = "tenant-e2e-non-admin-001";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^log ?in$|^sign ?in$/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 30_000,
  });
}

/**
 * Intercept /api/auth/my-memberships and return a tenant_member payload.
 *
 * The useAuthorize hook fetches this endpoint via React Query (staleTime 60s).
 * By intercepting before navigation we ensure the hook always sees the member
 * role, regardless of the real user's actual role on the cluster.
 *
 * This is the canonical way to test the gating decision in isolation without
 * requiring a real tenant_member account on every CI runner.
 */
async function mockMemberSession(page: Page) {
  await page.route("**/api/auth/my-memberships**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeTenantId: MOCK_TENANT_ID,
        byTenant: {
          [MOCK_TENANT_ID]: { role: "tenant_member" },
        },
      }),
    });
  });
}

/**
 * Standard gibson-proxy mock: empty lists so pages render without a live daemon.
 */
async function mockEmptyBackend(page: Page) {
  await page.route("**/api/gibson-proxy**", async (route) => {
    const url = route.request().url();

    if (url.includes("ListSecrets")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ secrets: [], total: 0 }),
      });
      return;
    }
    if (url.includes("ListPluginInstalls") || url.includes("ListPlugins")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ plugins: [], total: 0 }),
      });
      return;
    }
    if (url.includes("GetBrokerConfig") || url.includes("GetTenantBrokerConfig")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ provider: "gibson_vault", configured: true }),
      });
      return;
    }
    if (url.includes("ListActiveGrants") || url.includes("ListGrants")) {
      // For non-admin the grants page itself is blocked server-side, so this
      // mock is a safety net only.
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ grants: [], total: 0 }),
      });
      return;
    }

    await route.continue();
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("Authz gating — non-admin (tenant_member) visibility", () => {
  /**
   * Serial: login once, share the session across assertions.
   * Avoids the ~10s Zitadel OIDC round-trip on every test.
   */
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    // Set up mocks BEFORE login so React Query sees the member session
    // from the first render after the OIDC callback completes.
    await mockMemberSession(page);
    await mockEmptyBackend(page);
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  // -------------------------------------------------------------------------
  // Sidebar entries
  // -------------------------------------------------------------------------

  test("settings sidebar does NOT show Secrets entry for tenant_member", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    await page.goto(SETTINGS_URL);

    // Wait for sidebar to render
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    // The sidebar should not contain a "Secrets" navigation link
    // (distinct from the page-level heading which may still exist for
    // the current page context — we look for nav-specific selectors).
    const secretsNavEntry = page.locator("nav").getByRole("link", {
      name: /^secrets$/i,
    });

    await expect(secretsNavEntry).not.toBeVisible({
      timeout: 5_000,
    });
  });

  test("settings sidebar does NOT show Secrets backend entry for tenant_member", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    await page.goto(SETTINGS_URL);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    const backendNavEntry = page.locator("nav").getByRole("link", {
      name: /secrets.?backend|backend/i,
    });

    await expect(backendNavEntry).not.toBeVisible({ timeout: 5_000 });
  });

  test("settings sidebar does NOT show Grants entry for tenant_member", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    await page.goto(SETTINGS_URL);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    const grantsNavEntry = page.locator("nav").getByRole("link", {
      name: /^grants$/i,
    });

    await expect(grantsNavEntry).not.toBeVisible({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Plugins page
  // -------------------------------------------------------------------------

  test("Add Plugin button is NOT in the DOM on /plugins for tenant_member", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    await page.goto(PLUGINS_URL);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    // The button must not be in the DOM at all (not just hidden with CSS).
    const addPluginBtn = page.getByRole("button", {
      name: /add.*plugin|register.*plugin|new.*plugin/i,
    });

    await expect(addPluginBtn).not.toBeInViewport({ timeout: 3_000 }).catch(
      async () => {
        // Fallback: assert not attached to DOM
        await expect(addPluginBtn).toHaveCount(0, { timeout: 3_000 });
      },
    );

    // Primary assertion: button count is 0
    await expect(addPluginBtn).toHaveCount(0, { timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Direct navigation — secrets/new
  // -------------------------------------------------------------------------

  test("direct nav to /secrets/new redirects or returns 403 for tenant_member", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    // Capture responses to detect 403
    const statuses: number[] = [];
    page.on("response", (resp) => {
      if (resp.url().includes("secrets/new") || resp.url().includes("secrets%2Fnew")) {
        statuses.push(resp.status());
      }
    });

    await page.goto(SECRETS_NEW_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });

    // The page should either:
    //   (a) redirect away from /secrets/new (assertAuthorized throws → redirect)
    //   (b) render a 403 / permission denied page
    const finalUrl = page.url();
    const wasRedirected = !finalUrl.includes("/secrets/new");
    const has403 = statuses.includes(403) || statuses.includes(401);

    // Accept either outcome
    const bodyText = await page.textContent("body").catch(() => "");
    const has403Copy =
      (bodyText ?? "").toLowerCase().includes("permission") ||
      (bodyText ?? "").toLowerCase().includes("forbidden") ||
      (bodyText ?? "").toLowerCase().includes("not authorized") ||
      (bodyText ?? "").toLowerCase().includes("access denied");

    expect(
      wasRedirected || has403 || has403Copy,
      `Expected /secrets/new to redirect or 403 for tenant_member. ` +
        `finalUrl=${finalUrl}, statuses=${statuses.join(",")}, ` +
        `bodyExcerpt=${(bodyText ?? "").slice(0, 200)}`,
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Direct navigation — grants
  // -------------------------------------------------------------------------

  test("direct nav to /grants returns 403 or redirects for tenant_member", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    const statuses: number[] = [];
    page.on("response", (resp) => {
      if (resp.url().includes("/grants")) {
        statuses.push(resp.status());
      }
    });

    await page.goto(GRANTS_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });

    const finalUrl = page.url();
    const wasRedirected = !finalUrl.includes("/grants");
    const has403 = statuses.includes(403) || statuses.includes(401);

    const bodyText = await page.textContent("body").catch(() => "");
    const has403Copy =
      (bodyText ?? "").toLowerCase().includes("permission") ||
      (bodyText ?? "").toLowerCase().includes("forbidden") ||
      (bodyText ?? "").toLowerCase().includes("not authorized") ||
      (bodyText ?? "").toLowerCase().includes("access denied") ||
      (bodyText ?? "").toLowerCase().includes("admin permission");

    expect(
      wasRedirected || has403 || has403Copy,
      `Expected /grants to 403 or redirect for tenant_member. ` +
        `finalUrl=${finalUrl}, statuses=${statuses.join(",")}, ` +
        `bodyExcerpt=${(bodyText ?? "").slice(0, 200)}`,
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Secrets list — Add Secret button absent
  // -------------------------------------------------------------------------

  test("Add Secret button is NOT in the DOM on /secrets for tenant_member", async ({
    page,
  }) => {
    test.setTimeout(30_000);

    await page.goto(SECRETS_URL);
    await page.waitForLoadState("networkidle", { timeout: 15_000 });

    const addSecretBtn = page.getByRole("button", { name: /add secret/i }).or(
      page.getByRole("link", { name: /add secret/i }),
    );

    await expect(addSecretBtn).toHaveCount(0, { timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Deploy launcher — visible BUT disabled, with tooltip, for non-admins.
  // Regression guard for dashboard#145: the DeployLauncher used to render
  // null for non-admins, which made users believe the feature did not
  // exist. AuthGatedButton's "denied" state keeps the affordance in the
  // DOM so non-admins see the action and learn the permission they need.
  // -------------------------------------------------------------------------

  for (const [type, listUrl] of [
    ["agent", `${BASE_URL}/dashboard/agents`],
    ["plugin", PLUGINS_URL],
    ["tool", `${BASE_URL}/dashboard/tools`],
  ] as const) {
    test(`Deploy ${type} CTA renders disabled with tooltip for tenant_member`, async ({
      page,
    }) => {
      test.setTimeout(30_000);
      await page.goto(listUrl);
      await page.waitForLoadState("networkidle", { timeout: 15_000 });

      // The denied wrapper carries data-testid="auth-gated-button-denied"
      // and renders the CTA label as text content (no link, no enabled
      // button — see AuthGatedButton.tsx).
      const deniedWrapper = page.getByTestId("auth-gated-button-denied");
      await expect(deniedWrapper.first()).toBeVisible({ timeout: 10_000 });
      await expect(deniedWrapper.first()).toContainText(
        new RegExp(`deploy ${type}`, "i"),
      );
      // No clickable link to /dashboard/deploy.
      const deployLink = page
        .getByRole("link", { name: new RegExp(`deploy ${type}`, "i") });
      await expect(deployLink).toHaveCount(0, { timeout: 3_000 });
    });
  }
});
