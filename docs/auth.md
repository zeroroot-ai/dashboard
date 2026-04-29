# auth.md — `zero-day-ai/dashboard`

Auth model from the dashboard's perspective. AI-agent-facing.
Spec: `unified-identity-and-authorization`.

## Three transports, one factory

The dashboard talks to the Gibson daemon **only** through Envoy
([`api/<domain>:<port>`](#)). There is no direct dial — the
`scripts/check-no-direct-daemon-grpc.mjs` build guard rejects any
`gibson:5005[012]` literal or `GIBSON_DAEMON_ADDRESS` reference at
prebuild time.

The three transports compose one underlying factory:

| Symbol | File | Use |
|---|---|---|
| `makeClient(svc, getToken, getTenant)` | [`src/lib/gibson-client.ts:176`](../src/lib/gibson-client.ts) | Low-level. Owns the Connect transport, telemetry interceptor, auth interceptor, and SPIFFE node options. Does NOT read env, session, or cookies. |
| `userClient(svc)` | [`src/lib/gibson-client.ts:275`](../src/lib/gibson-client.ts) | User-acting RPCs. Bearer = signed-in user's Zitadel access token (from Auth.js session); `x-gibson-tenant` = active-tenant cookie. |
| `serviceClient(svc, tenantId)` | [`src/lib/gibson-client.ts:295`](../src/lib/gibson-client.ts) | Service-acting RPCs (in-cluster callbacks, entitlement reconcile, "Register Agent"). Bearer = dashboard pod's Zitadel `client_credentials` JWT; `x-gibson-tenant` = caller-supplied. |

The two wrappers compose `makeClient` with concrete sourcing strategies.
`makeClient` is the lock — adding a third sourcing strategy means a new
wrapper, never a new branch inside the factory.

```
                userClient(svc)                   serviceClient(svc, tenantId)
                    |                                       |
        requireUserToken     getActiveTenant     getServiceToken    () => tenantId
        (Auth.js session)    (cookie + memberships)  (Zitadel cc)
                    \                /                       \           /
                     \              /                         \         /
                      makeClient(service, getToken, getTenant)
                                       |
                                       v
                       Envoy edge (https://api.<domain>:<port>)
                                       |
                                       | Bearer JWT (Zitadel)
                                       | x-gibson-tenant: <tenant>
                                       | mTLS via SPIFFE X509-SVID (in-cluster)
                                       v
                                      ext-authz + daemon
```

## Browser sessions: Auth.js + Zitadel OIDC

Browser sessions are managed by Auth.js (NextAuth) with Zitadel as the
sole OIDC provider. The session structure is unchanged from the
pre-spec layout; the dashboard reads `session.accessToken` (the user's
Zitadel JWT) and forwards it as `Authorization: Bearer …` on every
gRPC call via `userClient`.

There is no BetterAuth integration. There are no `gsk_` API keys.
There is no SPIFFE JWT-SVID minting in the dashboard — the deleted
file `src/lib/spiffe/jwt-svid.ts` is not coming back. SPIFFE in the
dashboard is **X509-SVIDs only**, used for mTLS to the Envoy upstream
cluster ([`src/lib/spiffe-mtls/svid.ts`](../src/lib/spiffe-mtls/svid.ts));
subject identity is always Zitadel.

## Outbound mTLS to Envoy (in-cluster)

When the dashboard pod runs inside the cluster:

1. The SPIRE Workload API socket lives at
   `$SPIFFE_ENDPOINT_SOCKET` (typically
   `unix:///run/spire/sockets/agent.sock`).
2. [`src/lib/spiffe-mtls/svid.ts`](../src/lib/spiffe-mtls/svid.ts)
   fetches the X509-SVID and exposes a sync cache accessor.
3. `gibson-client.ts:spiffeNodeOptions()` ([`:227`](../src/lib/gibson-client.ts))
   reads the cached context and passes `cert` / `key` / `ca` to
   `createGrpcTransport`'s `nodeOptions`.

When the socket is missing (local dev), the factory logs **once** and
falls back to plain HTTPS. The Bearer JWT auth path is unaffected — TLS
is just edge-only instead of mutual.

The `scripts/check-no-spiffe-in-user-client.mjs` build guard fails the
build if SPIFFE-JWT-SVID-minting code re-appears anywhere in the
dashboard.

## Inbound SPIFFE JWT-SVID validation

Some admin endpoints accept inbound bearer tokens minted by *other*
in-cluster SPIFFE workloads (the tenant-operator calling
`/api/admin/provisioning/*`). [`src/lib/spiffe-verifier.ts`](../src/lib/spiffe-verifier.ts)
validates these against the SPIRE trust bundle exposed as JWKS by the
sidecar `gibson-spiffe-jwks-exporter`.

Env vars:

```
SPIFFE_JWKS_URL            sidecar URL (default http://127.0.0.1:9091/jwks)
SPIFFE_TRUST_DOMAIN        expected trust domain (e.g. zero-day.ai)
DASHBOARD_ADMIN_AUDIENCE   expected JWT audience (e.g. gibson-dashboard)
```

This is **not** the dashboard authenticating users — it is the dashboard
verifying a peer SPIFFE workload's JWT-SVID for admin callbacks. End
users always come through Auth.js.

## "Register Agent" flow

[`app/api/agents/register/route.ts`](../app/api/agents/register/route.ts)
mints Zitadel machine users on demand:

1. Authenticate caller via Auth.js (`auth()`).
2. Resolve active tenant and assert caller has at least the `admin`
   role (only tenant admins/owners may mint agents).
3. Validate request body (name, optional description; tight regex on
   the name so it round-trips into a Zitadel `userName`).
4. `getSignupZitadelAdminClient()` → Zitadel admin API:
   - create machine user `agent-${tenant}-${name}`
   - mint a single `client_secret` (returned **once**)
   - add the machine user to the tenant's project so the issued JWT
     carries the `agent` role claim
5. Respond with `{ clientId, clientSecret, gibsonUrl, enrollCommand }`.
   `clientSecret` is the only place the secret ever appears outside
   Zitadel; it is never logged. The
   `scripts/check-no-secret-in-logs.mjs` build guard verifies this.

The browser surface displays the secret once with a clear "store
securely, you cannot view again" warning, plus a copy-paste
`gibson-cli agent enroll …` command line.

## What's gone

| Removed | Why |
|---|---|
| `src/lib/gibson-admin-client.ts` | Collapsed into single `makeClient` factory + two wrappers. |
| `src/lib/spiffe/jwt-svid.ts` | Outbound subject identity is Zitadel; SPIFFE is X509-SVID only. |
| BetterAuth integration | Audit C13 — weak symmetric HMAC. Replaced by Zitadel. |
| `gsk_`-prefixed API keys | Replaced by Zitadel client_credentials and the Register Agent flow. |
| `GIBSON_DAEMON_ADDRESS` env var | Direct dial deleted; replaced by `ADMIN_ENVOY_BASE_URL`. |
| Direct `gibson:50051` / `:50002` literals | Same reason. |

## Build guards

All run in `scripts.prebuild` (so every `pnpm build` exercises them) and
re-run in CI.

| Guard | What it forbids |
|---|---|
| [`scripts/check-no-direct-daemon-grpc.mjs`](../scripts/check-no-direct-daemon-grpc.mjs) | Direct daemon URLs (`gibson:5005[0-2]`, `gibson:50100`) and `GIBSON_DAEMON_ADDRESS`. |
| [`scripts/check-no-spiffe-in-user-client.mjs`](../scripts/check-no-spiffe-in-user-client.mjs) | Re-appearance of JWT-SVID-minting code in the dashboard. |
| [`scripts/check-no-direct-zitadel-fetch.mjs`](../scripts/check-no-direct-zitadel-fetch.mjs) | Direct Zitadel API calls outside the centralised admin client factory. |
| [`scripts/check-no-iam-admin-pat-in-dashboard.mjs`](../scripts/check-no-iam-admin-pat-in-dashboard.mjs) | Re-introduction of long-lived IAM admin PATs. |
| [`scripts/check-no-legacy-login-url.mjs`](../scripts/check-no-legacy-login-url.mjs) | Legacy login URLs (pre-Auth.js). |
| [`scripts/check-no-legacy-patch-endpoints.mjs`](../scripts/check-no-legacy-patch-endpoints.mjs) | REST patch endpoints replaced by gRPC RPCs. |
| [`scripts/check-no-llm-credential-reads.mjs`](../scripts/check-no-llm-credential-reads.mjs) | LLM-credential reads from outside the daemon's per-tenant key envelope. |
| [`scripts/check-no-provider-k8s-access.mjs`](../scripts/check-no-provider-k8s-access.mjs) | Direct k8s API access from provider code paths. |
| [`scripts/check-no-secret-in-logs.mjs`](../scripts/check-no-secret-in-logs.mjs) | `client_secret`, raw JWT, etc. in log lines. |
| [`scripts/check-no-secrets-in-client.mjs`](../scripts/check-no-secrets-in-client.mjs) | Server-only secrets leaking into client bundles. |
| [`scripts/check-no-stale-tenant-resolution.mjs`](../scripts/check-no-stale-tenant-resolution.mjs) | Tenant resolution paths that bypass the active-tenant cookie + FGA-membership flow. |

Don't disable a guard. Fix the code.

## Cross-link

- Adding a new RPC: [`how-to-add-a-rpc.md`](./how-to-add-a-rpc.md).
- Wrong vs right code shapes: [`forbidden-patterns.md`](./forbidden-patterns.md).
- Machine-readable rules: [`rules.yaml`](./rules.yaml).
- SDK identity types: `core/sdk/docs/auth.md`.
- ext-authz internals (the layer above the daemon): `core/ext-authz/docs/auth.md`.
- Helm wiring (Envoy chain, SPIRE, Zitadel SAs): `enterprise/deploy/docs/auth.md`.
