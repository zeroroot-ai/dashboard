# Changelog

All notable changes to the Gibson Dashboard are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.11.0](https://github.com/zero-day-ai/dashboard/compare/v1.10.0...v1.11.0) (2026-05-13)


### Features

* **build:** point Dockerfile FROM at ghcr.io mirror ([#28](https://github.com/zero-day-ai/dashboard/issues/28)) ([5445955](https://github.com/zero-day-ai/dashboard/commit/5445955f79ad7efec0ab4a3dcec01e8ace1a319b))
* **build:** pull plans.yaml from tenant-operator at image build ([#22](https://github.com/zero-day-ai/dashboard/issues/22)) ([99ca903](https://github.com/zero-day-ai/dashboard/commit/99ca9035b7e33e001596186bf54e78d058cf21b7))


### Bug Fixes

* **api:** drop 'use server' from billing route handlers ([#25](https://github.com/zero-day-ai/dashboard/issues/25)) ([f4f8dd6](https://github.com/zero-day-ai/dashboard/commit/f4f8dd6ec0442f41e323a67f832e7803de85dadb))
* **build:** route gen-plans diagnostics to stderr ([c83d707](https://github.com/zero-day-ai/dashboard/commit/c83d707a9525fac138dd80ff1a2246a5c9e5b667))
* **build:** skip plans-fresh + stripe-tiers gates in Docker ([#24](https://github.com/zero-day-ai/dashboard/issues/24)) ([29d2c88](https://github.com/zero-day-ai/dashboard/commit/29d2c887287425eec7744b993d1dcc1ff18a5863))
* **pricing:** route Start-trial CTA to /signup?plan= so signup loads ([#29](https://github.com/zero-day-ai/dashboard/issues/29)) ([c511aed](https://github.com/zero-day-ai/dashboard/commit/c511aed7109cb7e7993638cc378bec0fec5e82b2))

## [1.10.0](https://github.com/zero-day-ai/dashboard/compare/v1.9.0...v1.10.0) (2026-05-11)


### Features

* add org tier and restructure pricing page ([#19](https://github.com/zero-day-ai/dashboard/issues/19)) ([b30c18d](https://github.com/zero-day-ai/dashboard/commit/b30c18dddf21e73adc916c0c684a9980030a4046))
* **billing:** live Stripe price overlay on pricing page ([#21](https://github.com/zero-day-ai/dashboard/issues/21)) ([8504b80](https://github.com/zero-day-ai/dashboard/commit/8504b807d43f3e697b3a688f348f09ec83b2422f))

## [1.9.0](https://github.com/zero-day-ai/dashboard/compare/v1.8.0...v1.9.0) (2026-05-10)


### Features

* **billing:** Phase 1 foundations — types, stripe wrapper, idempotency table, guards, metrics ([7629c27](https://github.com/zero-day-ai/dashboard/commit/7629c279f7226bbed6113309529258e46dec1aea))
* **billing:** Phase 2 email infrastructure — SES provider, 5 billing templates, snapshot tests ([9dc6431](https://github.com/zero-day-ai/dashboard/commit/9dc643174c9af53737476843b8ea2591b440cf1b))
* **billing:** Phase 3 checkout endpoint — POST /api/billing/checkout with 16 unit tests ([1b32072](https://github.com/zero-day-ai/dashboard/commit/1b3207211dc7df30822853755fac16c1f9c491cf))
* **billing:** Phase 6 webhook subdomain — 410 tombstone, cutover runbook ([523edc5](https://github.com/zero-day-ai/dashboard/commit/523edc5a6d7ed435d885e4cf69971c538b37bc6b))
* **billing:** Phase 7 webhook lifecycle handlers — 7 event types, console migration, 38 tests ([84bdd01](https://github.com/zero-day-ai/dashboard/commit/84bdd01bf7b82f5552ddce921b4491ac23b6f41c))
* **billing:** Phases 14+15 — Grafana dashboard, Prometheus alerts, bootstrap script, cleanup guards ([544d95d](https://github.com/zero-day-ai/dashboard/commit/544d95dee1f43196cb0b04b04653c548568abe5e))
* **billing:** Phases 4+5 — CheckoutButton, pricing page CTAs, portal route, billing settings page ([8ccad87](https://github.com/zero-day-ai/dashboard/commit/8ccad878441fd7eb462550dbb6853d8b6e596ee4))
* **billing:** Phases 9+11 — admin tools, boot guard, Stripe test suite ([ea5f933](https://github.com/zero-day-ai/dashboard/commit/ea5f933fa568c6bae28361aa6586c6920790f3aa))
* dashboard W1+W2 hardening + Pino logger + R7/R9/R17/R18/R11 ([3d0d1f6](https://github.com/zero-day-ai/dashboard/commit/3d0d1f6c30eec9e8b90a25da606d684a040234be))
* **dashboard:** generate BillingTier + PRICE_ENV_MAP from plans.yaml ([e008898](https://github.com/zero-day-ai/dashboard/commit/e0088986cd7311eecae508e91172b85c4cb1e06b))
* **dashboard:** in-app quota UX + Phase 7.B sweep of legacy fields ([f0161ef](https://github.com/zero-day-ai/dashboard/commit/f0161ef30893b253d6c82d95fd4f6d40a7a442c5))
* **dashboard:** mission checkpoint browser + tool-stream SSE bridge ([383125e](https://github.com/zero-day-ai/dashboard/commit/383125e274e18783fb7e3248d9efdd7a350cc8bf))
* **dashboard:** mission events SSE bridge + per-tool streaming progress on detail page ([5889b28](https://github.com/zero-day-ai/dashboard/commit/5889b28976f454b3fec57142ee6b8680df01bf90))
* **dashboard:** mission-draft server actions for the create page ([7a852f7](https://github.com/zero-day-ai/dashboard/commit/7a852f7ef2911c5cbf1e13cc71a4d1d518b1e9ca))
* **dashboard:** mission-draft UI on the create page ([e01099b](https://github.com/zero-day-ai/dashboard/commit/e01099bdbe29f83ea85272e401ca2ef1646f8db9))
* **dashboard:** regen plans.ts for 3-plan schema + drift gate ([3cde94a](https://github.com/zero-day-ai/dashboard/commit/3cde94a5a424d294a8ab0d15aeb4f41cdd159c5f))
* **dashboard:** seed in-app quota UX hook + Server Action ([f8266a6](https://github.com/zero-day-ai/dashboard/commit/f8266a6c67b0fe0e0e99aa02fb8782ff15287421))
* **dashboard:** three-card pricing page driven by plans.yaml ([4b812c3](https://github.com/zero-day-ai/dashboard/commit/4b812c30c9d37ad3cebbcb0f0c7dda2c5b617b48))
* **dashboard:** v1.8.0 — eliminate permissive-dev paths, no localhost defaults, no console.* in hooks, no skipped tests ([7760e05](https://github.com/zero-day-ai/dashboard/commit/7760e0544d0b74f3eb897cc0b70a9bdbfe064d9e))
* install release-please and pr-title-lint ([#16](https://github.com/zero-day-ai/dashboard/issues/16)) ([77709e6](https://github.com/zero-day-ai/dashboard/commit/77709e6c5e05749d8c0aaab1316352eb894a2921))
* **signup:** client-side reserved-names check via daemon GetReservedNames ([f918da4](https://github.com/zero-day-ai/dashboard/commit/f918da4ade7d806480c7437cd1019e61b0f0788a))


### Bug Fixes

* **billing:** fix 3 TypeScript errors in billing tests and bootstrap script ([0ad4c08](https://github.com/zero-day-ai/dashboard/commit/0ad4c084c83d6190c355daff5fd1f1bf65f3642f))

## [1.6.0] - 2026-05-04

Completes the dashboard side of the
**`tenant-secrets-broker-completion`** spec. Pairs with gibson v0.29.0
and SDK v0.99.0.

The `/settings/secrets-backend` page now does what its UI has been
claiming since `secrets-tenant-lifecycle` shipped — switching providers
actually changes the broker that serves the tenant's secrets. Before
this change, calls landed as `Unimplemented` because the SDK admin v1
service was never registered on the daemon side; that's now fixed in
gibson v0.29.0. This release adds the dashboard counterpart: a real
secret-count drives the migration warning, and an explicit "I
understand" checkbox gates Save when switching with secrets present.

### Added

- **`countSecrets()`** typed wrapper in
  `src/lib/gibson-client/tenant-broker-config.ts` for the new
  `gibson.admin.v1.TenantAdminService.CountSecrets` admin RPC.
- **Acknowledgement checkbox** in `SecretsBackendForm`. When the user
  is switching from the currently-configured provider AND the tenant
  has at least one existing secret (or the count RPC is unreachable),
  an inline amber warning appears with a Shadcn Checkbox. Save is
  disabled until the checkbox is ticked. The checkbox resets when the
  selected provider changes again.

### Changed

- **`SecretsBackendContent` now fetches the broker config and the
  secret count in parallel** via `Promise.allSettled` and threads a
  real `secretCount: number` through to the form. The previous
  hard-coded `hasExistingSecrets = true` (which forced the warning to
  fire on every provider switch regardless of state) is gone.
- **The migration warning is now an inline alert with an
  acknowledgement checkbox**, replacing the always-on
  `MigrationWarningDialog` (which has been removed). Provider
  switching is no longer dialog-gated; the checkbox-gates-Save model
  matches the spec design's "fail-loud, opt-in" requirement.
- **TS proto bindings + authz registry regenerated** for SDK v0.99.0
  via `pnpm proto:generate` and `pnpm prebuild`. New entry
  `/gibson.admin.v1.TenantAdminService/CountSecrets` in
  `src/gen/authz/registry.ts`; `useAuthorize` and `assertAuthorized`
  pick it up automatically.

### Sentinel: `secretCount === -1`

When the daemon's `CountSecrets` RPC is unreachable
(`Promise.allSettled` rejection on the count side),
`SecretsBackendContent` substitutes `-1` for `secretCount`. The form
treats `-1` as "conservative path — assume there might be secrets"
and renders the warning + checkbox. A muted-text caveat "Could not
load current secret count; assuming there may be existing secrets."
is shown so operators understand why the warning is firing on what
may be a brand-new tenant. Spec: `tenant-secrets-broker-completion`
R3.6 + design D4.

### Tests

- New `src/components/secrets-backend/__tests__/SecretsBackendForm.test.tsx`
  — four RTL tests covering all four R3 acceptance criteria. Required
  jsdom polyfills for Radix Select internals (`scrollIntoView`,
  pointer-capture methods, class-based `ResizeObserver`).

---

## [1.5.1] - 2026-05-01

Hotfix completing the dashboard side of the
**`tenant-role-taxonomy`** spec.

### Fixed

- **Active-workspace UI now displays `owner` instead of collapsing it to
  `member`.** The `Membership` type in `src/lib/auth/membership.ts` was
  written before `"owner"` became a valid daemon-returned role and was
  pinned to `'admin' | 'member'`. `normalizeRole()` actively flattened
  any non-`"admin"` value (including `"owner"`) to `"member"`, so even
  after gibson v0.27.1 began returning `role: "owner"` for tenant
  founders the settings page and tenant switcher rendered "member".
  Widened the type to `'owner' | 'admin' | 'member'` and taught
  `normalizeRole()` to preserve `"owner"`. Added a distinct amber badge
  for `owner` in `TenantSwitcherClient`.

## [1.5.0] - 2026-05-01

Implements the dashboard portion of the **`tenant-role-taxonomy`** spec
(see `.spec-workflow/specs/tenant-role-taxonomy/` in the workspace root).
Converges the dashboard with the new three-tier
`owner > admin > member` FGA hierarchy that ships in gibson v0.27.0
and tenant-operator v0.1.0.

### Changed

- **Self-signup founding user is now a tenant `owner`.** In
  `app/actions/signup.ts`, the synthesised `TenantMember` CR for the
  signup user now carries `role: "owner"` (was `"admin"`). The
  tenant-operator's reconciler writes this directly to FGA as the new
  first-class `(user:<sub>, owner, tenant:<slug>)` tuple; the daemon's
  `ListMyMemberships` derives `"owner"` as the highest tier and the
  active-workspace UI displays the correct role for tenant founders
  after sign-out / sign-in. (Req 4.1, 4.2, 4.4.)
- **`TenantRole` doc comment refreshed** in `src/lib/auth/roles.ts` —
  removed the now-stale claim that the daemon only emits `admin` /
  `member`; documents the full three-tier hierarchy with a spec
  cross-reference. The exported type and `ROLE_RANK` table are
  unchanged (both already encoded the `owner > admin > member`
  hierarchy with ranks 3 / 2 / 1 — the previously-unreachable
  rank-3 slot is now reachable end-to-end).

### Compatibility

- Backward-compatible at runtime: existing logged-in founders see
  their previous role (`admin`) until next session refresh, then see
  `owner` once the daemon-side change takes effect and the
  `gibson-tenant-owner-backfill` Job (shipped in deploy v0.5.0) has
  written the corresponding owner tuple.
- Forward-compatible: subsequent invitations issued via the dashboard
  admin UI continue to write `role: "admin"` or `role: "member"` per
  the inviter's choice. (Req 4.3.)

## [1.4.0] - 2026-05-01

Implements the dashboard portion of the **`zero-trust-hardening`** spec
(see `.spec-workflow/specs/zero-trust-hardening/` in the workspace root).
Closes the audit-found gaps that allowed the browser bundle to bypass Envoy
and that left machine-to-machine auth silently degraded when the chart's
`resolve-sa-identity-map` init container failed.

### Added

- **`/api/auth/my-permissions`** server route. Requires an Auth.js session
  and calls the daemon's `GetMyPermissions` RPC server-side via Envoy
  using `userClient`. Replaces the browser-side gRPC-Web transport that
  previously bypassed Envoy. Returns `Cache-Control: private, max-age=<ttl>`.
- **`assertAllowedServiceSubjectsConfigured()`** in
  `src/lib/auth/zitadel-bearer-verifier.ts`. Throws if
  `ALLOWED_SERVICE_SUBJECTS` parses to an empty Set. Wired into
  `instrumentation.ts` for production so the dashboard pod fails-fast at
  boot rather than silently 401-ing every inbound machine-to-machine
  call. (Req 11.3.)
- **`requireCsrf(req)` + `csrfErrorResponse(err)`** in
  `src/lib/auth/csrf.ts`. Reads the proxy-seeded `csrf-token` cookie,
  compares against the `x-csrf-token` header (or `csrf` form field on
  `application/x-www-form-urlencoded` posts) using constant-time
  `crypto.timingSafeEqual`, throws `CsrfError` on mismatch. Applied to
  the user-acting mutating mission routes:
  `POST /api/missions/create`, `POST /api/missions/validate`,
  `POST /api/missions/[id]/{stop,pause,resume}`,
  `DELETE /api/missions/[id]`. (Req 11.5.)
- **`scripts/check-no-direct-daemon-grpc-bundle.mjs`** postbuild guard.
  Greps `.next/static/**/*.js` for `createGrpcWebTransport`,
  `getBrowserClient`, `NEXT_PUBLIC_GIBSON_DAEMON_URL`. Catches a
  regression at the canonical artifact level even if a source-level
  guard is bypassed. (Req 6.5.)

### Changed

- **Browser-side direct-daemon transport removed.**
  `src/lib/permissions-cache.ts` no longer holds a
  `createGrpcWebTransport` constructor; the cache calls
  `/api/auth/my-permissions` via `fetch`. `getBrowserClient` and
  `NEXT_PUBLIC_GIBSON_DAEMON_URL` are gone. (Req 6.1, 6.2.)
- **`scripts/check-no-direct-daemon-grpc.mjs`** extended:
  - Generalized port patterns to match any daemon-shaped FQDN at any of
    the known daemon ports (50001/50002/50051/50100), so
    `gibson.<ns>.svc.cluster.local:50051` is now caught.
  - Forbids `NEXT_PUBLIC_GIBSON_DAEMON_URL` as a literal name.
  - Build-time scan of `process.env` for any `NEXT_PUBLIC_*` variable
    whose value matches a daemon-shaped URL pattern.
  - Scan roots extended beyond `app/` and `src/` to include
    repo-root `components/`, `lib/`, `hooks/` and the loose top-level
    files (`auth.ts`, `middleware.ts`, `mdx-components.tsx`,
    `instrumentation.ts`). (Req 6.3.)
- **`package.json`** scripts:
  - `prebuild` now runs `check-no-secrets-in-client.mjs` (was
    postbuild-only). (Req 6.4.)
  - `postbuild` now also runs the new bundle-scan script.
- **`src/gen/authz/registry.ts`** regenerated against the latest SDK —
  agent / tool service RPCs now declare
  `allowedIdentities: COMPONENT` rather than `USER | SERVICE` (the SDK's
  cross-spec correction landed in zero-trust-hardening Req 2.5).

### Notes

- Admin / provisioning routes (`app/api/admin/provisioning/**`) are
  service-acting (Zitadel `client_credentials` Bearer JWT) and are
  intentionally **not** wired for CSRF — browser CSRF cookies do not
  exist on those calls. Their CSRF equivalent is the JWT
  issuer/audience/sub allow-list check in `verifyZitadelBearer`.
  Documented in `src/lib/auth/csrf.ts`.
- Other user-acting mutating routes outside `app/api/missions/**` will be
  wired in a follow-up rollout PR; the helper is in place and the
  pattern is single-line.

### Migration

No env-var or config changes are required for upgrades. In production,
the chart's `resolve-sa-identity-map` init container already populates
`ALLOWED_SERVICE_SUBJECTS`; the new startup self-check exercises that
existing wiring rather than introducing a new dependency.

The retired env var `NEXT_PUBLIC_GIBSON_DAEMON_URL` may safely be removed
from any deployment values; the build now refuses to consume it.
