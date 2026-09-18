// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI
/**
 * /api/metrics is on the public allowlist, so the CIDR gate is the only
 * thing between an anonymous caller and the Prometheus registry. It must
 * judge the address our proxy wrote, not any address the caller typed into
 * X-Forwarded-For.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/auth/zitadel-bearer-verifier", () => ({
  verifyZitadelBearer: vi.fn(async () => {
    throw new Error("no bearer in these tests");
  }),
}));
vi.mock("@/src/lib/metrics/registry", () => ({
  registry: { contentType: "text/plain", metrics: async () => "up 1\n" },
}));

import { GET } from "../route";

const req = (xff: string) =>
  new NextRequest("https://app.example.test/api/metrics", {
    headers: { "x-forwarded-for": xff },
  });

describe("/api/metrics CIDR gate", () => {
  beforeEach(() => {
    process.env.DASHBOARD_METRICS_ALLOWED_CIDRS = "10.0.0.0/8";
    delete process.env.TRUSTED_PROXY_HOP_COUNT;
  });

  it("admits the scraper address the proxy wrote", async () => {
    const res = await GET(req("10.0.0.1"));
    expect(res.status).toBe(200);
  });

  // THE FIXTURE THIS EXISTS FOR.
  it("refuses an allow-listed address the caller forged to the left", async () => {
    const res = await GET(req("10.0.0.1, 203.0.113.7"));
    expect(res.status).toBe(401);
  });

  it("refuses a caller outside the list", async () => {
    expect((await GET(req("203.0.113.7"))).status).toBe(401);
  });

  it("refuses when nothing resolves", async () => {
    expect((await GET(new NextRequest("https://app.example.test/api/metrics"))).status).toBe(401);
  });
});
