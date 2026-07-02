/**
 * admin-chrome.spec.ts
 *
 * Regression suite for the dashboard-tenant-context-rewire spec.
 *
 * Asserts that admin-only chrome gated by `usePermitted(...)` (the client
 * authz hooks rewired in `src/lib/auth/tenant.ts`) is rendered for a
 * tenant_admin user. The hooks now read from the server-hydrated
 * `TenantContextProvider`; before this spec they read dead session
 * fields and the chrome was hidden from EVERY user, admin or not.
 *
 * The first user to sign up for a tenant becomes `tenant_admin` by
 * default, so logging in with the standard E2E_ADMIN_EMAIL credentials
 * exercises the admin path against the server's real FGA-driven
 * permission resolution. There is no parallel non-admin scenario in
 * this file because the `permissions` array on the context is computed
 * server-side from FGA membership, it cannot be mocked through the
 * `/api/auth/my-memberships` route the way useAuthorize-driven gates
 * (e2e/authz/non-admin.spec.ts) can. Non-admin coverage of the same
 * surface is provided by the unit-test suite at
 * `src/lib/auth/__tests__/tenant.test.tsx`.
 *
 * Pre-conditions (Kind cluster):
 *   make deploy-local running against `kind-gibson` context.
 *   PLAYWRIGHT_BASE_URL , cluster URL (default: http://localhost:3000)
 *   E2E_ADMIN_EMAIL     , admin user email
 *   E2E_ADMIN_PASSWORD  , corresponding password
 *
 * Wall-clock budget: ≤ 2 minutes.
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'password';

const USERS_URL = `${BASE_URL}/dashboard/organization/users`;
const AGENTS_URL = `${BASE_URL}/dashboard/agents`;
const TOOLS_URL = `${BASE_URL}/dashboard/tools`;
const PLUGINS_URL = `${BASE_URL}/dashboard/plugins`;

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /^log ?in$|^sign ?in$/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), {
    timeout: 30_000,
  });
}

test.describe('Admin-only chrome via usePermitted (tenant_admin)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test('Users page shows the Invite/manage control', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto(USERS_URL);
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // `usePermitted("team:manage")` gates the Invite button on
    // UsersContent; with a working context the admin sees it.
    const inviteCta = page.getByRole('button', {
      name: /invite|add (user|member)|manage/i,
    });
    await expect(inviteCta.first()).toBeVisible({ timeout: 10_000 });
  });

  test('Agents page shows a manage/create control', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto(AGENTS_URL);
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // The Deploy launcher links to /dashboard/deploy?type=agent.
    const deployCta = page.getByRole('link', { name: /deploy agent/i });
    await expect(deployCta.first()).toBeVisible({ timeout: 10_000 });
  });

  test('Tools page shows a manage/create control', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto(TOOLS_URL);
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    const deployCta = page.getByRole('link', { name: /deploy tool/i });
    await expect(deployCta.first()).toBeVisible({ timeout: 10_000 });
  });

  test('Plugins page shows a manage/install control', async ({ page }) => {
    test.setTimeout(45_000);
    await page.goto(PLUGINS_URL);
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    const deployCta = page.getByRole('link', { name: /deploy plugin/i });
    await expect(deployCta.first()).toBeVisible({ timeout: 10_000 });
  });
});
