# Dashboard E2E Test Suite

## Running

```bash
# Full suite (all spec files under e2e/)
pnpm test:e2e

# Auth error regression suite only
pnpm test:e2e:auth-errors

# All auth regression checks (static + e2e)
pnpm check:auth-regression

# Individual specs (compile + list without running — no cluster required)
pnpm exec playwright test --list e2e/tenant-provision.spec.ts
pnpm exec playwright test --list e2e/agent-enrollment.spec.ts
pnpm exec playwright test --list e2e/mission-execute.spec.ts
pnpm exec playwright test --list e2e/billing-webhook.spec.ts
pnpm exec playwright test --list e2e/plan-change.spec.ts

# Stubbed tests only (require TEST_AUTH_BYPASS=1 but no kind cluster)
TEST_AUTH_BYPASS=1 AUTH_SECRET=<your-local-secret> pnpm test:e2e e2e/tenant-provision.spec.ts
TEST_AUTH_BYPASS=1 AUTH_SECRET=<your-local-secret> pnpm test:e2e e2e/agent-enrollment.spec.ts
TEST_AUTH_BYPASS=1 AUTH_SECRET=<your-local-secret> pnpm test:e2e e2e/mission-execute.spec.ts

# Integration tests (require kind cluster)
E2E_KIND_AVAILABLE=1 PLAYWRIGHT_BASE_URL=https://app.zeroroot.local:30443 \
  pnpm test:e2e e2e/tenant-provision.spec.ts

# Billing webhook tests against the kind cluster
E2E_KIND_AVAILABLE=1 PLAYWRIGHT_BASE_URL=https://app.zeroroot.local:30443 \
  STRIPE_WEBHOOK_SECRET=whsec_testonly_e2e_playwright_secret_1234567890 \
  pnpm test:e2e e2e/billing-webhook.spec.ts
E2E_KIND_AVAILABLE=1 PLAYWRIGHT_BASE_URL=https://app.zeroroot.local:30443 \
  STRIPE_WEBHOOK_SECRET=whsec_testonly_e2e_playwright_secret_1234567890 \
  pnpm test:e2e e2e/plan-change.spec.ts
```

## New specs (slices 5.7, 5.8, 5.9)

### Spec inventory

| Spec | Slice | Description |
|---|---|---|
| `e2e/tenant-provision.spec.ts` | 5.7 p1 | Tenant provisioning: signup → saga → dashboard state at each checkpoint |
| `e2e/agent-enrollment.spec.ts` | 5.7 p2 | Agent enrollment: Register Agent form → credential panel → agent list |
| `e2e/mission-execute.spec.ts` | 5.8 | Mission execution: submit → pending → completed → findings → audit |
| `e2e/billing-webhook.spec.ts` | 5.9 p1 | Stripe webhook: subscription.updated, invoice.payment_failed, idempotency |
| `e2e/plan-change.spec.ts` | 5.9 p2 | Plan change: checkout stub → callback → quota adjustment → audit |

### Page objects (shared helpers)

Located under `e2e/page-objects/`:

| File | Purpose |
|---|---|
| `auth.po.ts` | Inject synthetic Auth.js sessions; stub `/api/auth/my-memberships` |
| `dashboard.po.ts` | Navigate to dashboard; stub daemon proxy and tier endpoints |
| `billing.po.ts` | Sign Stripe webhooks with HMAC-SHA256; stub checkout; build event payloads |

### Skip gate conventions

Every spec uses `test.skip()` at the describe level for blocks that require
infrastructure. The two gates used across these specs are:

- `test.skip(!process.env.TEST_AUTH_BYPASS, ...)` — for tests that inject
  synthetic session cookies (requires `TEST_AUTH_BYPASS=1` on the server).
- `test.skip(!process.env.E2E_KIND_AVAILABLE, ...)` — for integration tests
  that require a live kind cluster.

Tests with neither gate run unconditionally (e.g., the billing UI-stub tests
that use only `page.route()` interception).

### Stripe webhook secret wiring

The billing webhook endpoint verifies the `Stripe-Signature` header using
`STRIPE_WEBHOOK_SECRET`. For integration tests to exercise the full path:

1. Set `STRIPE_WEBHOOK_SECRET=whsec_testonly_e2e_playwright_secret_1234567890`
   on the kind cluster's dashboard pod (via Helm values override or kubectl patch).
2. The spec uses the same constant (`STRIPE_WEBHOOK_TEST_SECRET` from
   `e2e/page-objects/billing.po.ts`) to sign payloads.

This secret is a test-only constant. It MUST NOT be set in production.

A follow-up issue (`dashboard#223`) tracks wiring this secret into the
`dispatch-auth-e2e` workflow so billing webhook tests run automatically on CI.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PLAYWRIGHT_BASE_URL` | No | Target cluster URL. Defaults to `http://localhost:30081` (Kind gibson NodePort). |
| `E2E_AUTH_SUITE` | No | When set, Playwright skips the local dev server webServer config and targets the cluster directly. |
| `DASHBOARD_K8S_NAMESPACE` | No | Kubernetes namespace for kubectl log tailing. Default: `gibson`. |
| `DASHBOARD_K8S_POD_LABEL` | No | Label selector for the dashboard pod. Default: `app.kubernetes.io/name=gibson-dashboard`. |
| `DASHBOARD_LOG_FILE` | No | Path to a local log file to tail instead of kubectl. Useful for local dev server runs. |
| `DATABASE_URL` | No | Postgres connection string for DB assertion helpers. Falls back to PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE env vars. |
| `TRACE_EMAIL` | login-trace only | Pre-existing Zitadel user email for the login-trace diagnostic spec. |
| `TRACE_PASSWORD` | login-trace only | Password for TRACE_EMAIL. |

## Test fixture environment variables (server-side)

These variables are set on the **Next.js server process** (not in the Playwright runner) to enable
test-only code paths. They must NEVER be set in production, staging, or any environment accessible
to real users.

| Variable | Value | Effect |
|---|---|---|
| `TEST_FIXTURES_ENABLED` | `"true"` | Activates the `/api/test/inject-fault` and `/api/test/fga-revoke` endpoints. Enables the `getFaultMode()` checks in `getMyMemberships()` and `auth.ts` callbacks. Returns 404 for both endpoints when unset. |
| `TEST_FIXTURES_BYPASS_PRICING` | `"true"` | Bypasses the `/pricing?missing_plan=true` redirect on `/signup` when no `?plan=` query param is present. Allows e2e signup tests to run on clusters without plan configuration. Falls through with the first self-serve plan ID. |

## Fault injection

The auth error regression suite (`e2e/auth/login-error-regression.spec.ts`) uses
server-side fault injection to deterministically trigger auth failures without killing
real infrastructure pods.

### How it works

1. The test POSTs to `/api/test/inject-fault` (requires `TEST_FIXTURES_ENABLED=true` on the server)
   to arm a fault for a specific subsystem.
2. The test drives a sign-in flow (e.g. via `signUpViaForm` or `loginViaZitadelV2`).
3. The Next.js server checks `getFaultMode(subsystem)` at the top of the relevant code path
   and returns the configured failure shape instead of making the real call.
4. The test asserts the user landed on `/login/error?reason=<expected>` with the right copy
   and that the Prometheus counter incremented.
5. The test clears the fault via `armFault(page, subsystem, "clear")`.

### Subsystems

| Subsystem | Where wired | Fault effect |
|---|---|---|
| `fga` | `src/lib/auth/membership.ts:getMyMemberships()` | `mode="503"` → `MembershipResolutionError("fga_unavailable")`. `mode="malformed-200"` → `MembershipResolutionError("malformed_response")`. |
| `jwks` | `auth.ts` jwt callback (fires on initial sign-in only) | Throws inside the jwt callback → Auth.js redirects to `/login?error=Callback` → middleware reroutes to `/login/error?reason=jwks_unavailable`. |
| `token-exchange` | `auth.ts` jwt callback (fires on initial sign-in only) | Same mechanism as jwks but reason=`oidc_token_exchange_failed`. |

### Playwright helpers

```typescript
import { armFault, clearAllFaults, isFaultInjectionAvailable, revokeTestMembership }
  from "./fixtures/fault-proxy";

// Check availability before arming
const faultable = await isFaultInjectionAvailable(page);
if (!faultable) { test.skip(true, "TEST_FIXTURES_ENABLED not set"); return; }

// Arm a fault
await armFault(page, "fga", "503", "next-1-calls");

// Arm for all subsequent calls
await armFault(page, "fga", "malformed-200", "all");

// Simulate mid-session membership revocation
await revokeTestMembership(page, "user:abc", "tenant:xyz");

// Always clean up in afterEach
await clearAllFaults(page);
```

### FGA revoke (tenant_revoked test)

The `/api/test/fga-revoke` endpoint arms a scoped `next-1-calls` FGA 503 fault to simulate
mid-session membership revocation. Navigate to a protected route immediately after calling it.

Current limitation: the endpoint arms a fault-injection fault rather than deleting the real FGA
tuple (the dashboard pod does not hold FGA write access in test clusters). This is equivalent
for deterministic e2e testing. When the daemon exposes an HTTP `InvalidateSubject` endpoint,
the implementation can be upgraded to do a real tuple delete + cache flush.

Cache TTL fallback: if neither the fault-injection path nor a direct delete works in a given
environment, set the FGA cache TTL to 5s in chart values and call
`await page.waitForTimeout(7000)` after a real DB membership delete before navigating.
