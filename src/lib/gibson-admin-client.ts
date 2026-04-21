/**
 * Thin typed wrapper for the daemon's DaemonAdminService.
 *
 * Called by the dashboard's `/api/admin/provisioning/*` routes (which are
 * SPIFFE-JWT-authed from the tenant-operator) to forward entitlement writes
 * (UpsertTenantQuota, FGA tuple writes, catalog seeding) downstream to the
 * daemon.
 *
 * **Transport**: HTTPS gRPC through Envoy's `api.<domain>` edge gateway —
 * the same entry point every out-of-cluster SDK caller uses. Envoy
 * terminates TLS with its chart-issued cert (trusted via
 * `NODE_EXTRA_CA_CERTS`), validates our SPIFFE JWT-SVID via its
 * `jwt_authn.spiffe` provider, and forwards to the daemon with the standard
 * HMAC-signed `x-gibson-identity-*` tuple that the daemon's FGA
 * interceptor already knows how to authorize. Zero direct pod-to-pod mTLS.
 *
 * **Authentication**: every request carries
 * `Authorization: Bearer <JWT-SVID>` minted via the SPIRE Workload API
 * (`src/lib/spiffe/jwt-svid.ts`). Token is cached in-process and refreshed
 * at 30 min before expiry.
 *
 * Spec: `dashboard-admin-via-envoy`.
 */
import "server-only";

import { createGrpcTransport } from "@connectrpc/connect-node";
import { createClient, type Interceptor } from "@connectrpc/connect";
import { DaemonAdminService } from "@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb";
import { getSpiffeJwt } from "@/src/lib/spiffe/jwt-svid";
import {
  adminRpcTotal,
  adminEnvoyUpstreamErrorsTotal,
  type AdminRpcStatus,
} from "@/src/lib/metrics/gibson-admin";

// ---------------------------------------------------------------------------
// Configuration — all env-overridable so prod overlays can point at a
// different ingress (cert-manager'd hostname, separate admin-only edge, etc.)
// without a rebuild.
// ---------------------------------------------------------------------------

/**
 * Envoy edge URL the admin client dials. Dev: `https://api.zero-day.local:30443`.
 * Staging/prod: `https://api.<domain>` (no port — standard 443 behind a proper
 * LoadBalancer). Set via `ADMIN_ENVOY_BASE_URL` in the chart.
 */
const ENVOY_BASE_URL =
  process.env.ADMIN_ENVOY_BASE_URL ?? "https://api.zero-day.local:30443";

/**
 * SPIFFE audience claim on the JWT-SVID. Must match the `audiences` list
 * configured on Envoy's `spiffe` provider in `envoy.yaml`. The daemon does
 * not itself check `aud` — Envoy does — but keeping the audience scoped
 * prevents the same token from being accepted on other Envoy-fronted
 * services by accident.
 */
const DAEMON_AUDIENCE =
  process.env.GIBSON_DAEMON_SPIFFE_AUDIENCE ??
  "spiffe://gibson.io/platform/daemon";

/**
 * Regression-comparison override. When `GIBSON_ADMIN_VIA_ENVOY=false` the
 * admin client falls back to the legacy direct-to-daemon mTLS path for
 * bisection only. Default `true` in every environment.
 *
 * The legacy path is deliberately NOT implemented in this file — the build
 * guard `scripts/check-no-direct-daemon-grpc.mjs` (spec task 19) fails if
 * anyone re-introduces it. If you genuinely need the direct path back,
 * revert the guard and this flag together in a reviewed PR.
 */
const VIA_ENVOY =
  (process.env.GIBSON_ADMIN_VIA_ENVOY ?? "true") !== "false";

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * Attach the SPIFFE JWT-SVID on every admin RPC.
 *
 * Minter caches for ~30 min per audience, so steady-state this is a Map
 * lookup, not a Workload-API round trip. On a cold process or after cache
 * invalidation the minter adds ~50ms to the first call.
 */
/**
 * Classifies a thrown error into the `AdminRpcStatus` label set.
 * Connect-RPC maps every transport / gRPC error to a `ConnectError` with a
 * `.code` property; we bucket by that code. Anything unrecognised falls
 * into `error` to keep the label cardinality bounded.
 *
 * `code` values here come from `@connectrpc/connect/Code` — we avoid
 * importing the enum at module load time (costs a few KB) and match on
 * the stable string names instead.
 */
function classifyError(err: unknown): AdminRpcStatus {
  const code = (err as { code?: string | number; name?: string }).code;
  const codeStr = typeof code === "number" ? String(code) : code;
  if (codeStr === "permission_denied" || codeStr === "unauthenticated") {
    return "denied";
  }
  if (
    codeStr === "unavailable" ||
    codeStr === "deadline_exceeded" ||
    codeStr === "aborted"
  ) {
    return "unavailable";
  }
  return "error";
}

/**
 * Extracts a short HTTP status from an Envoy-surfaced transport error.
 * Envoy emits 502 (no healthy upstream), 503 (circuit breaker), and 504
 * (upstream timeout) when the daemon is the problem. We only record the
 * counter when the error clearly originated at the edge, not on the wire.
 */
function envoyStatusFrom(err: unknown): string | null {
  const e = err as {
    metadata?: { get?: (k: string) => string | null };
    httpStatus?: number;
  };
  if (typeof e.httpStatus === "number") {
    const s = e.httpStatus;
    if (s === 502 || s === 503 || s === 504) return String(s);
  }
  return null;
}

/**
 * Telemetry interceptor: runs OUTSIDE the JWT interceptor so it captures
 * errors raised by either layer. Emits one `adminRpcTotal` increment per
 * request and, when the error looks Envoy-shaped, bumps the upstream
 * errors counter.
 *
 * TODO(otel): once `@opentelemetry/api` is available in this process,
 * wrap the `next(req)` call in a `tracer.startSpan("gibson.admin.rpc",
 * {attributes: {"rpc.method": req.method.name, ...}})`. The counter
 * increments below will become span attributes.
 */
const telemetryInterceptor: Interceptor = (next) => async (req) => {
  const method = req.method.name;
  try {
    const res = await next(req);
    adminRpcTotal.inc({ method, status: "ok" });
    return res;
  } catch (err) {
    const status = classifyError(err);
    adminRpcTotal.inc({ method, status });
    const envoyStatus = envoyStatusFrom(err);
    if (envoyStatus) {
      adminEnvoyUpstreamErrorsTotal.inc({ envoy_status: envoyStatus });
    }
    throw err;
  }
};

const spiffeJwtInterceptor: Interceptor = (next) => async (req) => {
  const jwt = await getSpiffeJwt({ audience: DAEMON_AUDIENCE });
  // Connect's `req.header` is a Headers-like object; `set` replaces any
  // existing value (there should be none — we're the first write).
  req.header.set("Authorization", `Bearer ${jwt}`);
  return next(req);
};

let cachedClient: ReturnType<typeof createClient<typeof DaemonAdminService>> | null = null;

export function getDaemonAdminClient() {
  if (cachedClient) return cachedClient;

  if (!VIA_ENVOY) {
    // Intentional crash, not a silent fallback. The build guard prevents
    // the direct path from living in the codebase; trying to flip this flag
    // without also reverting the guard means the operator has dangerously
    // inconsistent config.
    throw new Error(
      "GIBSON_ADMIN_VIA_ENVOY=false was set but the direct-to-daemon path has been removed. " +
        "Re-enable by reverting the spec `dashboard-admin-via-envoy` and rebuilding.",
    );
  }

  const transport = createGrpcTransport({
    baseUrl: ENVOY_BASE_URL,
    // Envoy's TLS cert is the chart-generated self-signed wildcard in
    // dev and cert-manager-issued in prod. Either way it is trusted via
    // `NODE_EXTRA_CA_CERTS` mounted on the dashboard pod — no
    // `rejectUnauthorized: false`, no per-request CA override.
    //
    // Interceptor ordering matters: Connect runs interceptors in the
    // order given, and the OUTERMOST one (index 0) wraps everything
    // inside it. We put telemetry OUTSIDE the JWT minter so that a
    // failure inside `getSpiffeJwt` still increments `adminRpcTotal`
    // with a meaningful status label.
    interceptors: [telemetryInterceptor, spiffeJwtInterceptor],
  });
  cachedClient = createClient(DaemonAdminService, transport);
  return cachedClient;
}
