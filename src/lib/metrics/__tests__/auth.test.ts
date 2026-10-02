// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { beforeEach, describe, expect, it } from "vitest";

import {
  hibpChecks,
  incrementLoginError,
  observeSignin,
  recordActiveTenantValidation,
  recordMembershipResolution,
  recordSignup,
  recordWorkloadSvidFallback,
} from "../auth";
import { registry } from "../registry";

/**
 * prom-client counters are additive process globals; tests are not isolated
 * by default. Every metric is reset before each test so labeled increments
 * assert against a known baseline.
 */
beforeEach(() => {
  registry.resetMetrics();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Row = { metricName?: string; labels?: Record<string, string>; value: number };

/**
 * Read the numeric value of a single (metric name, labels) combination from
 * the registry's JSON dump. Returns 0 when the combination has not been
 * observed. prom-client omits zero-valued series from `getMetricsAsJSON`
 * for counters, so missing rows are equivalent to a zero count.
 */
async function readCounter(name: string, labels: Record<string, string>): Promise<number> {
  const all = await registry.getMetricsAsJSON();
  const metric = all.find((m) => m.name === name);
  if (!metric || !("values" in metric)) return 0;
  const match = (metric.values as Row[]).find((v) => {
    const vl = v.labels ?? {};
    const keys = Object.keys(labels);
    if (keys.length !== Object.keys(vl).length) return false;
    return keys.every((k) => vl[k] === labels[k]);
  });
  return match ? match.value : 0;
}

/** Read the `_count` series of a histogram for one label set. */
async function readHistogramCount(name: string, labels: Record<string, string>): Promise<number> {
  const all = await registry.getMetricsAsJSON();
  const hist = all.find((m) => m.name === name);
  if (!hist || !("values" in hist)) return 0;
  const row = (hist.values as Row[]).find(
    (v) =>
      v.metricName === `${name}_count` &&
      Object.entries(labels).every(([k, val]) => v.labels?.[k] === val),
  );
  return row?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Each producer helper moves exactly the series it names
// ---------------------------------------------------------------------------

describe("auth metric producers", () => {
  it("recordSignup routes to the labeled series only", async () => {
    recordSignup("ok");
    recordSignup("failed", "TOS_MISSING");
    recordSignup("failed", "TOS_MISSING");
    recordSignup("rate_limited", "RATE_LIMITED");

    expect(await readCounter("dashboard_auth_signup_attempts_total", { outcome: "ok", reason: "" })).toBe(1);
    expect(
      await readCounter("dashboard_auth_signup_attempts_total", { outcome: "failed", reason: "TOS_MISSING" }),
    ).toBe(2);
    expect(
      await readCounter("dashboard_auth_signup_attempts_total", { outcome: "rate_limited", reason: "RATE_LIMITED" }),
    ).toBe(1);
    expect(
      await readCounter("dashboard_auth_signup_attempts_total", { outcome: "failed", reason: "INTERNAL_ERROR" }),
    ).toBe(0);
  });

  it("hibpChecks routes to the labeled series only", async () => {
    hibpChecks.inc({ outcome: "clean" });
    hibpChecks.inc({ outcome: "unknown" });
    hibpChecks.inc({ outcome: "unknown" });

    expect(await readCounter("dashboard_auth_hibp_checks_total", { outcome: "clean" })).toBe(1);
    expect(await readCounter("dashboard_auth_hibp_checks_total", { outcome: "breached" })).toBe(0);
    expect(await readCounter("dashboard_auth_hibp_checks_total", { outcome: "unknown" })).toBe(2);
  });

  it("recordMembershipResolution moves the counter and the histogram together", async () => {
    recordMembershipResolution("ok", 0.07);
    recordMembershipResolution("ok", 0.2);
    recordMembershipResolution("fga_unavailable", 4.9);

    expect(await readCounter("dashboard_membership_resolution_total", { outcome: "ok" })).toBe(2);
    expect(await readCounter("dashboard_membership_resolution_total", { outcome: "fga_unavailable" })).toBe(1);
    expect(await readCounter("dashboard_membership_resolution_total", { outcome: "daemon_unavailable" })).toBe(0);
    expect(
      await readHistogramCount("dashboard_membership_resolution_duration_seconds", { outcome: "ok" }),
    ).toBe(2);
    expect(
      await readHistogramCount("dashboard_membership_resolution_duration_seconds", { outcome: "fga_unavailable" }),
    ).toBe(1);
  });

  it("recordActiveTenantValidation routes to the labeled series only", async () => {
    recordActiveTenantValidation("ok");
    recordActiveTenantValidation("stale");
    recordActiveTenantValidation("stale");

    expect(await readCounter("dashboard_active_tenant_validation_total", { outcome: "ok" })).toBe(1);
    expect(await readCounter("dashboard_active_tenant_validation_total", { outcome: "stale" })).toBe(2);
    expect(await readCounter("dashboard_active_tenant_validation_total", { outcome: "absent" })).toBe(0);
  });

  it("recordWorkloadSvidFallback bumps the single unlabeled series", async () => {
    recordWorkloadSvidFallback();
    recordWorkloadSvidFallback();
    expect(await readCounter("dashboard_workload_svid_fallback_total", {})).toBe(2);
  });

  it("observeSignin moves the counter and the histogram together", async () => {
    observeSignin("success", 0.3);
    observeSignin("error", 1.2, "daemon_unavailable");

    expect(await readCounter("dashboard_signin_total", { outcome: "success", error_reason: "_n/a" })).toBe(1);
    expect(
      await readCounter("dashboard_signin_total", { outcome: "error", error_reason: "daemon_unavailable" }),
    ).toBe(1);
    expect(await readHistogramCount("dashboard_signin_duration_seconds", { outcome: "success" })).toBe(1);
    expect(await readHistogramCount("dashboard_signin_duration_seconds", { outcome: "error" })).toBe(1);
  });

  it("incrementLoginError routes to the labeled series only", async () => {
    incrementLoginError("session_invalid");
    incrementLoginError("session_invalid");
    expect(await readCounter("dashboard_login_error_total", { reason: "session_invalid" })).toBe(2);
    expect(await readCounter("dashboard_login_error_total", { reason: "permission_denied" })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Registry exposes every series in Prometheus text format
// ---------------------------------------------------------------------------

describe("registry /metrics text format", () => {
  it("exposes every auth series via registry.metrics()", async () => {
    recordSignup("ok");
    hibpChecks.inc({ outcome: "unknown" });
    recordMembershipResolution("ok", 0.1);
    recordActiveTenantValidation("ok");
    recordWorkloadSvidFallback();
    observeSignin("success", 0.1);
    incrementLoginError("session_invalid");

    const text = await registry.metrics();
    for (const name of [
      "dashboard_auth_signup_attempts_total",
      "dashboard_auth_hibp_checks_total",
      "dashboard_membership_resolution_total",
      "dashboard_membership_resolution_duration_seconds",
      "dashboard_active_tenant_validation_total",
      "dashboard_workload_svid_fallback_total",
      "dashboard_signin_total",
      "dashboard_signin_duration_seconds",
      "dashboard_login_error_total",
    ]) {
      expect(text).toContain(`# HELP ${name}`);
    }
    expect(text).toContain("# TYPE dashboard_auth_signup_attempts_total counter");
    expect(text).toContain("# TYPE dashboard_signin_duration_seconds histogram");
  });
});
