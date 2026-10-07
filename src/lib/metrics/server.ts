// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The metrics-only listener of the dashboard (charts#515).
 *
 * It serves `GET /metrics` from the process-wide registry and refuses every
 * other path and method. The port carries no API, so the network policy of
 * the chart admits the cluster scraper to it and to nothing else. The API
 * port serves no metrics.
 *
 * Plain HTTP with no authentication, unlike the mTLS metrics listeners of
 * the daemon and ext-authz. The series carry no tenant, user or address
 * label, and the network rule is the boundary (trust by placement). A
 * change that adds such a label must add TLS here first.
 *
 * Env:
 *   DASHBOARD_METRICS_PORT   the port to bind, default 9464. It must differ
 *                            from PORT, the API port.
 */

import { createServer, type Server } from "node:http";

import { registry } from "@/src/lib/metrics/registry";
// Each metric module registers its series at load. Loading them here gives
// the scraper every series from boot, before the first request uses one.
import "@/src/lib/metrics/auth";
import "@/src/lib/metrics/gibson-admin";

export const DEFAULT_METRICS_PORT = 9464;

/** Prometheus text exposition format 0.0.4. */
const PROM_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

type Env = Readonly<Record<string, string | undefined>>;

/** The port of the listener, from DASHBOARD_METRICS_PORT or the default. */
export function metricsPort(env: Env = process.env): number {
  const raw = env.DASHBOARD_METRICS_PORT;
  const port = raw === undefined || raw === "" ? DEFAULT_METRICS_PORT : /^[0-9]{1,5}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`DASHBOARD_METRICS_PORT ${JSON.stringify(raw)} is not a port`);
  }
  if (env.PORT !== undefined && env.PORT !== "" && Number(env.PORT) === port) {
    throw new Error(`DASHBOARD_METRICS_PORT ${port} equals PORT, the API port: the metrics port carries no API`);
  }
  return port;
}

/** The handler of the listener: GET /metrics only. */
export function createMetricsServer(): Server {
  return createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, { Allow: "GET" }).end();
      return;
    }
    Promise.resolve()
      .then(() => registry.metrics())
      .then((body) => {
        if (typeof body !== "string") throw new Error("the metrics registry is not loaded");
        res.writeHead(200, { "Content-Type": PROM_CONTENT_TYPE, "Cache-Control": "no-store" }).end(body);
      })
      .catch(() => {
        res.writeHead(500).end();
      });
  });
}

/**
 * Start the listener and wait until it binds. A failed bind rejects, so
 * instrumentation register() throws and the pod does not start without its
 * metrics port.
 */
export function startMetricsServer(env: Env = process.env): Promise<Server> {
  const port = metricsPort(env);
  const server = createMetricsServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
