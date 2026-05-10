# CLAUDE.md — Dashboard

> **Workflow rules:** see [`github.com/zero-day-ai/.github` → `AGENTS.md`](https://github.com/zero-day-ai/.github/blob/main/AGENTS.md) for branch / PR / commit / release / rebase rules. Repo-local rules below override only when explicitly noted.

This file documents conventions specific to the `zero-day-ai/dashboard` repository for AI assistants and engineers.

## Key constraints (read first)

- This is a **Shadcn UI Kit** template. Do not touch pages/components that are unrelated to the Gibson product surface — the template pages are intentionally untouched.
- Dashboard → daemon always goes through **Envoy + ext_authz**. Never open a direct gRPC channel to `:50051` / `:50002` or use `GIBSON_DAEMON_ADDRESS`. The guard script `scripts/check-no-direct-daemon-grpc.mjs` will fail the build if you do.
- `pnpm prebuild` runs a chain of policy-guard scripts. Do not disable them. Fix the code instead.

## Commands

```bash
pnpm install        # install deps
pnpm build          # full production build (runs prebuild chain first)
pnpm dev            # dev server on :3000
pnpm test           # vitest unit tests
pnpm test:e2e       # playwright E2E suite
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm proto:generate # regenerate src/gen/ TS proto bindings
```

## Proto regeneration

The dashboard's TS proto bindings at `src/gen/` are generated from
**two** proto trees:

- the SDK protos at `core/sdk/api/proto/` (resolved via `go list -m`
  against the gibson repo's `go.mod`, so they track whatever SDK
  version gibson is pinned to), and
- the daemon-local protos at `core/gibson/internal/daemon/api/`,
  which are not published anywhere and are only consumable via a
  sibling checkout.

Buf v2 has a hard rule that every module path in `buf.yaml` must
resolve **inside** the directory containing the `buf.yaml`. The
two proto trees live outside this repo, so we cannot just point
buf at them with `../../core/...` paths — buf rejects those.
Instead, `pnpm proto:generate` runs
[`scripts/proto-generate.mjs`](scripts/proto-generate.mjs) which
builds a self-contained workspace:

```
.tmp/proto-ws/
├── buf.yaml              # generated, lists gibson-local + sdk-proto
├── buf.gen.yaml          # generated, drives protoc-gen-es
├── gibson-local -> .../core/gibson/internal/daemon/api    (symlink)
└── sdk-proto    -> $(go list -m ...)/api/proto            (symlink)
```

Then `buf generate` runs from inside `.tmp/proto-ws/`, the output
is rsynced into `src/gen/`, and the workspace is removed. Same
pattern as the daemon's `make authz-registry` recipe in
`core/gibson/Makefile`, which faces the identical "two proto
trees, one buf invocation" constraint.

**No checked-in `buf.yaml` or `buf.gen.yaml`** at the dashboard
root — they only exist transiently inside `.tmp/proto-ws/`.

**Workstation-only.** The script assumes `core/gibson/` is cloned
as a sibling of this repo (i.e. you're in the canonical
`~/Code/zero-day.ai/` polyrepo workspace). CI does not regenerate
proto bindings — `src/gen/` is committed and CI just typechecks
it. Run `pnpm proto:generate` locally whenever you change a
`.proto` file in either tree, then commit the regenerated
`src/gen/` alongside the proto edit.

The SDK side regen depends on `go list -m` succeeding from the
gibson repo, which means gibson's `go.mod` must already pin the
SDK version you want. If you're iterating on a new SDK release,
bump gibson's `go.mod` first (or use `GOFLAGS=-mod=mod` per the
top-level CLAUDE.md transient-dev guidance), then regen.

## Frontend authz

### Overview

Admin chrome is hidden from `tenant_member` users at two layers:

1. **Client layer** (`useAuthorize` hook) — hides buttons/entries while loading and when denied.
2. **Server layer** (`assertAuthorized` helper) — throws before any daemon call, providing defense-in-depth even if a non-admin bypasses the UI.

Both layers read from a single static map — the `AuthRegistry` — generated from SDK proto annotations at build time.

---

### Pipeline: SDK protos → registry

```
core/sdk/proto/**/*.proto
  └─ (gibson.auth.v1.authz) extension on each method
       │
       ▼
scripts/gen-authz-registry.mjs    ← runs as part of pnpm prebuild
       │
       ▼
src/gen/authz/registry.ts         ← committed, regenerated on every build
```

`gen-authz-registry.mjs` invokes `buf build` against the SDK module directory to produce a FileDescriptorSet, walks every service method, decodes the authz annotation, and emits a TypeScript module with the `AuthRegistry` record.

`scripts/check-authz-registry-fresh.mjs` regenerates to a temp file and diffs against the committed copy — CI fails on drift.

Both scripts run as part of `pnpm prebuild` before the existing `check-no-*` policy guards.

**Spec reference:** `dashboard-authz-ui-gating` (Phase 1, Tasks 1-2).
**Sister spec:** `private-authz-registry` Layer 1 annotates the SDK protos. This dashboard script is independent of that spec's OCI output — it reads annotations directly from the local proto source. The two specs can ship in either order.

---

### Client: `useAuthorize(method)`

File: `src/lib/auth/use-authorize.ts`

```ts
import { useAuthorize } from "@/lib/auth/use-authorize";

function AddPluginButton() {
  const { allowed, loading } = useAuthorize(
    "/gibson.admin.v1.PluginsAdminService/RegisterPlugin"
  );
  if (loading || !allowed) return null;         // hide on loading — no FOUC
  return <Button onClick={openWizard}>Add Plugin</Button>;
}
```

Rules:
- Pass the fully-qualified RPC name as the method string (matches the key in `AuthRegistry`).
- Always return `null` (not a disabled element) when `loading || !allowed`. This is the **hide-on-loading** pattern — the element is never in the DOM while the membership query is in flight, which prevents a flash of unauthorized content.
- Unknown methods (`AuthRegistry[method]` is undefined) are **denied** (fail-closed). Set `NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV=1` (client) or `DASHBOARD_AUTHZ_PERMISSIVE_DEV=1` (server) in non-production environments to fall back to permissive-allow with a warn-once log line per method. Production builds ignore these vars entirely (`NODE_ENV` is checked first).
- Uses React Query with `staleTime: 60_000` ms; a single cache entry `"my-memberships"` is shared across all `useAuthorize` calls on a page.

---

### Server: `assertAuthorized(method)` in server actions

File: `src/lib/auth/assert-authorized.ts` (server-only)

```ts
"use server";
import { assertAuthorized } from "@/lib/auth/assert-authorized";
import { AuthzDeniedError } from "@/lib/auth/assert-authorized";

export async function createSecretAction(formData: FormData) {
  try {
    await assertAuthorized("/gibson.admin.v1.SecretsAdminService/SetSecret");
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      return { ok: false, error: "Permission denied", code: "permission_denied" };
    }
    throw err;
  }
  // ...proceed with daemon call
}
```

`assertAuthorized` throws `AuthzDeniedError` (with `method` and `reason` fields) on denial. Server actions catch it and return a structured error; the client maps this to a "Permission denied" toast. Never log the `reason` in a user-visible message (it contains internal role data).

---

### Hide-on-loading pattern (no FOUC)

The membership query (`/api/auth/my-memberships`) is asynchronous. During the initial load `loading` is `true`. Components **must** treat `loading` as denied:

```ts
if (loading || !allowed) return null;   // correct — no element in DOM
if (!loading && !allowed) return null;  // wrong — brief flash while loading
```

The query result is cached for 60 seconds and shared across all hooks on the page, so only one network request is made per page load.

---

### Adding a new admin RPC

1. In `core/sdk/`, add the `(gibson.auth.v1.authz)` extension to the new method in the proto file. Set `relation: "admin"` and `allowed_identities: [USER]`.
   <!-- # Sister-spec cross-repo-cohesion-fixes Requirement 3 — every committed SDK proto uses relation: "admin", not "tenant_admin". -->
2. Run `make proto` in `core/sdk/`, commit and tag a new SDK release.
3. In this dashboard repo, run `pnpm prebuild` — `gen-authz-registry.mjs` regenerates `src/gen/authz/registry.ts` with the new entry.
4. In the UI, call `useAuthorize("/your.service.v1.ServiceName/MethodName")` on the new button/action.
5. In the server action, call `await assertAuthorized("/your.service.v1.ServiceName/MethodName")` before the daemon call.
6. Commit `src/gen/authz/registry.ts` alongside the code changes — the CI drift gate will fail if you forget.

No other files need editing. The registry is the only source of authz rules.

---

### E2E authz tests

Located in `e2e/authz/`:

| File | Purpose |
|---|---|
| `non-admin.spec.ts` | Mocks member session; asserts admin chrome is absent |
| `admin.spec.ts` | Mocks admin session; asserts admin chrome is present |
| `server-action-bypass.spec.ts` | POSTs directly to server action route; asserts 403/denial |

The mocks intercept `/api/auth/my-memberships` to inject the desired role without requiring a real tenant_member account on the cluster. Run against a live Kind cluster via:

```bash
E2E_AUTH_SUITE=1 PLAYWRIGHT_BASE_URL=http://localhost:30081 \
  E2E_ADMIN_EMAIL=admin@example.com E2E_ADMIN_PASSWORD=... \
  pnpm test:e2e e2e/authz/
```

All three suites compile and lint cleanly without a live cluster.

## Logging

The dashboard uses a single canonical structured logger at
`src/lib/logger.ts`, built on top of [`pino`](https://github.com/pinojs/pino).
This is the only approved logging surface for committed server-side
code (API routes, server actions, instrumentation hooks).

```ts
import { logger } from '@/src/lib/logger';

logger.info({ tenantId, action: 'invite' }, 'invitation issued');
logger.error({ err, route: 'analytics/kpis' }, 'analytics RPC failed');
```

Rules:

- `console.*` is forbidden in committed server-side code. Migrate to
  `logger.info` / `logger.warn` / `logger.error` instead.
- For browser-side hooks where a structured logger would not survive
  the client bundle, gate `console.log` and `console.warn` on
  `process.env.NODE_ENV !== 'production'`. `console.error` may remain
  in client code as long as it does not emit identifying URL paths,
  query parameters, or full RPC payloads.
- Always pass identifying values (email, tenant id, user id, session
  id, tokens, secrets) inside the structured object, never in the
  message string. The redactor scrubs `email`, `tenantId`, `memberId`,
  `userId`, `sessionId`, `sessionToken`, `zitadelSubject`,
  `zitadelUserId`, `token`, `password`, `apiKey`, and `secret` before
  serialisation.
- New PII fields require a redactor update in `src/lib/logger.ts`.

In development, output is colourised via `pino-pretty`. In production,
the logger emits one JSON object per event for ingestion.

## Auth (post-Better-Auth)

Better Auth was removed from the dashboard. The canonical auth surface
is **Auth.js v5** with **Zitadel** as the upstream IdP. There is no
local user database in the dashboard; identities, sessions, and
membership are owned by Zitadel and OpenFGA respectively.

Build guards enforce this:

- `scripts/check-no-direct-daemon-grpc.mjs` (line 112) rejects
  `BETTER_AUTH_*` env vars and any direct daemon gRPC channel from
  the dashboard. Daemon traffic ALWAYS goes via Envoy + ext-authz
  with SPIFFE mTLS; never via a direct gRPC client from this codebase.
- `.env.example` is the canonical reference for required env vars; it
  no longer contains any `BETTER_AUTH_*` keys.

If you find a stale reference to Better Auth in code, comments, tests,
or docs, treat it as a regression and remove it.

## Service-account identity (canonical sub)

`verifyZitadelBearer` performs a **single-claim numeric check** on the JWT's `sub` against `ALLOWED_SERVICE_SUBJECTS`. The env is populated at pod startup by the `resolve-sa-identity-map` init container (chart template `templates/dashboard/deployment.yaml`), which reads `.Values.serviceAccounts.required` (readable SA names) and resolves each one to its numeric sub via the chart-managed `gibson-sa-identity-map` ConfigMap. Pod fail-fasts if any required SA is missing from the map.

The TS module `src/lib/auth/identity-resolver.ts` is the **log-enrichment-only** lookup (numeric → readable). Never import it from auth-decision code. The mounted source is `/shared/sa-identity-map.json`, written by the same init container.

Spec: `canonical-service-identity`.
