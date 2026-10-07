// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The metrics-only listener of the dashboard (charts#515).
 *
 * It serves `GET /metrics` from the process-wide registry and refuses every
 * other path and method. The port carries no API, so the network policy of
 * the chart admits the cluster scraper to it and to nothing else. The API
 * port (3000) serves no metrics.
 *
 * Env:
 *   DASHBOARD_METRICS_PORT   the port to bind, default 9464.
 */

import { createServer, type Server } from "node:http";

import { registry } from "@/src/lib/metrics/registry";

export const DEFAULT_METRICS_PORT = 9464;

/** Prometheus text exposition format 0.0.4. */
const PROM_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/** The port of the listener, from DASHBOARD_METRICS_PORT or the default. */
export function metricsPort(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = env.DASHBOARD_METRICS_PORT;
  if (raw === undefined || raw === "") return DEFAULT_METRICS_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`DASHBOARD_METRICS_PORT ${JSON.stringify(raw)} is not a port`);
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
    registry.metrics().then(
      (body) => {
        res.writeHead(200, { "Content-Type": PROM_CONTENT_TYPE, "Cache-Control": "no-store" }).end(body);
      },
      () => {
        res.writeHead(500).end();
      },
    );
  });
}

/** Start the listener on the configured port. */
export function startMetricsServer(env: Readonly<Record<string, string | undefined>> = process.env): Server {
  const server = createMetricsServer();
  server.listen(metricsPort(env));
  return server;
}
