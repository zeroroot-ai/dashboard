import 'server-only';
import {
  createClient,
  ConnectError,
  Code,
  type Client,
  type Interceptor,
} from '@connectrpc/connect';
import { createGrpcTransport } from '@connectrpc/connect-node';
import type { DescService } from '@bufbuild/protobuf';
import { requireUserToken } from '../auth/user-token';
import {
  getServiceToken,
  invalidateServiceToken,
} from '../auth/service-token';
import {
  getActiveTenant,
  unsafeTenantId,
  type TenantId,
} from '../auth/active-tenant';
import {
  adminRpcTotal,
  adminEnvoyUpstreamErrorsTotal,
  type AdminRpcStatus,
} from '../metrics/gibson-admin';

// ===========================================================================
// Single daemon transport, dashboard#814 (E9 security hardening).
//
// This module is the ONE place the dashboard constructs a ConnectRPC channel
// to the Gibson daemon. The transport built by `makeClient` below is
// MODULE-PRIVATE: `makeClient` and the underlying `createGrpcTransport` /
// `createClient` primitives are never exported. Callers receive only typed
// service clients through the sanctioned wrappers (`userClient`,
// `serviceClient`, `bootstrapClient`), so no code path outside this file can
// construct its own daemon channel with an unaudited token / tenant / Envoy
// URL combination.
//
// Enforcement:
//   - `@connectrpc/connect-node` (the transport package) and the
//     `createGrpcTransport` / `createConnectTransport` / `createClient`
//     primitives are banned everywhere else by the ESLint
//     `no-restricted-imports` rule (.eslintrc.js) AND by the build-time guard
//     `scripts/check-single-daemon-transport.mjs` (runs in `pnpm prebuild`).
//   - URL / env-var leakage is guarded separately by
//     `scripts/check-no-direct-daemon-grpc.mjs`.
//
// All daemon RPCs flow `dashboard → Envoy (jwt_authn + ext_authz) → daemon`
// through one URL: `ADMIN_ENVOY_BASE_URL`. There is no "admin" vs "user"
// transport distinction at the wire level; the difference lives in WHO the
// bearer represents (see `userClient` / `serviceClient` below).
// ===========================================================================

/**
 * Envoy edge URL the dashboard dials for every daemon RPC. Dev:
 * `https://api.zeroroot.local:30443`. Staging/prod: `https://api.<domain>`.
 * Set via `ADMIN_ENVOY_BASE_URL` in the chart.
 *
 * The env-var name is preserved from the older `dashboard-admin-via-envoy`
 * spec for chart-overlay continuity even though it now drives both the
 * user-acting and service-acting transports, there is one Envoy edge.
 */
const ENVOY_BASE_URL =
  process.env['ADMIN_ENVOY_BASE_URL'] ?? 'https://api.zeroroot.local:30443';

// ---------------------------------------------------------------------------
// SPIFFE module is loaded lazily via require() to keep @grpc/grpc-js out of
// the statically-traced module graph. Next.js 16 / Turbopack reports
// Module-not-found for grpc-js's Node-only requires (`dns`, `fs`, `cluster`)
// when statically reaching it from any non-Node bundle context, even with
// `serverExternalPackages` configured. The lazy load runs at first call,
// in the Node.js runtime, where those modules exist natively.
//
// The type surface below is hand-defined, `typeof import('../spiffe-mtls/svid')`
// would itself be a static module reference that Turbopack traces, defeating
// the lazy-load. Keep this type aligned with src/lib/spiffe-mtls/svid.ts
// exports (changes there require updating these signatures).
// ---------------------------------------------------------------------------
import type { SecureContextOptions } from 'node:tls';
interface SpiffeMod {
  isSpiffeAvailable(): boolean;
  warmX509SvidContext(): void;
  tryGetCachedX509SvidContext(): SecureContextOptions | undefined;
  getX509SvidContext(): Promise<SecureContextOptions>;
}
let spiffeMod: SpiffeMod | null = null;
let spiffeModFailed = false;
function loadSpiffe(): SpiffeMod | null {
  if (spiffeMod) return spiffeMod;
  if (spiffeModFailed) return null;
  try {
    // Use `node:module` createRequire so the require runs at call time in
    // the Node.js runtime. The path argument is built from a runtime
    // expression so Turbopack's static analyser cannot fold it back to a
    // literal it would trace into the module graph. Variable-string
    // require() and `typeof import()` were both still traced (Next.js 16
    // Turbopack pulls grpc-js into the bundle and fails to resolve its
    // `node:dns` / `node:fs` requires for non-Node bundle contexts even
    // with serverExternalPackages set). String concatenation forces the
    // path to be opaque at analysis time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createRequire } = require('node:module') as typeof import('node:module');
    const reqFromHere = createRequire(__filename);
    const segments = ['..', 'spiffe-mtls', 'svid'];
    const modPath = segments.join('/');
    spiffeMod = reqFromHere(modPath) as SpiffeMod;
    return spiffeMod;
  } catch {
    spiffeModFailed = true;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Telemetry interceptor (preserved metric names: `gibson_admin_rpc_total`
// + `gibson_admin_envoy_upstream_errors_total`). Operator dashboards key
// off these names; renaming would break alerting silently.
// ---------------------------------------------------------------------------

/**
 * Buckets a thrown gRPC error into the {@link AdminRpcStatus} label set.
 * Connect-RPC maps every transport / gRPC error to a `ConnectError` with
 * a `.code` property; we partition on that code. Anything unrecognised
 * collapses to `error` to keep label cardinality bounded.
 */
function classifyError(err: unknown): AdminRpcStatus {
  const code = (err as { code?: string | number }).code;
  const codeStr = typeof code === 'number' ? String(code) : code;
  if (codeStr === 'permission_denied' || codeStr === 'unauthenticated') {
    return 'denied';
  }
  if (
    codeStr === 'unavailable' ||
    codeStr === 'deadline_exceeded' ||
    codeStr === 'aborted'
  ) {
    return 'unavailable';
  }
  return 'error';
}

/**
 * Returns the HTTP status (as a string) when a transport error clearly
 * came from Envoy itself (502/503/504, no healthy upstream / circuit
 * breaker / upstream timeout). Returns null for daemon-level errors so
 * we don't double-count.
 */
function envoyStatusFrom(err: unknown): string | null {
  const e = err as { httpStatus?: number };
  if (typeof e.httpStatus === 'number') {
    const s = e.httpStatus;
    if (s === 502 || s === 503 || s === 504) return String(s);
  }
  return null;
}

/**
 * Telemetry interceptor: emits one `gibson_admin_rpc_total` increment
 * per call and bumps the upstream-errors counter when the failure looks
 * Envoy-shaped. Wrapped OUTSIDE the auth interceptor so token-mint
 * failures still produce a meaningful status label.
 */
const telemetryInterceptor: Interceptor = (next) => async (req) => {
  const method = req.method?.name ?? 'unknown';
  try {
    const res = await next(req);
    adminRpcTotal.inc({ method, status: 'ok' });
    return res;
  } catch (err) {
    adminRpcTotal.inc({ method, status: classifyError(err) });
    const envoyStatus = envoyStatusFrom(err);
    if (envoyStatus) {
      adminEnvoyUpstreamErrorsTotal.inc({ envoy_status: envoyStatus });
    }
    throw err;
  }
};

// ---------------------------------------------------------------------------
// SPIFFE wiring, sync resolver for createGrpcTransport's nodeOptions
// ---------------------------------------------------------------------------

let spiffeWarmedUp = false;
let spiffeFallbackLogged = false;

/**
 * Returns http2 nodeOptions populated with the dashboard pod's current
 * X509-SVID context, or `undefined` to leave the default plain-HTTPS
 * behaviour in place.
 *
 * Uses the SYNC accessor {@link tryGetCachedX509SvidContext}: the very
 * first outbound RPC may go without an SVID (cache cold), but kicks
 * off a background warm-up so the second call onwards rides on mTLS.
 * In a pod with steady traffic this is invisible; in cold-start
 * scenarios the first RPC is plain-TLS-but-still-Bearer-authenticated,
 * which is the same posture as the local-dev fallback.
 */
function spiffeNodeOptions():
  | (Parameters<typeof createGrpcTransport>[0]['nodeOptions'])
  | undefined {
  const mod = loadSpiffe();
  if (!mod || !mod.isSpiffeAvailable()) {
    if (!spiffeFallbackLogged) {
      spiffeFallbackLogged = true;
      console.warn(
        '[gibson-client] SPIFFE Workload API socket not present ' +
          `(SPIFFE_ENDPOINT_SOCKET=${process.env.SPIFFE_ENDPOINT_SOCKET ?? 'unset'}); ` +
          'falling back to plain HTTPS for outbound calls to Envoy.',
      );
    }
    return undefined;
  }
  if (!spiffeWarmedUp) {
    spiffeWarmedUp = true;
    mod.warmX509SvidContext();
  }
  const svidCtx = mod.tryGetCachedX509SvidContext();
  if (!svidCtx) {
    // Cache still cold (warm-up just kicked off). The first RPC goes
    // out without the SVID; by the second the cache is populated.
    return undefined;
  }
  // SecureContextOptions is a subset of http2.SecureClientSessionOptions
  // (cert/key/ca/minVersion all live on tls.SecureContextOptions which
  // SecureClientSessionOptions extends). Spread directly.
  return { ...svidCtx };
}

// ---------------------------------------------------------------------------
// Module-private low-level factory.
//
// `makeClient` is NOT exported. It is the single owner of the ConnectRPC
// transport; exporting it would let a caller wire an arbitrary token / tenant
// resolver and defeat the single-edge guarantee. The exported wrappers below
// are the only sanctioned ways to obtain a typed daemon client.
// ---------------------------------------------------------------------------

/**
 * Builds a connect-rpc client for `service` against the Envoy edge.
 * `getToken` and `getTenant` are invoked once per RPC and their values
 * become `Authorization: Bearer <token>` and `x-gibson-tenant: <tenant>`
 * respectively.
 *
 * This factory MUST NOT read env, session, or cookies, token + tenant
 * resolution is the caller's concern. That boundary keeps the file
 * deterministic and testable, and ensures no future code path can sneak a
 * third sourcing strategy in unnoticed.
 */
function makeClient<T extends DescService>(
  service: T,
  getToken: () => Promise<string>,
  getTenant: () => Promise<TenantId>,
): Client<T> {
  const authInterceptor: Interceptor = (next) => async (req) => {
    const [token, tenant] = await Promise.all([getToken(), getTenant()]);
    req.header.set('Authorization', `Bearer ${token}`);
    if (tenant) {
      req.header.set('x-gibson-tenant', tenant);
    }
    // Spec deploy#207: forward the per-request correlation ID to the
    // daemon so the daemon's structured log line and the dashboard's
    // log line share the same id. The dashboard reads / mints the ID
    // at the route edge; here we just propagate the unstored ALS
    // value when one exists.
    try {
      // Lazy-required so this module stays usable in tests that don't
      // bind an AsyncLocalStorage context.
      const { getCorrelationId } = await import('../correlation');
      const cid = getCorrelationId();
      if (cid && !req.header.has('x-correlation-id')) {
        req.header.set('x-correlation-id', cid);
      }
    } catch {
      // Non-fatal, correlation is best-effort. The daemon will mint
      // its own ID when the header is absent.
    }
    return next(req);
  };

  // Spec unified-identity-and-authorization Phase 4 (R2.5, R9.12):
  // dashboard pod presents an X509-SVID on the mTLS handshake to Envoy
  // when SPIFFE is wired. The Workload API socket only exists in
  // in-cluster deploys with SPIRE, local dev (no socket) gets plain
  // HTTPS with a one-time WARN log naming SPIFFE_ENDPOINT_SOCKET so
  // the operator knows we're falling back.
  const transport = createGrpcTransport({
    baseUrl: ENVOY_BASE_URL,
    nodeOptions: spiffeNodeOptions(),
    // Telemetry OUTSIDE auth so token failures still produce a status
    // label. Auth INSIDE so it's the last thing to touch headers before
    // the wire write.
    interceptors: [telemetryInterceptor, authInterceptor],
  });

  return createClient(service, transport);
}

// ---------------------------------------------------------------------------
// User-acting wrapper, bearer is the signed-in user's Zitadel access
// token; tenant comes from the active-tenant cookie. Throws
// `ConnectError(Unauthenticated)` when no session exists, and
// `NoActiveTenantError` / `StaleActiveTenantError` from the cookie path.
// Middleware handles both.
// ---------------------------------------------------------------------------

/**
 * Returns a typed connect-rpc client that authenticates as the current
 * signed-in user. Use this from every Server Component / Server Action /
 * route handler that runs inside an authenticated browser session.
 *
 * This is the canonical wrapper for user-acting RPCs. Internally composes
 * the module-private {@link makeClient} with {@link requireUserToken} and
 * {@link getActiveTenant}, both of which are `react.cache()`-memoized so
 * multi-RPC renders share a single `auth()` + cookie read.
 */
export function userClient<T extends DescService>(service: T): Client<T> {
  return makeClient(service, requireUserToken, getActiveTenant);
}

/**
 * Returns a typed connect-rpc client that authenticates as the dashboard
 * pod's own Zitadel service account. Tenant header is set to the
 * `tenantId` argument explicitly, service callers know the tenant they
 * are acting on; there is no cookie context to fall back on.
 *
 * **MUST NEVER be called from user-facing route handlers.** The whole
 * point of the dual transport is that user-acting code runs as the user
 * (so FGA decisions are made against their identity) and service-acting
 * code runs as the workload (where no user exists). Using
 * `serviceClient` from a path that actually has a user-bound session
 * silently widens that user's effective privileges. Use {@link userClient}
 * from those paths instead.
 *
 * `tenantId` is a raw `string` (not a branded {@link TenantId}) because the
 * service-acting path has no cookie/user context to validate against, callers
 * pass a daemon-derived or empty tenant. This is the documented
 * non-validated tenant boundary (dashboard#815); the value is branded
 * internally via {@link unsafeTenantId} only to satisfy {@link makeClient}'s
 * mint contract.
 */
export function serviceClient<T extends DescService>(
  service: T,
  tenantId: string,
): Client<T> {
  return makeClient(service, getServiceToken, async () => unsafeTenantId(tenantId));
}

/**
 * Returns a typed user-acting client that sends NO `x-gibson-tenant` header
 * (empty tenant). This is the membership-bootstrap boundary: a small set of
 * RPCs (`DaemonService.ListMyMemberships`, `UserService.InvalidateMembershipCache`)
 * run BEFORE any active tenant can be validated, since the active-tenant
 * cookie's validity itself depends on the membership list. Composing
 * {@link userClient} there would create a circular dependency through the
 * active-tenant cookie read.
 *
 * Use this ONLY from `src/lib/auth/membership.ts`. The empty tenant is branded
 * via {@link unsafeTenantId} per the dashboard#815 non-validated boundary.
 */
export function bootstrapClient<T extends DescService>(service: T): Client<T> {
  return makeClient(service, requireUserToken, async () => unsafeTenantId(''));
}

/**
 * Wrap a service-acting RPC call so a single Unauthenticated/401 from
 * Envoy triggers a token re-mint and one retry. Most callers won't need
 * this, Zitadel tokens are valid for hours and we refresh proactively -
 * but mid-flight signing-key rotation or clock skew can put a still-cached
 * token over the line.
 *
 * Exported for service-acting write callers; reads can tolerate a one-shot
 * 401 surfacing as an error.
 */
async function withServiceRetry<R>(fn: () => Promise<R>): Promise<R> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConnectError && err.code === Code.Unauthenticated) {
      invalidateServiceToken();
      return fn();
    }
    throw err;
  }
}
