/**
 * Prometheus counters for the dashboard → daemon admin RPC path
 * (spec `dashboard-admin-via-envoy`, Req 8 criterion 4).
 *
 * Every admin-RPC call now routes through Envoy with a SPIFFE JWT-SVID in
 * the `Authorization` header. These three counters give operators the
 * signals needed to distinguish "app-layer denial" (FGA said no),
 * "auth-layer denial" (Envoy rejected the JWT), and "identity-layer
 * failure" (SPIRE couldn't mint a token at all).
 *
 * All metrics register against the shared `registry` singleton and are
 * exposed via `/api/metrics`. Label cardinality is deliberately bounded:
 * no tenant-id, user-id, or SPIFFE subject appears as a label, those
 * blow up on tenant counts and live in the audit stream instead.
 */

import { getOrCreateCounter } from "./helpers";

/** Terminal outcome of a single admin RPC from the dashboard's POV. */
export type AdminRpcStatus =
  | "ok"
  | "denied" // upstream returned PermissionDenied / Unauthenticated
  | "unavailable" // transport/connect error (including Envoy 502/503)
  | "error"; // everything else, deserialization, unexpected exceptions

/** Why a JWT-SVID mint attempt ended. */
export type JwtRefreshOutcome =
  | "ok" // fresh token minted
  | "cached" // served from in-process cache, no SPIRE round-trip
  | "stale_while_revalidate" // served stale token, kicked off refresh
  | "unreachable" // SPIRE Workload API timed out / refused
  | "not_configured" // no socket path at runtime
  | "rejected"; // minted token failed local validation

/**
 * Every admin RPC the dashboard issues. `method` is the short gRPC method
 * name (e.g. `UpsertTenantQuota`), bounded by the TenantAdminService /
 * PlatformOperatorService / UserService proto definitions.
 */
export const adminRpcTotal = getOrCreateCounter({
  name: "gibson_admin_rpc_total",
  help: "Total admin RPCs from the dashboard through Envoy to the daemon, labelled by gRPC method and terminal status.",
  labelNames: ["method", "status"] as const,
});

/**
 * SPIFFE JWT-SVID mint attempts. `outcome` partitions the cache-hit vs
 * SPIRE-miss cases so we can alert on SPIRE outages WITHOUT being misled
 * by steady-state cache hits.
 */
export const adminJwtRefreshTotal = getOrCreateCounter({
  name: "gibson_admin_jwt_refresh_total",
  help: "SPIFFE JWT-SVID fetch outcomes on the dashboard admin-RPC path.",
  labelNames: ["outcome"] as const,
});

/**
 * Upstream (Envoy) HTTP failures on the admin path. Distinct from
 * `adminRpcTotal{status=unavailable}` because this counter captures the
 * precise Envoy status (502, 503, 504), the correlated signal to look
 * at when Envoy itself is the problem, not the daemon.
 */
export const adminEnvoyUpstreamErrorsTotal = getOrCreateCounter({
  name: "gibson_admin_envoy_upstream_errors_total",
  help: "HTTP errors returned by Envoy on the admin-RPC path, labelled by status.",
  labelNames: ["envoy_status"] as const,
});
