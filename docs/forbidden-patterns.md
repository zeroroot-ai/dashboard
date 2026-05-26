# forbidden-patterns.md — `zeroroot-ai/dashboard`

Companion to [`rules.yaml`](./rules.yaml). Wrong vs right code shapes for
the dashboard's auth surface. Spec: `unified-identity-and-authorization`.

## DASHBOARD-AUTH-001: dialing the daemon directly

Wrong (pre-Phase-4 — `src/lib/gibson-admin-client.ts` and the various
admin route handlers):

```ts
import { createGrpcTransport } from '@connectrpc/connect-node';

const transport = createGrpcTransport({
  baseUrl: process.env.GIBSON_DAEMON_ADDRESS ?? 'gibson:50002', // forbidden
  // ...
});
```

Right ([`src/lib/gibson-client.ts:275`](../src/lib/gibson-client.ts)):

```ts
import { userClient } from '@/src/lib/gibson-client';
import { DaemonService } from '@/src/gen/gibson/daemon/v1/daemon_pb';

const client = userClient(DaemonService);
const status = await client.status({});
```

The `scripts/check-no-direct-daemon-grpc.mjs` build guard rejects every
direct daemon URL and `GIBSON_DAEMON_ADDRESS` reference at prebuild
time. Fix the call site, not the guard.

## DASHBOARD-AUTH-002: minting JWT-SVIDs from the dashboard

Wrong (pre-Phase-4 — the deleted `src/lib/spiffe/jwt-svid.ts`):

```ts
import { FetchJWTSVID } from '@spiffe/workload-api';      // forbidden

async function adminBearer(): Promise<string> {
  const svid = await FetchJWTSVID({
    audience: 'spiffe://zeroroot.ai/platform/daemon',
  });
  return svid.svid;
}
```

Right — service-acting subject identity is Zitadel client_credentials
([`src/lib/auth/service-token.ts`](../src/lib/auth/service-token.ts)):

```ts
import { serviceClient } from '@/src/lib/gibson-client';
import { DaemonAdminService } from '@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb';

const client = serviceClient(DaemonAdminService, tenantId);
await client.shutdown({});
```

The dashboard pod still presents an X509-SVID for in-cluster mTLS to
Envoy ([`src/lib/spiffe-mtls/svid.ts`](../src/lib/spiffe-mtls/svid.ts)),
but that is a transport concern composed by `gibson-client.ts`
automatically — never call SPIFFE APIs directly from a route handler.

## DASHBOARD-AUTH-003: importing BetterAuth

Wrong (audit C13 — weak symmetric HMAC, no kid/iss/aud/jti):

```ts
import { betterAuth } from 'better-auth';                 // forbidden
import { admin } from 'better-auth/plugins';

export const auth = betterAuth({
  emailAndPassword: { enabled: true },
  plugins: [admin()],
});
```

Right ([`auth.ts`](../auth.ts)):

```ts
import NextAuth from 'next-auth';
import Zitadel from 'next-auth/providers/zitadel';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Zitadel({ /* ... */ })],
  // ...
});
```

Zitadel is the sole IdP. Auth.js is the sole session library.

## DASHBOARD-AUTH-004: parsing or storing `gsk_` API keys

Wrong:

```ts
function isAgentKey(token: string): boolean {
  return token.startsWith('gsk_');                        // forbidden
}
```

Right — agent identities are Zitadel machine users created via the
Register Agent UI ([`app/api/agents/register/route.ts`](../app/api/agents/register/route.ts)):

```ts
const machineUser = await zitadelAdmin.createMachineUser({
  userName: `agent-${tenant}-${name}`,
  // ...
});
const { clientId, clientSecret } = await zitadelAdmin.mintClientSecret(machineUser.id);
return Response.json({ clientId, clientSecret, /* ... */ });
```

The dashboard never persists `clientSecret` — it is in the response
body once and gone.

## DASHBOARD-AUTH-005: direct fetch() to Zitadel

Wrong (scatters service-account credentials across the codebase):

```ts
const r = await fetch(`${zitadelBase}/management/v1/users/_search`, {
  headers: { Authorization: `Bearer ${process.env.ZITADEL_PAT}` },  // forbidden
});
```

Right ([`src/lib/zitadel/admin-client-factory.ts`](../src/lib/zitadel/admin-client-factory.ts)):

```ts
import { getSignupZitadelAdminClient } from '@/src/lib/zitadel/admin-client-factory';

const zitadel = await getSignupZitadelAdminClient();
const users = await zitadel.searchUsers({ /* ... */ });
```

The factory caches tokens, refreshes before expiry, and is the single
point that holds Zitadel service-account credentials. The build guard
`scripts/check-no-direct-zitadel-fetch.mjs` enforces this.

## DASHBOARD-AUTH-006: logging the agent client_secret

Wrong (echoes the one-time secret to the log pipeline):

```ts
const result = await zitadelAdmin.mintClientSecret(userId);
logger.info('agent registered', { clientId: result.clientId, clientSecret: result.clientSecret }); // forbidden
return Response.json(result);
```

Right ([`app/api/agents/register/route.ts`](../app/api/agents/register/route.ts) audit-only):

```ts
const result = await zitadelAdmin.mintClientSecret(userId);
logger.info('agent registered', { clientId: result.clientId, tenant, name });
// secret is response-body only; never logged.
return Response.json(result);
```

`scripts/check-no-secret-in-logs.mjs` greps for `client_secret`,
`access_token`, raw JWT shapes, etc. in proximity to `console`/`logger`
calls.

## DASHBOARD-AUTH-007: stale tenant resolution

Wrong (audit C11 mirror — bypasses the FGA-membership check):

```ts
// Server Component / Server Action
const tenant = req.searchParams.get('tenant');            // forbidden
const tenant = session.tenant;                            // forbidden
const client = userClient(DaemonService); // would have no tenant
```

Right ([`src/lib/auth/active-tenant.ts`](../src/lib/auth/active-tenant.ts)):

```ts
import { getActiveTenant } from '@/src/lib/auth/active-tenant';

const tenant = await getActiveTenant(); // throws NoActiveTenantError or StaleActiveTenantError
const client = userClient(DaemonService); // pulls active tenant from cookie internally
```

`getActiveTenant` reads the active-tenant cookie, calls
`ListMyMemberships` against the user's Zitadel JWT, and verifies the
cookie value still resolves to a current FGA tenant tuple. Middleware
catches the two error shapes and redirects.

## DASHBOARD-AUTH-008: reading LLM provider keys

Wrong:

```ts
const cred = await db.providerCredentials.findUnique({ where: { id }});
const apiKey = decryptCredential(cred.encrypted, cred.iv);  // forbidden
return Response.json({ apiKey });
```

Right — the daemon owns the per-tenant key envelope; the dashboard
asks for status without ever seeing key material:

```ts
const client = userClient(DaemonAdminService);
const status = await client.testProvider({ provider: 'openai' });
return Response.json({ ok: status.ok, lastUsed: status.lastUsed });
```

`scripts/check-no-llm-credential-reads.mjs` flags any decrypt-shaped
function call against credential payloads in dashboard code.

## DASHBOARD-AUTH-009: serviceClient from a user-facing route

Wrong (silently widens the user's effective privileges — the
service-acting JWT carries the `dashboard-platform-operator` role at
Zitadel, which a user-acting JWT never does):

```ts
// app/dashboard/(auth)/admin/users/page.tsx
const client = serviceClient(DaemonAdminService, currentTenant);   // forbidden
const users = await client.listUsers({});
```

Right — same page, user-acting:

```ts
const client = userClient(DaemonAdminService);
const users = await client.listUsers({});  // ext-authz checks user's FGA tuples
```

`serviceClient` belongs only in code paths with **no user context** —
`/api/admin/provisioning/*` (tenant-operator callbacks),
entitlement-driven CRD writes, the in-cluster signup webhook. Anywhere
else, use `userClient`. Audit each `serviceClient` call site manually
before merging.
