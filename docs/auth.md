# auth.md, `zeroroot-ai/dashboard`

Auth model from the dashboard's perspective. AI-agent-facing.
Spec: `unified-identity-and-authorization`.

## Three transports, one factory

The dashboard talks to the Gibson daemon **only** through Envoy
([`api/<domain>:<port>`](#)). There is no direct dial, the
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
`makeClient` is the lock, adding a third sourcing strategy means a new
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
There is no SPIFFE JWT-SVID minting in the dashboard, the deleted
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
falls back to plain HTTPS. The Bearer JWT auth path is unaffected, TLS
is just edge-only instead of mutual.

The `scripts/check-no-spiffe-in-user-client.mjs` build guard fails the
build if SPIFFE-JWT-SVID-minting code re-appears anywhere in the
dashboard.

## "Register Agent" flow

[`app/api/agents/register/route.ts`](../app/api/agents/register/route.ts)
asks the daemon for a new component identity:

1. Authenticate caller via Auth.js (`auth()`).
2. Resolve active tenant and assert caller has at least the `admin`
   role (only tenant admins/owners may register agents).
3. Validate request body (name, optional description, kind, grants).
4. Call `AgentIdentityService.CreateAgentIdentity` through Envoy. The
   daemon owns the IdP provisioning and the FGA tuple writes.
5. Respond with `{ bootstrapToken, gibsonUrl }`. The response is the
   only place the token appears. The route never logs it. The
   `scripts/check-no-secret-in-logs.mjs` build guard verifies this.

The browser shows the token once, with a warning that it cannot be
viewed again, and the platform URL. There is no enroll command. The
component reads `GIBSON_URL` and `GIBSON_BOOTSTRAP_TOKEN` and enrolls
when it starts.

## What's gone

| Removed | Why |
|---|---|
| `src/lib/gibson-admin-client.ts` | Collapsed into single `makeClient` factory + two wrappers. |
| `src/lib/spiffe/jwt-svid.ts` | Outbound subject identity is Zitadel; SPIFFE is X509-SVID only. |
| BetterAuth integration | Audit C13, weak symmetric HMAC. Replaced by Zitadel. |
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
| [`scripts/check-no-stale-tenant-resolution.mjs`](../scripts/check-no-stale-tenant-resolution.mjs) | Re-introduction of deleted tenant-resolution machinery (`session.user.tenant`, `gibson:tenant` / `urn:zitadel:...` claims, `tenants-by-owner`). Orthogonal to the branded type below. |

Don't disable a guard. Fix the code.

## Branded `TenantId`

The former `check-no-lenient-tenant.mjs` guard was deleted and replaced by a
**type-system invariant**. `src/lib/auth/active-tenant.ts` exports an opaque
`TenantId = string & { readonly __brand: 'TenantId' }`. A raw `string`
(`'default'`, a smeared `session.user.tenantId || ''`, an un-revalidated cookie
value) is NOT assignable to `TenantId`, so passing one where a validated active
tenant is required is a **compile error**, not merely a runtime fail-close.

- The only fail-closed mint is `requireActiveTenant()` / `getActiveTenant()`,
  which HMAC-validates the cookie and re-checks FGA memberships before branding.
- `makeClient(svc, getToken, getTenant)` requires `getTenant: () => Promise<TenantId>`,
  so the daemon-call boundary cannot receive an unvalidated tenant.
- The single documented escape hatch is `unsafeTenantId(value)`, used only by
  the service-acting transport (`serviceClient`), which has no cookie or user
  to validate against. A
  `unsafeTenantId(...)` call in a user-facing route handler is a review smell.

`check-no-stale-tenant-resolution.mjs` is kept: it guards against re-introducing
the *deleted* claim-reading machinery (string literals / module paths), which
the branded type cannot express.

## Cross-link

- Adding a new RPC: [`how-to-add-a-rpc.md`](./how-to-add-a-rpc.md).
- Wrong vs right code shapes: [`forbidden-patterns.md`](./forbidden-patterns.md).
- Machine-readable rules: [`rules.yaml`](./rules.yaml).
- SDK identity types: `core/sdk/docs/auth.md`.
- ext-authz internals (the layer above the daemon): `core/ext-authz/docs/auth.md`.
- Helm wiring (Envoy chain, SPIRE, Zitadel SAs): the umbrella chart in the charts repository.
