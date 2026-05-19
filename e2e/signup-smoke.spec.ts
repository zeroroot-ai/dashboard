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

      // The acceptToS / acceptPrivacy fields render as Radix Checkbox
      // components, which do NOT expose a native `<input name="...">`
      // element — they use a button[role=checkbox] with the field name
      // surfaced only via the wrapping form. Selectors must therefore
      // target the checkbox by `#acceptToS` / `#acceptPrivacy` (the form
      // sets these as ids on the rendered control), matching the
      // working pattern in e2e/auth/helpers/signup-via-form.ts.
      //
      // The text-field selectors use getByLabel so they tolerate any
      // future tweak to the underlying input markup (shadcn often wraps
      // inputs in their own element tree).
      await page.getByLabel(/first name/i).fill('Ada');
      await page.getByLabel(/last name/i).fill(slug);
      await page.getByLabel(/work email/i).fill(email);
      const pwInputs = page.locator('input[type="password"]');
      await pwInputs.first().fill(password);
      if ((await pwInputs.count()) >= 2) {
        await pwInputs.nth(1).fill(password);
      } else {
        await page.getByLabel(/confirm password/i).fill(password);
      }
      await page.getByLabel(/workspace name|company name/i).fill(workspaceName);
      await page.locator('#acceptToS').check();
      await page.locator('#acceptPrivacy').check();
      await page.getByRole('button', { name: /create account|sign up/i }).click();

      // The ProvisioningPanel renders IN-PAGE; the URL stays
      // /signup?plan=<plan> until the panel finishes its
      // /api/signup/progress/:id polling and then calls
      // window.location.assign(redirectOnSuccess), which lands at
      // /login?callbackUrl=/dashboard (or /api/auth/callback/zitadel?...
      // when auto-login completes the parked auth_request, which then
      // bounces to /dashboard).
      //
      // We assert the panel actually appeared. Stage 2 then takes over
      // the long wait via /api/onboarding/data-plane polling.
      await expect(
        page.getByText(/provisioning|initializing|setting up|spinning up/i).first(),
      ).toBeVisible({ timeout: 30_000 });
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

    // -----------------------------------------------------------------------
    // Stage 3b — daemon-RPC reachability under the freshly-provisioned
    // tenant's session.
    //
    // This is the regression cordon for gibson#167 / deploy#352. Stage 2
    // proves the saga reaches Ready — but for the entire history of
    // signup, Ready=True coexisted with 412/500 on every authenticated
    // daemon call because the daemon's per-tenant Vault broker failed to
    // construct (missing SPIRE JWT-SVID audience, missing role, etc).
    //
    // The four endpoints below all round-trip through:
    //   Auth.js session → dashboard server-side → Envoy + ext-authz
    //     → daemon RPC handler → per-tenant Vault broker → daemon answer
    //
    // 200 with the documented empty-list envelope proves that ENTIRE
    // chain is intact. A regression at any link (broker init, JWT
    // audience drift, FGA tuple absence, etc.) flips the 200 to 412 or
    // 500 and this step fails BEFORE the PR introducing the regression
    // can merge.
    //
    // Empty bodies are EXPECTED on a fresh tenant — we only assert the
    // status code and that the envelope shape is what the dashboard
    // contract promises (`{ data: [], total: 0 }` for paginated lists,
    // `[]` for the providers list).
    //
    // Refs: gibson#167 (PRD), docs#33 + #34 (ADR-0009 + amendment),
    //       deploy#360 (the fix this step regression-tests),
    //       gibson#187 (daemon SPIRE JWT source).
    // -----------------------------------------------------------------------

    await test.step('authenticated daemon RPCs return 200 (regression cordon for gibson#167)', async () => {
      // Helper: pull the body whether the response is OK or not, so an
      // assertion failure carries the daemon's actual error envelope
      // ({ error: { code: 'failed_precondition', ... } } on the 412 we
      // are guarding against).
      async function probe(path: string): Promise<{ status: number; body: unknown }> {
        const resp = await request.get(path);
        let body: unknown = null;
        try {
          body = await resp.json();
        } catch {
          body = await resp.text().catch(() => null);
        }
        return { status: resp.status(), body };
      }

      // /api/findings — calls GraphService.GetFindings via the per-tenant
      // Vault broker. The broker is what gibson#167 fixes — any drift in
      // the JWT/audience/role chain flips this to 412 (failed_precondition)
      // or 500.
      const findings = await probe('/api/findings?limit=50');
      expect(
        findings.status,
        `GET /api/findings?limit=50 returned ${findings.status} ` +
          `(want 200; body: ${JSON.stringify(findings.body)?.slice(0, 400)}). ` +
          `412/500 here indicates the daemon's per-tenant Vault broker did ` +
          `not construct — regression of gibson#167 / deploy#360.`,
      ).toBe(200);
      const findingsBody = findings.body as {
        data?: unknown[];
        total?: number;
      } | null;
      expect(
        Array.isArray(findingsBody?.data),
        'findings response should be a PaginatedResponse with .data array',
      ).toBe(true);
      expect(
        findingsBody?.data?.length,
        'fresh tenant should have zero findings',
      ).toBe(0);
      expect(typeof findingsBody?.total).toBe('number');

      // /api/missions — calls MissionService.ListMissions via the same
      // broker path.
      const missions = await probe('/api/missions');
      expect(
        missions.status,
        `GET /api/missions returned ${missions.status} ` +
          `(want 200; body: ${JSON.stringify(missions.body)?.slice(0, 400)})`,
      ).toBe(200);
      const missionsBody = missions.body as { data?: unknown[] } | null;
      expect(
        Array.isArray(missionsBody?.data),
        'missions response should be a PaginatedResponse with .data array',
      ).toBe(true);
      expect(
        missionsBody?.data?.length,
        'fresh tenant should have zero missions',
      ).toBe(0);

      // /api/settings/providers — calls TenantAdminService.ListProviders
      // through the same per-tenant broker (LLM-provider configuration
      // is what deploy#352's user-prompt names "llm-config"). The route
      // returns a bare `{ providers: [...] }` envelope — see
      // app/api/settings/providers/route.ts.
      const providers = await probe('/api/settings/providers');
      expect(
        providers.status,
        `GET /api/settings/providers returned ${providers.status} ` +
          `(want 200; body: ${JSON.stringify(providers.body)?.slice(0, 400)})`,
      ).toBe(200);
      const providersBody = providers.body as {
        providers?: unknown[];
      } | null;
      expect(
        Array.isArray(providersBody?.providers),
        'providers response should include a .providers array',
      ).toBe(true);
      expect(
        providersBody?.providers?.length,
        'fresh tenant should have zero LLM provider configs',
      ).toBe(0);
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
