// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/metrics/registry", () => ({
  registry: { metrics: async () => "dashboard_signin_total 1\n" },
}));

import { createMetricsServer, DEFAULT_METRICS_PORT, metricsPort } from "@/src/lib/metrics/server";

const servers: import("node:http").Server[] = [];

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
  it("serves GET /metrics from the registry", async () => {
    const res = await fetch(`${await base()}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("version=0.0.4");
    expect(await res.text()).toContain("dashboard_signin_total 1");
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
    expect(() => metricsPort({ DASHBOARD_METRICS_PORT: "x" })).toThrow();
    expect(() => metricsPort({ DASHBOARD_METRICS_PORT: "70000" })).toThrow();
  });
});
