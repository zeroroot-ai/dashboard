# CLAUDE.md — Dashboard

> **Workflow rules:** see [`github.com/zero-day-ai/.github` → `AGENTS.md`](https://github.com/zero-day-ai/.github/blob/main/AGENTS.md) for branch / PR / commit / release / rebase rules. Repo-local rules below override only when explicitly noted.

This file documents conventions specific to the `zero-day-ai/dashboard` repository for AI assistants and engineers.

## Key constraints (read first)

- This is a **Shadcn UI Kit** template. Do not touch pages/components that are unrelated to the Gibson product surface — the template pages are intentionally untouched.
- Dashboard → daemon always goes through **Envoy + ext_authz**. Never open a direct gRPC channel to `:50051` / `:50002` or use `GIBSON_DAEMON_ADDRESS`. The guard script `scripts/check-no-direct-daemon-grpc.mjs` will fail the build if you do.
- `pnpm prebuild` runs a chain of policy-guard scripts. Do not disable them. Fix the code instead.
- **No hardcoded colors anywhere under `app/**` or `components/**`.** Every color goes through a token declared in `app/globals.css`. The guard `scripts/check-no-hardcoded-colors.mjs` rejects tailwind palette utilities (`text-emerald-*`, `bg-zinc-*`), tailwind arbitrary-value colors (`bg-[#...]`, `text-[oklch(...)]`), black/white utilities (`bg-white`, `text-black`), inline-style colors, and raw `#...`/`oklch(...)`/`rgb(...)`/`hsl(...)` in `.css` files. Two files are exempt because they declare the token system itself: `app/globals.css`, `app/themes.css`. See the design-system guide below.
- **Customer-facing docs name product capabilities, not vendors.** `content/docs/**/*.mdx` must not mention Zitadel, OpenFGA / FGA, Envoy, ext-authz, jwt_authn, JWKS, x-gibson-identity-*, Langfuse, SPIFFE / SPIRE, Neo4j, CNPG, ArgoCD, cert-manager, ESO, OPA, or "Gibson-hosted Vault". Write product language instead — "Gibson identity service", "Gibson permissions", "Gibson Traces", "Gibson-managed secrets storage". See the Customer terminology section below; full deny-list ↔ replacement table at [docs.git → repos/dashboard/customer-doc-terminology.md](https://github.com/zero-day-ai/docs/blob/main/repos/dashboard/customer-doc-terminology.md). Internal developer docs at `enterprise/platform/dashboard/docs/*.md` and every `CLAUDE.md` are intentionally exempt.

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

## Mission schema copy

`src/data/mission-definition.schema.json` is a generated copy of
`opensource/sdk/gen/mission-definition.schema.json`. It is NOT
hand-maintained. The file carries a `$comment` field ("DO NOT EDIT — generated
…") as the first key.

**Source of truth:** `opensource/sdk/gen/mission-definition.schema.json`
(produced by the SDK's proto → JSON Schema pipeline).

**Generator (workstation-only):**
```bash
node scripts/gen-mission-schema.mjs
# or
pnpm gen:mission-schema
```
Requires the `opensource/sdk/` sibling clone to be present in the polyrepo
workspace. Exits with a clear error if the sibling is absent.

**Freshness gate (runs in `pnpm prebuild`):**
`scripts/check-mission-schema-fresh.mjs`
- When the SDK sibling is present: regenerates in memory and byte-diffs against
  the committed file. Fails on any drift.
- When the SDK sibling is absent (dashboard-only CI): validates that the
  committed file is valid JSON with the `$comment` header present.
- No `--skip` / `--permissive` flag exists. Drift fails the build, period.

When the SDK schema changes: run `pnpm gen:mission-schema` and commit
`src/data/mission-definition.schema.json` alongside the SDK change.

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

### Three-state visibility — `AuthGatedButton` (dashboard#145)

The hide-on-loading + return-null pattern is correct for **admin scaffolding** the user shouldn't even know exists (Secrets backend, Grants admin, internal tooling). It is **wrong** for primary CTAs that every user benefits from discovering, even when their current role can't take the action — e.g. the Deploy launcher on agents/tools/plugins pages. Hiding such buttons leads to "where is the Deploy button?" support tickets from non-admins who don't realise the feature exists at all.

For those CTAs use `<AuthGatedButton>` from `components/gibson/auth/`. It has three render states:

- `state="loading"` → `<Skeleton aria-busy />` placeholder so the layout doesn't shift; the affordance stays in the DOM.
- `state="denied"` → disabled `<Button>` wrapped in a tooltip carrying `disabledTooltip` copy. The user sees the action and learns the permission they need.
- `state="allowed"` → full clickable `<Button>` (forwards `asChild` for `<Link>` wrapping).

The component is agnostic about how `state` is computed. For sync callers (server-hydrated `usePermitted`) pass `state={canManage ? "allowed" : "denied"}`. For async callers (`useAuthorize` against an RPC name) derive `state` from `{ allowed, loading }`.

```tsx
import { AuthGatedButton } from "@/components/gibson/auth";
import { usePermitted } from "@/src/lib/auth/tenant";

function DeployCta({ type }: { type: "agent" | "plugin" | "tool" }) {
  const canManage = usePermitted("components:manage");
  return (
    <AuthGatedButton
      state={canManage ? "allowed" : "denied"}
      disabledTooltip="Ask your tenant admin for permission to deploy components."
      asChild={canManage}
      size="sm"
    >
      {canManage ? (
        <Link href={`/dashboard/deploy?type=${type}`}>Deploy {type}</Link>
      ) : (
        <>Deploy {type}</>
      )}
    </AuthGatedButton>
  );
}
```

**When to reach for `<AuthGatedButton>` vs. the hide-on-loading hook:**

| User mental model | Pattern |
|---|---|
| "This action exists, but I'm not authorised — who do I ask?" | `<AuthGatedButton state="denied" disabledTooltip="..." />` |
| "This action shouldn't be visible at all to me — it's internal admin scaffolding." | `useAuthorize` + `if (loading \|\| !allowed) return null` |

E2E coverage for the three states lives in `e2e/authz/admin.spec.ts` (asserts allowed) and `e2e/authz/non-admin.spec.ts` (asserts denied wrapper with tooltip-bearing CTA).

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

## Design system

The dashboard's design system is a single token tree in `app/globals.css` with **explicit light AND dark values for every token**. The terminal-hacker brand identity (deep navy + terminal green + cyan link + CRT scanline overlay) is enforced uniformly across marketing, public auth, the authenticated product, and in-app docs. The canonical reference page is `/design-tokens` — both modes render side-by-side.

Three token layers, narrowing from raw to semantic:

- **Palette** (`--base-50` … `--base-1000`, `--primary-50` … `--primary-1000`, `--secondary-50` … `--secondary-1000`) — never reference these directly from a component.
- **Semantic** (`--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--sidebar-*`, `--chart-*`) — the default choice. Maps directly to tailwind utilities (`bg-background`, `text-foreground`, `border-border`).
- **Specialty** (`--highlight`, `--alt`, `--link`, `--glow-strength`, `--scanline-opacity`) — reach for these only when the design intent is the terminal-hacker accent itself. Available as `text-highlight`, `text-alt`, `text-link`.

Full architectural rationale + when-to-update: [docs.git → repos/dashboard/design-system.md](https://github.com/zero-day-ai/docs/blob/main/repos/dashboard/design-system.md).

### No hardcoded colors — the CI guard

`scripts/check-no-hardcoded-colors.mjs` runs as part of `pnpm prebuild`. Modes:

```bash
node scripts/check-no-hardcoded-colors.mjs            # default: scan + diff against .color-allowlist.json
node scripts/check-no-hardcoded-colors.mjs --shrink   # remove allowlist entries whose source line no longer matches
node scripts/check-no-hardcoded-colors.mjs --selftest # synthesise + verify the scanner catches each pattern class
```

The allowlist file `.color-allowlist.json` at the repo root captures every pre-existing violation as of the guard's land time (#53). It is **monotonic-shrink only**:

- A new violation outside the allowlist → CI fail. Replace with a semantic or specialty token.
- An allowlist entry whose source line no longer matches → CI fail with hint to run `--shrink` and commit the result.
- A line content that changed at an allowlisted slot to a different hardcoded color → CI fail.

When migrating a file (slices #54-#59), the drain procedure is:

1. Replace the hardcoded color in the source file with the appropriate semantic or specialty token.
2. Run `node scripts/check-no-hardcoded-colors.mjs --shrink`.
3. Commit both the source change and the updated `.color-allowlist.json`.

Adding a new entry to the allowlist is intentionally NOT automated. If a genuine exception exists, hand-edit the JSON file — that forces a review-time conversation about why the token system can't accommodate the case.

### Visual regression — the snapshot suite

`e2e/visual/` ships Playwright screenshot tests that capture every customer-facing route in both light and dark mode. The suite runs as part of `pnpm test:e2e`; visual diffs fail the run.

```bash
pnpm test:visual          # run snapshots; fail on diff
pnpm test:visual:update   # regenerate baselines after an intentional design change
```

Baselines live under `e2e/visual/__screenshots__/<platform>/`. The theme is selected via the `theme_choice` cookie (the same cookie #57 wired into `app/layout.tsx`), so each route is captured against the rendered SSR theme — no FOUC, no animation noise (the spec pauses every animation + applies `prefers-reduced-motion: reduce` before sampling).

When an intentional design change lands:

1. Make the visual change (token tweak, layout edit, etc.).
2. Run `pnpm test:visual:update` to regenerate baselines.
3. Review the regenerated PNGs in the diff — every changed pixel should be expected.
4. Commit the baselines alongside the design change. CI will compare future PRs against the new baseline.

#### Auth-route coverage

`e2e/visual/auth-routes.spec.ts` covers `/dashboard`, `/dashboard/pages/missions`, `/dashboard/pages/findings`, `/dashboard/pages/settings/account` in both modes. Authentication is synthesised via the test-only session encoder at `src/lib/test-fixtures/encode-session.ts`, which mints a JWE under the dashboard's own `AUTH_SECRET` that decodes through the same Auth.js pipeline as a real sign-in.

```bash
TEST_AUTH_BYPASS=1 AUTH_SECRET=$YOUR_LOCAL_SECRET pnpm test:visual
```

Two independent production guards on the encoder, AND-ed: `NODE_ENV !== "production"` and `TEST_AUTH_BYPASS=1`. Neither alone activates it. The helm chart never sets `TEST_AUTH_BYPASS` so even a misconfigured prod deploy with the wrong `NODE_ENV` cannot run the encoder. Adding the env var to any production-bound config path is a smell — flag in review.

The spec also skips gracefully when `TEST_AUTH_BYPASS` is unset, so CI environments that haven't opted in don't fail; they just don't run the auth-route suite.

## Customer terminology

Customer-facing docs at `content/docs/**/*.mdx` and the customer-visible UI surface name **product capabilities**, not the vendors implementing them. This is a hard constraint: vendor names dilute the brand, expose attack surface, and turn infrastructure choices into doc-migration contracts whenever we swap a dependency.

Canonical reference: [docs.git → `repos/dashboard/customer-doc-terminology.md`](https://github.com/zero-day-ai/docs/blob/main/repos/dashboard/customer-doc-terminology.md). It carries the full deny-list ↔ replacement table, the allowlist of permitted BYO/protocol terms, and the structural rewrite pattern for the "how do I debug a 401" flow.

The deny-list at a glance — these never appear in `content/docs/**/*.mdx`:

- `Zitadel` → "Gibson identity service" / drop
- `OpenFGA`, `FGA`, "FGA Check", "FGA tuple" → "Gibson permissions" / "grants"
- `SPIFFE`, `SPIRE` → drop or generic "workload identity"
- `Envoy`, `ext-authz`, `ext_authz`, `jwt_authn`, `JWKS`, `x-gibson-identity-*`, `cgjwt`, identity-chain HMAC → drop
- `Langfuse` → "Gibson Traces"
- `Neo4j`, `CNPG`, `ArgoCD`, `cert-manager`, `ESO` / "External Secrets Operator", `OPA` → drop
- "Gibson-hosted Vault" → "Gibson-managed secrets storage"

Permitted (customer-facing product surface):

- BYO integrations — `HashiCorp Vault` (in customer-side context only), `AWS Secrets Manager`, `Azure Key Vault`, `GCP Secret Manager`, `Slack`, `PagerDuty`, `Discord`, `Microsoft Teams`, `Docker`, `Prometheus`.
- Customer-runtime references — `Kubernetes`, `systemd` (must read unambiguously as "your runtime").
- Standard protocol terms — `OAuth2`, `OIDC`, `JWT`, `client_id`, `client_secret`.

**Out of scope** — internal developer docs at `enterprise/platform/dashboard/docs/*.md` (auth.md, forbidden-patterns.md, how-to-add-a-rpc.md, …) and every `CLAUDE.md` may name internal components freely. The CI guard (lands in #129 as `scripts/check-no-internal-tech-in-docs.mjs`) skips them.

When you find yourself writing "Check Envoy's `jwt_authn` logs" in a customer-facing troubleshooting flow, stop. The customer cannot reach those logs. Replace with a dashboard action (re-issue from the deploy wizard, inspect grants in the Permissions tab) or a CLI invocation (`gibson inspect`). The general rule: if a step requires reading internal logs, it is the wrong step.

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
