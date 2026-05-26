# how-to-add-a-rpc.md — `zeroroot-ai/dashboard`

The dashboard does not own RPCs in the same sense the SDK or the daemon
do — it consumes them. "Adding an RPC" from the dashboard's perspective
means **calling a newly-shipped daemon RPC from a Next.js route**.

Worked example: **"add a Server Action that lists the active tenant's
mission drafts using the new `ListMyDrafts` RPC."**

Spec: `unified-identity-and-authorization`. Read [`auth.md`](./auth.md)
first if you have not.

## Step 1 — Wait for the SDK + daemon to ship the RPC

Adding the proto + handler is upstream work:

- SDK: see `core/sdk/docs/how-to-add-a-rpc.md`.
- Daemon: see `core/gibson/docs/how-to-add-a-rpc.md`.

Don't add UI for an unshipped RPC. The dashboard's `pnpm prebuild`
typecheck will fail because the generated proto bindings don't carry
the method.

## Step 2 — Bump the SDK pin and regenerate TS bindings

```
pnpm add @zeroroot-ai/sdk@vX.Y.Z   # or the npm distribution name
pnpm buf generate                  # regenerates src/gen/...
```

The dashboard generates Connect-RPC bindings via Buf. Running buf
generate updates `src/gen/gibson/daemon/v1/daemon_pb.ts` with the new
method type. The corresponding `permissions.ts` constant is also
regenerated; UI gating uses it.

## Step 3 — Decide which transport to use

| Use | When |
|---|---|
| `userClient(svc)` | A signed-in human is requesting their own data (Server Component, Server Action, route handler under `app/dashboard/(auth)/...`). FGA decisions run against the user's Zitadel identity. |
| `serviceClient(svc, tenantId)` | The route has **no user context** (in-cluster admin-provisioning callback, entitlement-driven CRD reconciler, signup webhook). The bearer is the dashboard pod's own Zitadel JWT. |

Default to `userClient`. Use `serviceClient` only when the call genuinely
has no end user — and audit the choice manually before merging
(rule `dashboard-auth-009`).

For `ListMyDrafts` (user-facing), use `userClient`.

## Step 4 — Implement the Server Action / route handler

```ts
// app/dashboard/(auth)/missions/drafts/actions.ts
'use server';

import { userClient } from '@/src/lib/gibson-client';
import { DaemonService } from '@/src/gen/gibson/daemon/v1/daemon_pb';

export async function listMyDrafts(pageToken?: string) {
  const client = userClient(DaemonService);

  // userClient internally:
  //   - reads session.accessToken via requireUserToken()
  //     (throws ConnectError(Unauthenticated) if no session)
  //   - reads the active-tenant cookie via getActiveTenant()
  //     (throws NoActiveTenantError / StaleActiveTenantError otherwise)
  //   - composes both into Authorization: Bearer + x-gibson-tenant headers
  //   - dials Envoy at ENVOY_BASE_URL (mTLS via X509-SVID when in-cluster)

  const resp = await client.listMyDrafts({ pageSize: 20, pageToken });
  return { drafts: resp.drafts, nextToken: resp.nextToken };
}
```

The Server Component that consumes the action:

```tsx
// app/dashboard/(auth)/missions/drafts/page.tsx
import { listMyDrafts } from './actions';

export default async function DraftsPage() {
  const { drafts } = await listMyDrafts();
  return <DraftsTable drafts={drafts} />;
}
```

## Step 5 — Gate UI controls on the regenerated permissions constant

The SDK's registry codegen emits `permissions.ts`; the dashboard imports
it and uses the matching constant to decide whether a control renders.
UI gating is **informational** — ext-authz remains the authoritative
enforcement point; if a user clicks a hidden button via DevTools, the
RPC still rejects.

```tsx
import { Permissions } from '@/src/gen/auth/permissions';
import { hasPermission } from '@/src/lib/auth/roles';

const session = await auth();
const canListDrafts = hasPermission(session, Permissions.DAEMON_LIST_MY_DRAFTS);

return canListDrafts ? <DraftsTable ... /> : null;
```

## Step 6 — Handle the standard error shapes

Connect-RPC raises `ConnectError` with a `.code` property. The user-token
helper raises `ConnectError(Unauthenticated)` when no session exists; the
active-tenant helper raises `NoActiveTenantError` /
`StaleActiveTenantError`. Middleware
([`middleware.ts`](../middleware.ts)) catches both.

```ts
import { ConnectError, Code } from '@connectrpc/connect';

try {
  return await listMyDrafts();
} catch (e) {
  if (e instanceof ConnectError && e.code === Code.PermissionDenied) {
    return { error: 'You do not have access to drafts in this tenant.' };
  }
  throw e;          // let middleware redirect for Unauthenticated
}
```

Don't echo internal detail to the browser — ext-authz already returns a
constant body. The dashboard surfaces user-friendly equivalents.

## Step 7 — If the RPC is in `DaemonAdminService`

Same pattern, different generated symbol:

```ts
import { DaemonAdminService } from '@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb';

const client = userClient(DaemonAdminService);   // user-acting admin RPC
// or
const client = serviceClient(DaemonAdminService, tenantId);  // workload-acting
```

`DaemonAdminService` RPCs are FGA-gated to platform-operator role; if
the calling user lacks the role, the call fails with `PermissionDenied`
at ext-authz. The dashboard never decides admin authorisation locally
— it forwards the bearer and trusts ext-authz.

## Step 8 — Run the full prebuild guard chain

```
pnpm prebuild
```

The chain runs every guard listed in `auth.md` plus type-checking,
ESLint, and the generated-permissions consistency check. Fix any failure
at the call site; do not relax a guard.

## Step 9 — End-to-end validation

For non-trivial flows, ship a Playwright test under `e2e/` that exercises
the full path: sign in → set active tenant → trigger the new action →
assert the response. The dashboard repo's `make test-*-e2e` Makefile
targets run these against `make deploy-local`.
