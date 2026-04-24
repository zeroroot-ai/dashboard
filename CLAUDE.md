# Dashboard CLAUDE.md

This is the Gibson dashboard (Next.js 16 / React 19 / App Router). The
upstream `README.md` is the Shadcn UI Kit template's README and is left
intact as the source — do not edit it. This file captures the
Gibson-specific architecture decisions a contributor (or LLM agent)
needs to know before changing auth, signup, or session handling.

## Authentication surface

There is **no public Better Auth HTTP surface**. After the
`dashboard-auth-server-actions` spec, browsers authenticate exclusively
through React Server Actions in `app/actions/auth/`. The Better Auth
catch-all route (`app/api/auth/[...all]/route.ts`) is deleted; a build
guard in `scripts/check-no-public-auth.mjs` fails the build if anyone
re-introduces it.

Server Actions:

| Action                                  | Replaces                                |
| --------------------------------------- | --------------------------------------- |
| `signUpAction` (`signup.ts`)            | `POST /api/auth/sign-up/email` + `/api/signup` |
| `signInAction` (`signin.ts`)            | `POST /api/auth/sign-in/email`          |
| `signOutAction(redirectTo?)`            | `POST /api/auth/sign-out`               |
| `getSession` (`session.ts`, server only)| `GET /api/auth/get-session`             |
| `getSessionClient` (`session-client.ts`)| client wrapper for the above            |
| `createOrgAction` etc. (`org.ts`)       | `POST /api/auth/organization/*`         |

Client components that need the current session use
`useSession()` from `src/lib/session-client.ts`. It calls the
`getSessionClient` Server Action under the hood — Server Action RPC has
its own Origin + CSRF protections from Next.js.

## SPIFFE-authenticated admin surface (preserved)

The tenant-operator pod talks to the dashboard's
`/api/admin/provisioning/*` routes using a SPIFFE JWT-SVID Bearer token
that is verified against the SPIRE trust bundle exposed by the
`spiffe-jwks-exporter` sidecar. This is a workload-to-workload trust
boundary, separate from the browser path. **Do not** consolidate it
with the Server Actions above.

## SPIFFE workload identity — JWT-SVID minting and the gateway-only daemon path

The dashboard pod is registered as the SPIRE workload
`spiffe://gibson.io/platform/dashboard` (chart helper `gibson.spiffeID`).
Two SPIRE-related sidecars run alongside the dashboard container:

- **`spiffe-helper`** — fetches the dashboard's X.509 SVID + the SPIRE
  trust bundle via the Workload API and materializes them as PEM files
  (`svid.pem`, `svid-key.pem`, `bundle.pem`) into a shared `emptyDir` at
  `/spire/svids`. **The dashboard container no longer mounts this volume**
  as of spec `in-cluster-mtls-restoration` Phase 5 — the helper is kept
  because other in-cluster components still consume the file-based PEMs.
- **`spiffe-jwks-exporter`** — translates the SPIRE JWT bundle into a JWKS
  HTTP endpoint at `http://127.0.0.1:9091/jwks` so Auth.js / `jose` /
  Envoy's `jwt_authn` filter can verify SPIFFE-issued JWT-SVIDs.

**JWT-SVID minting**: `src/lib/spiffe/jwt-svid.ts` is the canonical minter.
It opens a gRPC connection to the SPIRE Workload API socket at
`/run/spire/sockets/agent.sock` (mounted via hostPath into every dashboard
pod) and calls `FetchJWTSVID` with the requested audience. Tokens are
cached in-process per audience with stale-while-revalidate semantics
(refresh fires 30 minutes before expiry; max TTL 3600s enforced server-side).
Never logs raw JWTs.

**Gateway-only dashboard → daemon**: BOTH `src/lib/gibson-client.ts`
(non-admin RPCs) AND `src/lib/gibson-admin-client.ts` (admin RPCs) route
ALL traffic through Envoy at `ADMIN_ENVOY_BASE_URL` (typically
`https://api.<domain>:30443`) using a JWT-SVID with audience
`spiffe://gibson.io/platform/daemon`. The dashboard does NOT dial the
daemon's `:50051` mTLS listener directly. The daemon's listener accepts
ONLY connections from `spiffe://gibson.io/platform/envoy` (Envoy presents
its own SPIRE-issued SVID via SDS). Any future code path that introduces
a direct `https://gibson:50051` transport is rejected by the chart guard
`gibson.validateEnvoySdsWired`. See `core/gibson/CLAUDE.md` "Identity /
SPIFFE — In-cluster Transport" and `docs/auth-flow.md` for the full flow.

**Backout flag** (transitional): `dashboard.useEnvoyForDaemon` chart value
→ `USE_ENVOY_FOR_DAEMON` env var. Default `true`. Setting to `false`
post-spec produces a hard `ConnectError(FailedPrecondition)` from
`gibson-client.ts` because the X.509 SVID direct transport was deleted in
Phase 5. The flag exists for a one-step git-revert hot patch during the
30-day soak (Requirement 6.1) and is deleted in Phase 9.

## Better Auth instance

`src/lib/auth-server.ts` is the single Better Auth construction site.
Plugins:
- `organization` (with teams)
- `admin`
- `nextCookies()` — must remain the **last** plugin so its hooks see
  set-cookie commands from earlier plugins and forward them through
  Next.js `cookies()`. Without it, Server Actions cannot commit Better
  Auth session cookies.

A `hooks.before` middleware enforces password complexity server-side as
a defence-in-depth check; the same rules live in
`src/lib/validators/auth.ts` and are used by both the form and
`signUpAction`.

## LLM providers (spec 25)

The dashboard does **not** own any LLM provider credential storage. Every
credential flows through the daemon's encrypted credential store
(`crypto.AESGCMEncryptor` + configured `KeyProvider`). The dashboard process
never holds a decrypted credential during chat.

**Runtime (every chat turn):** browser → Next.js route → `GibsonLLMAdapter`
(custom Vercel AI SDK `LanguageModelV2` at `src/lib/ai/gibson-llm-adapter.ts`)
→ gRPC `ExecuteLLM` / `StreamLLM` on the daemon. Daemon loads the decrypted
credential from `internal/providerconfig.Store.Resolve`, constructs the
langchaingo provider, makes the upstream call, streams back.

**Form submission (one-time per provider config change):** browser → form →
`POST /api/settings/providers/*` (Next.js route) → `daemon*` gRPC client in
`src/lib/gibson-client.ts` → daemon's `CreateProvider` / `UpdateProvider`.
Plaintext credential transits the Next.js route memory for one request,
never cached or logged.

Build-time guards at `scripts/check-no-llm-credential-reads.mjs` and
`scripts/check-no-provider-k8s-access.mjs` fail the build if anyone
re-introduces `@ai-sdk/<provider>` imports, direct provider SDK imports,
LLM credential env var reads, or the deleted `llm-providers` Kubernetes
Secret path. Provider form is descriptor-driven — consumes
`GetSupportedProviders` via `useSupportedProviders()` — so dashboard ↔
daemon can't drift on the provider list.

See `docs/byok-providers.md` for the full flow + `.spec-workflow/specs/25-daemon-driven-provider-config/` for rationale.

## Debug mode

Set `dashboard.debug: true` in the helm values to:
- include full error stacks on API responses
- raise Better Auth's logger to `debug`
- enable `/api/debug/recent-errors` (in-memory ring buffer of recent
  server-side errors — used by the in-page `<DebugErrorPanel/>` and by
  operators / agents diagnosing a stuck pod)

Default is OFF. Never enable in any environment that sees real users.
