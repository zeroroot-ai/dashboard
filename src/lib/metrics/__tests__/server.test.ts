// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMetricsServer,
  DEFAULT_METRICS_PORT,
  metricsPort,
  startMetricsServer,
} from "@/src/lib/metrics/server";

const servers: Server[] = [];

async function base(): Promise<string> {
  const s = createMetricsServer();
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe("metrics-only listener (charts#515)", () => {
  it("serves the real dashboard series from boot, before any request uses them", async () => {
    const res = await fetch(`${await base()}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("version=0.0.4");
    const body = await res.text();
    // Series that the alert rules of the chart read.
    expect(body).toContain("dashboard_signin_total");
    expect(body).toContain("dashboard_workload_svid_fallback_total");
  });

  it("refuses every other path, so the port carries no API", async () => {
    const url = await base();
    for (const path of ["/", "/api/health", "/login", "/metrics/x"]) {
      expect((await fetch(`${url}${path}`)).status, path).toBe(404);
    }
  });

  it("refuses a method other than GET", async () => {
    expect((await fetch(`${await base()}/metrics`, { method: "POST" })).status).toBe(405);
  });

  it("reads the port from DASHBOARD_METRICS_PORT and refuses a bad one", () => {
    expect(metricsPort({})).toBe(DEFAULT_METRICS_PORT);
    expect(metricsPort({ DASHBOARD_METRICS_PORT: "9500" })).toBe(9500);
    for (const bad of ["x", "70000", "9464.0", " 9464", "0"]) {
      expect(() => metricsPort({ DASHBOARD_METRICS_PORT: bad }), bad).toThrow();
    }
  });

  it("refuses the API port as the metrics port", () => {
    expect(() => metricsPort({ DASHBOARD_METRICS_PORT: "3000", PORT: "3000" })).toThrow(/API port/);
    expect(() => metricsPort({ PORT: String(DEFAULT_METRICS_PORT) })).toThrow(/API port/);
  });

  it("rejects when the port is already bound, so the pod does not start without it", async () => {
    const holder = createServer();
    servers.push(holder);
    await new Promise<void>((r) => holder.listen(0, r));
    const taken = (holder.address() as AddressInfo).port;
    await expect(startMetricsServer({ DASHBOARD_METRICS_PORT: String(taken) })).rejects.toThrow(/EADDRINUSE/);
  });

  it("resolves once it binds", async () => {
    const s = await startMetricsServer({ DASHBOARD_METRICS_PORT: String(await freePort()) });
    servers.push(s);
    expect(s.listening).toBe(true);
  });
});

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, r));
  const port = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
}
