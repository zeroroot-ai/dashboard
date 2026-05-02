# Changelog

All notable changes to the Gibson Dashboard are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
