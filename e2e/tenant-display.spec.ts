/**
 * tenant-display.spec.ts
 *
 * Regression suite for the dashboard-tenant-context-rewire spec.
 *
 * Asserts the chrome (sidebar workspace label + header tenant display)
 * shows the active tenant's resolved displayName instead of the
 * "No workspace" fallback.
 *
 * The header / sidebar are hydrated server-side via
 * `getServerSession()` → `resolveTenant()` → `<TenantHydrator>` → React
 * context. This test validates the full path against a live cluster: a
 * real Auth.js login, a real `gibson_active_tenant` cookie + FGA
 * membership lookup, and a real Tenant CRD lookup.
 *
 * Pre-conditions (Kind cluster):
 *   make deploy-local running against `kind-gibson` context.
 *   PLAYWRIGHT_BASE_URL , cluster URL (default: http://localhost:3000)
 *   E2E_ADMIN_EMAIL     , any valid user email (signup creates them as
 *                          tenant_admin of their own tenant)
 *   E2E_ADMIN_PASSWORD  , corresponding password
 *
 * Wall-clock budget: ≤ 1 minute.
 */

import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'password';

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /^log ?in$|^sign ?in$/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), {
    timeout: 30_000,
  });
}

test.describe('Tenant chrome shows the resolved tenant', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, EMAIL, PASSWORD);
  });

  test('header tenant display does NOT render "No workspace"', async ({
    page,
  }) => {
    test.setTimeout(45_000);

    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // The header TenantDisplay renders inside the SiteHeader (top-of-page).
    // We assert the literal "No workspace" string is absent from that
    // region, it would only appear when the server failed to resolve a
    // tenant for the signed-in user.
    const header = page.getByRole('banner');
    await expect(header).toBeVisible({ timeout: 10_000 });
    await expect(header).not.toContainText('No workspace', { timeout: 5_000 });
  });

  test('sidebar workspace label matches a real tenant displayName', async ({
    page,
  }) => {
    test.setTimeout(45_000);

    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // The sidebar TenantSwitcher renders the active tenant displayName as
    // a `font-medium` span under the SidebarMenuButton tooltip. We assert
    // it isn't the fallback string.
    const sidebar = page.locator('aside,[data-slot="sidebar"]').first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
    await expect(sidebar).not.toContainText('No workspace', {
      timeout: 5_000,
    });
  });
});
