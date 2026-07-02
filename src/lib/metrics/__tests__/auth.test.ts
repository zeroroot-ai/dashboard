import { beforeEach, describe, expect, it } from "vitest";

import {
  accountLockouts,
  captchaFailures,
  emailVerifications,
  hibpChecks,
  passwordResets,
  provisioningDuration,
  signinAttempts,
  signupAttempts,
} from "../auth";
import { registry } from "../registry";

/**
 * prom-client counters are additive process globals; tests are not isolated
 * by default. We reset every counter/histogram before each test so labelled
 * increments assert against a known baseline.
 */
beforeEach(() => {
  signupAttempts.reset();
  signinAttempts.reset();
  accountLockouts.reset();
  passwordResets.reset();
  emailVerifications.reset();
  captchaFailures.reset();
  hibpChecks.reset();
  provisioningDuration.reset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the numeric value of a single (metric name, labels) combination from
 * the registry's JSON dump. Returns 0 when the combination has not been
 * observed, prom-client omits zero-valued series from `getMetricsAsJSON`
 * for counters, so missing rows are equivalent to a zero count.
 */
async function readCounter(
  name: string,
  labels: Record<string, string>,
): Promise<number> {
  const all = await registry.getMetricsAsJSON();
  const metric = all.find((m) => m.name === name);
  if (!metric || !("values" in metric)) return 0;
  const match = metric.values.find((v) => {
    const vl = v.labels ?? {};
    const keys = Object.keys(labels);
    if (keys.length !== Object.keys(vl).length) return false;
    return keys.every((k) => vl[k] === labels[k]);
  });
  return match ? match.value : 0;
}

// ---------------------------------------------------------------------------
// Counters: assert `.inc()` increments the expected label combination only
// ---------------------------------------------------------------------------

describe("auth counters, label routing", () => {
  it("signupAttempts{outcome,reason}: inc routes only to the labelled series", async () => {
    signupAttempts.inc({ outcome: "ok", reason: "" });
    signupAttempts.inc({ outcome: "failed", reason: "password_policy" });
    signupAttempts.inc({ outcome: "failed", reason: "password_policy" });
    signupAttempts.inc({ outcome: "rate_limited", reason: "ip_throttle" });

    expect(
      await readCounter("dashboard_auth_signup_attempts_total", {
        outcome: "ok",
        reason: "",
      }),
    ).toBe(1);
    expect(
      await readCounter("dashboard_auth_signup_attempts_total", {
        outcome: "failed",
        reason: "password_policy",
      }),
    ).toBe(2);
    expect(
      await readCounter("dashboard_auth_signup_attempts_total", {
        outcome: "rate_limited",
        reason: "ip_throttle",
      }),
    ).toBe(1);
    // Different reason under same outcome must not be bumped.
    expect(
      await readCounter("dashboard_auth_signup_attempts_total", {
        outcome: "failed",
        reason: "slug_owned_by_other",
      }),
    ).toBe(0);
  });

  it("signinAttempts{outcome,reason}: inc routes only to the labelled series", async () => {
    signinAttempts.inc({ outcome: "ok", reason: "" });
    signinAttempts.inc({ outcome: "failed", reason: "invalid_credentials" });
    signinAttempts.inc({ outcome: "locked", reason: "account_locked" });

    expect(
      await readCounter("dashboard_auth_signin_attempts_total", {
        outcome: "ok",
        reason: "",
      }),
    ).toBe(1);
    expect(
      await readCounter("dashboard_auth_signin_attempts_total", {
        outcome: "failed",
        reason: "invalid_credentials",
      }),
    ).toBe(1);
    expect(
      await readCounter("dashboard_auth_signin_attempts_total", {
        outcome: "locked",
        reason: "account_locked",
      }),
    ).toBe(1);
  });

  it("accountLockouts: no labels; inc bumps the single series", async () => {
    accountLockouts.inc();
    accountLockouts.inc();
    accountLockouts.inc();
    expect(
      await readCounter("dashboard_auth_account_lockouts_total", {}),
    ).toBe(3);
  });

  it("passwordResets{outcome}: inc routes only to the labelled series", async () => {
    passwordResets.inc({ outcome: "ok" });
    passwordResets.inc({ outcome: "ok" });
    passwordResets.inc({ outcome: "failed" });

    expect(
      await readCounter("dashboard_auth_password_resets_total", {
        outcome: "ok",
      }),
    ).toBe(2);
    expect(
      await readCounter("dashboard_auth_password_resets_total", {
        outcome: "failed",
      }),
    ).toBe(1);
    expect(
      await readCounter("dashboard_auth_password_resets_total", {
        outcome: "rate_limited",
      }),
    ).toBe(0);
  });

  it("emailVerifications{outcome}: inc routes only to the labelled series", async () => {
    emailVerifications.inc({ outcome: "ok" });
    emailVerifications.inc({ outcome: "failed" });
    expect(
      await readCounter("dashboard_auth_email_verifications_total", {
        outcome: "ok",
      }),
    ).toBe(1);
    expect(
      await readCounter("dashboard_auth_email_verifications_total", {
        outcome: "failed",
      }),
    ).toBe(1);
  });

  it("captchaFailures{provider}: inc routes only to the labelled series", async () => {
    captchaFailures.inc({ provider: "turnstile" });
    captchaFailures.inc({ provider: "turnstile" });
    captchaFailures.inc({ provider: "hcaptcha" });

    expect(
      await readCounter("dashboard_auth_captcha_failures_total", {
        provider: "turnstile",
      }),
    ).toBe(2);
    expect(
      await readCounter("dashboard_auth_captcha_failures_total", {
        provider: "hcaptcha",
      }),
    ).toBe(1);
    expect(
      await readCounter("dashboard_auth_captcha_failures_total", {
        provider: "disabled",
      }),
    ).toBe(0);
  });

  it("hibpChecks{outcome}: inc routes only to the labelled series", async () => {
    hibpChecks.inc({ outcome: "clean" });
    hibpChecks.inc({ outcome: "breached" });
    hibpChecks.inc({ outcome: "unknown" });
    hibpChecks.inc({ outcome: "unknown" });

    expect(
      await readCounter("dashboard_auth_hibp_checks_total", {
        outcome: "clean",
      }),
    ).toBe(1);
    expect(
      await readCounter("dashboard_auth_hibp_checks_total", {
        outcome: "breached",
      }),
    ).toBe(1);
    expect(
      await readCounter("dashboard_auth_hibp_checks_total", {
        outcome: "unknown",
      }),
    ).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Histogram: buckets + observation routing
// ---------------------------------------------------------------------------

describe("provisioningDuration histogram", () => {
  it("declares buckets sized 100ms -> 60s", () => {
    // prom-client exposes the configured buckets on the internal instance.
    // Accessing `.buckets` via bracket indexing keeps this test honest if
    // the lib ever renames the field.
    const buckets = (provisioningDuration as unknown as { buckets: number[] })
      .buckets;
    expect(buckets[0]).toBe(0.1);
    expect(buckets[buckets.length - 1]).toBe(60);
    // Monotonically increasing.
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i]).toBeGreaterThan(buckets[i - 1]!);
    }
  });

  it("observe() records a sample under the label set", async () => {
    provisioningDuration.observe(
      { operation: "create_org", outcome: "ok" },
      0.42,
    );
    provisioningDuration.observe(
      { operation: "create_org", outcome: "ok" },
      1.5,
    );

    const dump = await registry.getMetricsAsJSON();
    const hist = dump.find(
      (m) => m.name === "dashboard_auth_provisioning_duration_seconds",
    );
    expect(hist).toBeTruthy();
    // Find the `_count` series for this label combination.
    const countRow = (hist!.values as Array<{
      metricName?: string;
      labels?: Record<string, string>;
      value: number;
    }>).find(
      (v) =>
        v.metricName ===
          "dashboard_auth_provisioning_duration_seconds_count" &&
        v.labels?.operation === "create_org" &&
        v.labels?.outcome === "ok",
    );
    expect(countRow?.value).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Registry exposes Prometheus text-format metrics via register.metrics()
// ---------------------------------------------------------------------------

describe("registry /metrics text format", () => {
  it("exposes every registered counter+histogram via registry.metrics()", async () => {
    // Seed one observation per metric so the text output includes them.
    signupAttempts.inc({ outcome: "ok", reason: "" });
    signinAttempts.inc({ outcome: "failed", reason: "invalid_credentials" });
    accountLockouts.inc();
    passwordResets.inc({ outcome: "ok" });
    emailVerifications.inc({ outcome: "ok" });
    captchaFailures.inc({ provider: "turnstile" });
    hibpChecks.inc({ outcome: "unknown" });
    provisioningDuration.observe(
      { operation: "create_org", outcome: "ok" },
      0.1,
    );

    const text = await registry.metrics();
    // Exposition format includes `# HELP` and `# TYPE` lines.
    expect(text).toContain("# HELP dashboard_auth_signup_attempts_total");
    expect(text).toContain("# TYPE dashboard_auth_signup_attempts_total counter");
    expect(text).toContain("dashboard_auth_signin_attempts_total");
    expect(text).toContain("dashboard_auth_account_lockouts_total");
    expect(text).toContain("dashboard_auth_password_resets_total");
    expect(text).toContain("dashboard_auth_email_verifications_total");
    expect(text).toContain("dashboard_auth_captcha_failures_total");
    expect(text).toContain("dashboard_auth_hibp_checks_total");
    expect(text).toContain("dashboard_auth_provisioning_duration_seconds");
    expect(text).toContain(
      "# TYPE dashboard_auth_provisioning_duration_seconds histogram",
    );
  });

  it("returns a non-empty string for registry.metrics()", async () => {
    const text = await registry.metrics();
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});
