/**
 * missions-list.spec.ts
 *
 * Regression suite for the dashboard-tenant-context-rewire spec.
 *
 * The 9 tenant-scoped data hooks (useMissions, useFindings, useAlerts, …)
 * read `useTenantStore((s) => s.currentTenant)?.id` and gate React Query
 * `enabled` on it. Before this spec the store shim returned null because
 * it read dead session claims, so the missions list never fetched.
 *
 * This test asserts that on a real cluster the missions list page fires
 * at least one network request to a missions-scoped endpoint, proof
 * that `currentTenant?.id` is non-null on first render and the React
 * Query gate cleared.
 *
 * Pre-conditions (Kind cluster):
 *   make deploy-local running against `kind-gibson` context.
 *   PLAYWRIGHT_BASE_URL , cluster URL (default: http://localhost:3000)
 *   E2E_ADMIN_EMAIL     , any valid user email
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

test.describe('Missions list fires tenant-scoped queries', () => {
  test('a missions request is made when the page mounts', async ({ page }) => {
    test.setTimeout(45_000);
    await loginAs(page, EMAIL, PASSWORD);

    // Pre-arm the listener BEFORE navigation so we don't miss the request.
    const missionsRequest = page.waitForRequest(
      (req) => /\/api\/missions(\?|$)/.test(req.url()) || /missions/i.test(req.url()),
      { timeout: 20_000 },
    );

    // The runs list (which fires the tenant-scoped /api/missions query) lives
    // under Mission Results after the authoring/execution split (dashboard#497).
    await page.goto(`${BASE_URL}/dashboard/results`);

    // We just need any missions-scoped fetch to fire, that proves
    // currentTenant?.id was non-null at React-Query-enable time.
    await expect(missionsRequest).resolves.toBeTruthy();
  });
});
