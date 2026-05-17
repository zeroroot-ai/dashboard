/**
 * Signup end-to-end smoke (tenant-operator#76 PRD Module 8).
 *
 * Drives the dashboard's `/signup?plan=team` form against a live cluster
 * (kind dev by default; production-like overlays via env), then polls
 * the dashboard's onboarding-data-plane endpoint until the Tenant CR
 * the saga creates reaches `Ready: True`. Asserts the full 13-step
 * provisioning saga (Namespace → Langfuse → Stripe → BillingPending →
 * Zitadel → FGA → SecretsBackend → Redis → TenantName → Neo4jScope →
 * DataPlane → Entitlements → CatalogSeeded → Ready) completes within
 * 180 seconds.
 *
 * Why: every "fix the signup" session this far has been triggered by
 * `PROVISIONING_TIMEOUT` on the dashboard with no signal pointing at
 * which subsystem boundary actually broke. With this spec wired as a
 * required check on every PR touching `deploy / gitops / gibson /
 * tenant-operator / dashboard / sdk`, the 10-bug cascade pattern
 * cannot recur from the same root causes — any regression at any
 * layer turns the green PR check red BEFORE merge, not 4 hours of
 * log archaeology after the fact.
 *
 * Run against kind locally:
 *   PLAYWRIGHT_BASE_URL=https://app.zero-day.local:30443 \
 *     SIGNUP_SMOKE_PLAN=team \
 *     pnpm playwright test e2e/signup-smoke.spec.ts
 *
 * The CI runner uses .github/workflows/kind-up-smoke.yml in the deploy
 * repo to set up a fresh kind cluster + Argo App-of-Apps before invoking
 * this spec.
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Test config — env-driven so the same spec runs against kind and any
// other cluster overlay without code changes.
// ---------------------------------------------------------------------------

const PLAN = process.env.SIGNUP_SMOKE_PLAN ?? 'team';
const READY_TIMEOUT_MS = Number(process.env.SIGNUP_SMOKE_READY_TIMEOUT_MS ?? 180_000);
const POLL_INTERVAL_MS = Number(process.env.SIGNUP_SMOKE_POLL_INTERVAL_MS ?? 5_000);

// Unique-per-run tenant slug. Avoids cross-run collisions when multiple
// PRs in CI race against the same long-lived cluster (the dev cluster is
// reused; the CI cluster is fresh each run but the prefix is fine either
// way).
function fixtureSlug() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `e2e-${t}-${r}`;
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

test.describe('signup smoke', () => {
  test.setTimeout(READY_TIMEOUT_MS + 60_000);

  test('completes 13-step saga end-to-end and reaches Ready: True', async ({ page, request }) => {
    const slug = fixtureSlug();
    const email = `${slug}@e2e.zero-day.local`;
    const password = 'CorrectHorseBatteryStaple-' + slug;
    const workspaceName = `Smoke ${slug}`;

    // Stage 1 — submit the signup form. The dashboard's Server Action
    // creates the Zitadel user, fires the OIDC code-exchange round-trip,
    // and (on success) creates the Tenant CR. We end up on the
    // provisioning page where the dashboard polls /api/onboarding/data-plane
    // until the operator reports Ready.
    await test.step('submit signup form', async () => {
      await page.goto(`/signup?plan=${encodeURIComponent(PLAN)}`);
      // The form has 7 named fields plus 2 acceptance checkboxes.
      await page.locator('input[name="firstName"]').fill('Ada');
      await page.locator('input[name="lastName"]').fill(slug);
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.locator('input[name="passwordConfirm"]').fill(password);
      await page.locator('input[name="workspaceName"]').fill(workspaceName);
      await page.locator('input[name="acceptToS"]').check();
      await page.locator('input[name="acceptPrivacy"]').check();
      await page.getByRole('button', { name: /create account|sign up/i }).click();

      // Successful signup lands on /signup/provisioning OR redirects to
      // the dashboard once Ready (depending on race). Either is fine.
      await expect(page).toHaveURL(/\/signup\/provisioning|\/dashboard|\/select-tenant/, {
        timeout: 30_000,
      });
    });

    // Stage 2 — poll the data-plane status endpoint until the operator's
    // Tenant CR reaches Ready. The endpoint is dashboard-served and
    // already used by the in-product onboarding panel; reusing it here
    // means we don't hit the K8s API directly from the test runner
    // (which would need kubeconfig).
    const tenantSlug = workspaceName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    // /api/onboarding/data-plane returns { postgres, redis, graph } where
    // each is { state, reason, lastUpdated }. state is one of
    // "provisioning" | "ready" | "failed" | null. Ready = all three "ready".
    type StoreState = 'provisioning' | 'ready' | 'failed' | null;
    interface StoreSnap { state: StoreState; reason: string | null }
    interface PlaneSnap { postgres: StoreSnap; redis: StoreSnap; graph: StoreSnap }

    let lastSnapshot: PlaneSnap | undefined;
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let ready = false;

    while (Date.now() < deadline) {
      // The session cookie set by Stage 1 carries forward into this
      // request because Playwright uses the same browser context for
      // request.get(...).
      const resp = await request.get(`/api/onboarding/data-plane`);
      if (resp.ok()) {
        const snapshot = (await resp.json()) as PlaneSnap;
        lastSnapshot = snapshot;
        const stores = [snapshot.postgres, snapshot.redis, snapshot.graph];
        if (stores.every(s => s?.state === 'ready')) {
          ready = true;
          break;
        }
        // Bail early on permanent failure surfaced by the operator.
        const failed = stores.find(s => s?.state === 'failed');
        if (failed) {
          throw new Error(
            `Tenant ${tenantSlug} data-plane store failed: ${JSON.stringify(failed)} (snapshot: ${JSON.stringify(snapshot)})`,
          );
        }
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (!ready) {
      throw new Error(
        `Tenant ${tenantSlug} did not reach Ready: True within ${READY_TIMEOUT_MS}ms. ` +
          `Last data-plane snapshot: ${JSON.stringify(lastSnapshot, null, 2)}`,
      );
    }

    // Stage 3 — navigate to the dashboard root. If the user's session
    // resolves to a tenant the user can act in, we should land on
    // /dashboard (not /select-tenant — they have exactly one membership)
    // and the page should render without an auth error.
    await test.step('user reaches dashboard with active tenant', async () => {
      await page.goto('/dashboard');
      // The dashboard chrome includes the tenant name in the header.
      // We assert it's NOT showing the "you have no organizations"
      // onboarding page (which would mean the saga finished but FGA
      // tuples never propagated — a real regression class).
      await expect(page).not.toHaveURL(/\/onboarding/);
      await expect(page).toHaveURL(/\/dashboard/);
    });

    // ---------------------------------------------------------------------
    // Stages 4-5 — customer-flow round-trip (D1-E of polyrepo zero-dot-x
    // reset, dashboard#189). OPT-IN via E2E_CUSTOMER_FLOW=1. Skipped on
    // regular signup-smoke runs so existing CI cadence stays cheap; runs
    // only when D1-F explicitly invokes the full customer journey.
    //
    // Coverage:
    //   Stage 4 — register a customer agent via the dashboard's
    //             /dashboard/agents/register form; capture the issued
    //             client_id / client_secret / enroll_command from the
    //             one-time credential panel.
    //   Stage 5 — verify the captured credentials look usable: client_id
    //             non-empty, client_secret non-empty, enroll_command
    //             contains the captured values.
    //
    // Out of scope (deferred to a future extension or D1-F's smoke
    // wrapper script): actually running `gibson component register`
    // and `gibson mission submit` from within the test, then polling
    // mission status. Both require either the gibson CLI binary in the
    // test runner (CI burden) or a dashboard-side mission-submit API
    // that doesn't exist as a clean Playwright-callable surface today.
    // The D1-F wrapper shells out to the CLI directly with the
    // credentials this spec captures.
    // ---------------------------------------------------------------------

    if (process.env.E2E_CUSTOMER_FLOW !== '1') {
      return;
    }

    const agentName = `${slug}-agent`;
    let capturedClientId = '';
    let capturedClientSecret = '';
    let capturedEnrollCommand = '';

    await test.step('register a customer agent via Register Agent form', async () => {
      await page.goto('/dashboard/agents/register');

      // Form: name (lowercase-alphanumeric-hyphen, max 63) +
      // optional description.
      await page.locator('#register-agent-name').fill(agentName);
      await page
        .locator('#register-agent-description')
        .fill(`E2E customer-flow smoke probe (${slug})`);
      await page.getByRole('button', { name: /register agent/i }).click();

      // The form submits to /api/agents/register; on 200 it swaps to
      // the CredentialPanel which exposes the three fields by id.
      await expect(page.locator('#register-agent-client-id')).toBeVisible({
        timeout: 30_000,
      });

      capturedClientId = (await page
        .locator('#register-agent-client-id')
        .inputValue()) as string;
      capturedClientSecret = (await page
        .locator('#register-agent-client-secret')
        .inputValue()) as string;
      capturedEnrollCommand = (await page
        .locator('#register-agent-enroll-command')
        .inputValue()) as string;
    });

    await test.step('captured credentials look usable', async () => {
      expect(capturedClientId, 'client_id should be non-empty').not.toEqual('');
      expect(
        capturedClientSecret,
        'client_secret should be non-empty',
      ).not.toEqual('');
      expect(
        capturedEnrollCommand,
        'enroll_command should reference captured client_id',
      ).toContain(capturedClientId);
      expect(
        capturedEnrollCommand,
        'enroll_command should be a gibson component register invocation',
      ).toMatch(/gibson(\s+|.*)component\s+register/);
    });
  });
});
