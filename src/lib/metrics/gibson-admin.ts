// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Prometheus counters for the dashboard → daemon admin RPC path
 * (spec `dashboard-admin-via-envoy`, Req 8 criterion 4).
 *
 * Every admin-RPC call routes through Envoy with the person's Zitadel
 * bearer token (see `src/lib/auth/user-token.ts`). These two counters give
 * operators the signals needed to distinguish "app-layer denial" (FGA said
 * no) from "upstream failure" (Envoy returned 502, 503 or 504).
 *
 * `scripts/check-metrics-have-producers.mjs` fails the build when a series
 * declared here has no producer. A JWT-SVID mint counter lived here with
 * no minter behind it (dashboard#173); the minter was deleted with the
 * SPIFFE JWT-SVID outbound path.
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

/**
 * Every admin RPC the dashboard issues. `method` is the short gRPC method
 * name (e.g. `UpsertTenantQuota`), bounded by the TenantAdminService /
 * PlatformOperatorService / UserService proto definitions.
 */
export const adminRpcTotal = getOrCreateCounter({
  name: "gibson_admin_rpc_total",
  help: "Total admin RPCs from the dashboard through Envoy to the daemon, labeled by gRPC method and terminal status.",
  labelNames: ["method", "status"] as const,
});

/**
 * Upstream (Envoy) HTTP failures on the admin path. Distinct from
 * `adminRpcTotal{status=unavailable}` because this counter captures the
 * precise Envoy status (502, 503, 504), the correlated signal to look
 * at when Envoy itself is the problem, not the daemon.
 */
export const adminEnvoyUpstreamErrorsTotal = getOrCreateCounter({
  name: "gibson_admin_envoy_upstream_errors_total",
  help: "HTTP errors returned by Envoy on the admin-RPC path, labeled by status.",
  labelNames: ["envoy_status"] as const,
});
