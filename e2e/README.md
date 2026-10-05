# Dashboard e2e suite

The suite runs a real browser against a live product host. The lane is
`.github/workflows/e2e-staging.yml`. It runs against
`https://app.staging.zeroroot.ai` on every push to `main` that touches
`e2e/**`, `playwright.config.ts` or the workflow, and once a day. It never
runs on a pull request (ADR-0080). The merge gate stays `node-ci.yml`.

## The route walk

`e2e/routes.spec.ts` lists every `page.tsx` under `app/` when Playwright loads
the file, so the suite covers a new page the day it lands and drops a deleted
one the same day. There is no manifest to keep current. Each static page gets
two tests: signed out (below 500, and an `(auth)` page lands on `/login`) and
signed in as the admin account (200, no error boundary, a non-empty `<main>`).
A page with a dynamic segment skips with a reason that names the segment,
because the walk has no fixture for it.

## How a spec signs in

Nothing forges a session (ADR-0027, dashboard#164). A spec that needs a
signed-in browser calls `signIn()` from `e2e/auth/helpers/accounts.ts`. The
helper presses the `/login` gate, then drives Zitadel's hosted Login v2:
email, password and a TOTP code. ADR-0093 requires MFA on every account, so
each lane account carries the base32 secret of its authenticator app.

Two accounts exist, both in the e2e tenant on staging:

| Variables | Who |
|---|---|
| `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `E2E_ADMIN_TOTP_SECRET` | the Owner or an Admin of the e2e tenant |
| `E2E_MEMBER_EMAIL`, `E2E_MEMBER_PASSWORD`, `E2E_MEMBER_TOTP_SECRET` | a Viewer of the same tenant |

The lane reads them from repository secrets of the same name. A spec whose
account is unset skips with a reason that names the variables. The skip
floor (below) turns an all-skipped run into a failure, so an unset secret is
red, never green.

## Running

```bash
# The whole suite against a host (the lane's command)
PLAYWRIGHT_BASE_URL=https://app.staging.zeroroot.ai \
  E2E_CLUSTER_AVAILABLE=1 \
  E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... E2E_ADMIN_TOTP_SECRET=... \
  E2E_MEMBER_EMAIL=... E2E_MEMBER_PASSWORD=... E2E_MEMBER_TOTP_SECRET=... \
  pnpm test:e2e

# One spec
PLAYWRIGHT_BASE_URL=... E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... E2E_ADMIN_TOTP_SECRET=... \
  pnpm test:e2e e2e/auth/login-happy.spec.ts

# Developer conveniences: the Playwright UI and the inspector
pnpm test:e2e:ui
pnpm test:e2e:debug

# Compile and list every spec, no host needed
pnpm exec playwright test --list

# The skip floor
node e2e/skip-floor.mjs playwright-report/test-results.json
node e2e/skip-floor.mjs --selftest
```

## Environment variables

| Variable | Set by | Meaning |
|---|---|---|
| `PLAYWRIGHT_BASE_URL` | the lane | The product host. Default `http://localhost:3000`. |
| `E2E_CLUSTER_AVAILABLE` | the lane | `1` when a live platform is behind the host. Gates the specs that write to the tenant. |
| `E2E_ADMIN_*`, `E2E_MEMBER_*` | repository secrets | The two accounts above. |
| `E2E_CONNECTOR_NAME` | optional | Catalog display name `connectors.spec.ts` drives. Default `GitLab`. |
| `E2E_MIN_RAN` | optional | The skip floor. Default `1`. |
| `CI` | the lane | One worker, two retries, `test.only` refused. |

## The skip floor

`e2e/skip-floor.mjs` reads `playwright-report/test-results.json` after the
run. It fails when the report holds zero tests, when every test skipped, or
when fewer than `E2E_MIN_RAN` tests ran. It prints every skip with its
reason. `--selftest` proves the floor can fail: an all-skipped report and an
empty report are refused, one passed test is accepted. The lane runs the
selftest in its `guards` job before the suite.

## What the suite writes to staging

Two specs write to the e2e tenant, and only with `E2E_CLUSTER_AVAILABLE=1`:

- `agent-enrollment.spec.ts` registers one agent per run, named
  `e2e-<timestamp>-<random>`.
- `connectors.spec.ts` enables the catalog connector on its first run. Later
  runs find it enabled.

## Verdict per spec file

Measured on `origin/main` on 2026-10-02: 53 spec files, 16,824 lines under
`e2e/`, no workflow. Every file got one verdict after a read of its body:
`staging lane` runs as is, `rewrite` runs after the change named, `delete`
tests a surface the dashboard no longer has or needs a gate nobody can set
on staging. The rewrites landed in the same change, so every file that
stays runs in the lane.

Facts the verdicts rest on:

- `/login` is a gate with one "Sign in" button. The inline email and
  password form every `loginAs()` helper filled does not exist.
- Signup needs a verification mail. The daemon sends it through SES on
  staging, and the lane cannot read it. The signup chain is proven daily
  on kind with Mailpit by hosted's `exit-test-signup.yml`.
- `/api/gibson-proxy` does not exist. The admin pages are server
  components, and the data they show comes from server actions, so a
  `page.route()` on that path mocks nothing.
- Zitadel owns password reset, email verification and lockout (ADR-0093).
- `TEST_FIXTURES_ENABLED` must never be set on a shared environment.
- `/docs`, `/pricing`, `/dashboard/teams`, `/dashboard/audit`,
  `/dashboard/permissions`, `/dashboard/pages/settings/permissions`,
  `/dashboard/pages/missions`, `/dashboard/pages/findings`,
  `/tenant/<slug>/findings`, `/api/missions/create`, `/api/audit`,
  `/api/billing/checkout` and `/api/test/server-action` do not exist.

| Spec file | Verdict | Why |
|---|---|---|
| `admin-chrome.spec.ts` | rewrite | Inline login replaced by `signIn()`. Users page path and CTA names updated. |
| `agent-enrollment.spec.ts` | rewrite | Inline login replaced. `E2E_KIND_AVAILABLE` renamed `E2E_CLUSTER_AVAILABLE`. The credential panel shows a bootstrap token, not a client id. |
| `connectors.spec.ts` | rewrite | Inline login replaced, gate renamed, member test uses the Viewer account. The team-deny and agent-grant tests are gone: the teams form changed and the agent grants tab does not exist. |
| `crd-authz.spec.ts` | delete | Needs the `/api/test/server-action` bridge, a second tenant and a human platform-operator account (ADR-0093: never a person). |
| `docs.spec.ts` | delete | `/docs` is not served by the dashboard. |
| `extended-agents.spec.ts` | delete | Mocks `listAccessibleComponents`, a server action. The mock never fires and the asserted rows never render. |
| `extended-plugins.spec.ts` | delete | Same mechanism as above. |
| `extended-tools.spec.ts` | delete | Same mechanism as above. |
| `grants.spec.ts` | delete | Mocks `/api/gibson-proxy`; the page is a server component. |
| `granular-permissions.spec.ts` | delete | `/dashboard/teams`, `/dashboard/audit` and `/dashboard/permissions` do not exist. |
| `install-agent-action.int.test.ts` | delete | A vitest file under `e2e/` with no config and a captured-session gate. It broke `playwright test --list`. |
| `mission-execute.spec.ts` | delete | `/api/missions/create`, `/api/audit` and the `pages/missions` routes do not exist; needs a debug agent fixture. |
| `mission-secrets-panel.spec.ts` | delete | Mocks `/api/gibson-proxy` for a mission id that does not exist. |
| `missions-list.spec.ts` | rewrite | Inline login replaced by `signIn()`. |
| `permissions.spec.ts` | delete | `/dashboard/pages/settings/permissions` does not exist. |
| `plan-and-usage.spec.ts` | delete | The "Plan & Usage" copy is not in the tree; the quota mock targets a server action. |
| `plan-change.spec.ts` | delete | `/api/billing/checkout` and `/pricing` do not exist. |
| `secrets-backend.spec.ts` | delete | Mocks `/api/gibson-proxy`. A live run would switch the tenant's secret broker. |
| `signup-smoke.spec.ts` | delete | Needs the verification mail; superseded by hosted `exit-test-signup.yml`. |
| `social-signin.spec.ts` | delete | External identity providers are off (ADR-0093). The GitHub button does not render. |
| `tenant-display.spec.ts` | rewrite | Inline login replaced by `signIn()`. |
| `tenant-provision.spec.ts` | delete | Signup per run; superseded by hosted `exit-test-signup.yml`. |
| `auth/dashboard-smoke.spec.ts` | delete | Self-provisions two tenants by signup, reads a gibson manifest from a sibling checkout, writes files for a Go half that does not run (gibson#215). |
| `auth/forgot-reset.spec.ts` | delete | Zitadel owns password reset; scrapes the deleted log mail provider. |
| `auth/login-error-regression.spec.ts` | rewrite | Trimmed to the public `/login/error` test, one per reason. The fault tests needed `TEST_FIXTURES_ENABLED` and a signup each. |
| `auth/login-full-chain.spec.ts` | delete | Gated on `SIGNUP_VERIFY_TOKEN`, which nobody can set on staging (gibson#215). |
| `auth/login-happy.spec.ts` | rewrite | Uses the admin account and the shared Zitadel helper. The signup branch and `E2E_SEED_*` are gone. |
| `auth/login-lockout.spec.ts` | delete | Zitadel owns lockout; inline login; scrapes the log mail provider. |
| `auth/login-trace.spec.ts` | delete | A diagnostic copy of the login helper, without MFA. |
| `auth/mission-run.spec.ts` | delete | Reads a `/tmp` file a Go test writes; `/tenant/<slug>/findings` does not exist. |
| `auth/no-workspace.spec.ts` | delete | Deletes membership rows in Postgres after a signup. |
| `auth/session-cookie-samesite.spec.ts` | staging lane | Public routes only. |
| `auth/session-expiry.spec.ts` | rewrite | Signs in as the admin, clears cookies, asserts the `/login?callbackUrl=` redirect. |
| `auth/signup-autologin.spec.ts` | delete | Auto-login was retired in E9; `/pricing` does not exist. |
| `auth/signup-collision.spec.ts` | delete | Drives the single-screen signup form that no longer exists. |
| `auth/signup-duplicate-email.spec.ts` | delete | Same form. |
| `auth/signup-full-chain.spec.ts` | delete | Gated on `SIGNUP_VERIFY_TOKEN`; superseded by hosted `exit-test-signup.yml`. |
| `auth/signup-happy-path.spec.ts` | delete | `/pricing`, the old form, `kubectl` cleanup. |
| `auth/signup-happy.spec.ts` | delete | Gated on `SIGNUP_VERIFY_TOKEN`. |
| `auth/signup-saga-conditions.spec.ts` | delete | `kubectl --context kind-gibson`; the kind cluster is gone. |
| `auth/signup-trace.spec.ts` | delete | Drives the old single-screen form; a diagnostic. |
| `auth/signup-vault.spec.ts` | delete | Gated on `SIGNUP_VERIFY_TOKEN`; `kubectl` against kind. |
| `auth/tenant-forbidden.spec.ts` | delete | Signup plus log scraping; `/dashboard/<slug>/...` routes do not exist; one tenant per person (ADR-0093). |
| `auth/verify-email.spec.ts` | delete | The `/verify-email` flow is dead; scrapes the log mail provider. |
| `authz/admin.spec.ts` | rewrite | Signs in as the admin; mocks removed; nav titles are `Secrets`, `Secret Broker`, `Permissions`. |
| `authz/non-admin.spec.ts` | rewrite | Signs in as the Viewer; mocks removed, so the server-side refusals are real. |
| `authz/server-action-bypass.spec.ts` | rewrite | Signs in as the Viewer; `/api/gibson-proxy` state check removed. |
| `secrets/create.spec.ts` | delete | Mocks `/api/gibson-proxy`; the form submits a server action. |
| `secrets/delete.spec.ts` | delete | Same, for a secret id that does not exist. |
| `secrets/list.spec.ts` | delete | Same. |
| `secrets/rotate.spec.ts` | delete | Same. |
| `visual/docs-routes.spec.ts` | delete | `/docs/*` is not served; no baseline PNG was ever committed. |
| `visual/public-routes.spec.ts` | delete | `/pricing` is not served; no baseline; the venue was a local dev server. |

Helpers that only deleted specs used are gone with them: `auth/helpers/db.ts`,
`auth/helpers/email-log.ts`, `auth/helpers/fixtures.ts`,
`auth/helpers/signup-via-form.ts`, `auth/helpers/artifact-dir.ts`,
`auth/fixtures/fault-proxy.ts`, `page-objects/billing.po.ts`,
`page-objects/dashboard.po.ts` and `console-allowlist.yaml`.

## Coverage the deletions removed

These assertions had no venue and are listed so a later change can give
them one:

- the secrets form never writes a secret value to `localStorage` or
  `sessionStorage`, and the detail page has no reveal control
  (`secrets/*.spec.ts`);
- the secret broker form never echoes a Vault token into an error
  (`secrets-backend.spec.ts`);
- an authenticated probe of every dashboard route in gibson's manifest, and
  the cross-tenant 403 on each (`auth/dashboard-smoke.spec.ts`, gibson#215).
