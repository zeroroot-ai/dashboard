/**
 * @vitest-environment node
 *
 * Tests for src/lib/audit/auth.ts (emitAuthAudit) and the shared helpers
 * consumed by it (truncate, redact, REDACT_KEYS from shared.ts).
 *
 * Must run under the Node environment because emitAuthAudit → getCorrelationId
 * uses AsyncLocalStorage from async_hooks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emitAuthAudit, type AuthActionName, type AuthAuditEvent } from "../auth";
import { withCorrelation } from "@/src/lib/correlation";
import { REDACT_KEYS, redact, truncate } from "../shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture the last console.info call and parse the JSON payload. */
function captureLastAuditLine(): AuthAuditEvent {
  const spy = vi.spyOn(console, "info");
  const lastCall = spy.mock.calls[spy.mock.calls.length - 1]?.[0] as string;
  spy.mockRestore();

  expect(lastCall).toMatch(/^\[audit\.auth\] \{/);
  const json = lastCall.replace(/^\[audit\.auth\] /, "");
  return JSON.parse(json) as AuthAuditEvent;
}

/** Minimal valid event payload (excludes ts / correlationId). */
function minimalEvent(
  overrides: Partial<Omit<AuthAuditEvent, "ts" | "correlationId">> = {}
): Omit<AuthAuditEvent, "ts" | "correlationId"> {
  return {
    action: "signin_succeeded",
    outcome: "ok",
    userId: "user-abc",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Shape tests
// ---------------------------------------------------------------------------

describe("emitAuthAudit — output shape", () => {
  it("emits a line prefixed with [audit.auth]", () => {
    emitAuthAudit(minimalEvent());

    expect(consoleSpy).toHaveBeenCalledOnce();
    const line = consoleSpy.mock.calls[0][0] as string;
    expect(line).toMatch(/^\[audit\.auth\] \{/);
  });

  it("emitted line contains valid JSON", () => {
    emitAuthAudit(minimalEvent());

    const line = consoleSpy.mock.calls[0][0] as string;
    const json = line.replace(/^\[audit\.auth\] /, "");
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("emitted JSON has a ts field in ISO8601 format", () => {
    emitAuthAudit(minimalEvent());

    const line = consoleSpy.mock.calls[0][0] as string;
    const payload = JSON.parse(line.replace(/^\[audit\.auth\] /, ""));
    expect(payload.ts).toBeDefined();
    expect(new Date(payload.ts).toISOString()).toBe(payload.ts);
  });

  it("emitted JSON has a correlationId field", () => {
    emitAuthAudit(minimalEvent());

    const line = consoleSpy.mock.calls[0][0] as string;
    const payload = JSON.parse(line.replace(/^\[audit\.auth\] /, ""));
    expect(payload.correlationId).toBeDefined();
    expect(typeof payload.correlationId).toBe("string");
    expect(payload.correlationId.length).toBeGreaterThan(0);
  });

  it("preserves action, outcome, userId from the input", () => {
    emitAuthAudit(
      minimalEvent({ action: "signup_failed", outcome: "failed", userId: "anon-user" })
    );

    const line = consoleSpy.mock.calls[0][0] as string;
    const payload = JSON.parse(line.replace(/^\[audit\.auth\] /, ""));
    expect(payload.action).toBe("signup_failed");
    expect(payload.outcome).toBe("failed");
    expect(payload.userId).toBe("anon-user");
  });

  it("includes optional fields when provided", () => {
    emitAuthAudit(
      minimalEvent({
        ip: "1.2.3.4",
        targetTenant: "acme",
        errorCode: "E001",
        reason: "rate exceeded",
      })
    );

    const line = consoleSpy.mock.calls[0][0] as string;
    const payload = JSON.parse(line.replace(/^\[audit\.auth\] /, ""));
    expect(payload.ip).toBe("1.2.3.4");
    expect(payload.targetTenant).toBe("acme");
    expect(payload.errorCode).toBe("E001");
    expect(payload.reason).toBe("rate exceeded");
  });
});

// ---------------------------------------------------------------------------
// Correlation tests
// ---------------------------------------------------------------------------

describe("emitAuthAudit — correlation", () => {
  it("uses correlationId from withCorrelation context when available", async () => {
    const expectedId = "test-correlation-abc";

    await withCorrelation(expectedId, () => {
      emitAuthAudit(minimalEvent());
    });

    const line = consoleSpy.mock.calls[0][0] as string;
    const payload = JSON.parse(line.replace(/^\[audit\.auth\] /, ""));
    expect(payload.correlationId).toBe(expectedId);
  });

  it("falls back to a fresh UUID when outside any correlation context", () => {
    emitAuthAudit(minimalEvent());

    const line = consoleSpy.mock.calls[0][0] as string;
    const payload = JSON.parse(line.replace(/^\[audit\.auth\] /, ""));
    // Outside context, getCorrelationId() returns a fresh UUID v4.
    expect(payload.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("different withCorrelation ids produce different correlationId in output", async () => {
    const ids: string[] = [];

    await withCorrelation("first-id", () => {
      emitAuthAudit(minimalEvent());
      const line = consoleSpy.mock.calls[0][0] as string;
      ids.push(JSON.parse(line.replace(/^\[audit\.auth\] /, "")).correlationId);
    });

    await withCorrelation("second-id", () => {
      emitAuthAudit(minimalEvent());
      const line = consoleSpy.mock.calls[1][0] as string;
      ids.push(JSON.parse(line.replace(/^\[audit\.auth\] /, "")).correlationId);
    });

    expect(ids[0]).toBe("first-id");
    expect(ids[1]).toBe("second-id");
    expect(ids[0]).not.toBe(ids[1]);
  });
});

// ---------------------------------------------------------------------------
// Truncation tests
// ---------------------------------------------------------------------------

describe("emitAuthAudit — field truncation", () => {
  it("truncates userAgent at 256 characters", () => {
    const long = "U".repeat(300);
    emitAuthAudit(minimalEvent({ userAgent: long }));

    const line = consoleSpy.mock.calls[0][0] as string;
    const payload = JSON.parse(line.replace(/^\[audit\.auth\] /, ""));
    // 256 chars + "...[truncated]" = 270 chars
    expect(payload.userAgent).toHaveLength(256 + "...[truncated]".length);
    expect(payload.userAgent).toMatch(/\.\.\.\[truncated\]$/);
  });

  it("does not truncate userAgent that fits within 256 characters", () => {
    const ua = "Mozilla/5.0";
    emitAuthAudit(minimalEvent({ userAgent: ua }));

    const line = consoleSpy.mock.calls[0][0] as string;
    const payload = JSON.parse(line.replace(/^\[audit\.auth\] /, ""));
    expect(payload.userAgent).toBe(ua);
  });

  it("truncates errorMessage at 512 characters", () => {
    const long = "E".repeat(600);
    emitAuthAudit(minimalEvent({ errorMessage: long }));

    const line = consoleSpy.mock.calls[0][0] as string;
    const payload = JSON.parse(line.replace(/^\[audit\.auth\] /, ""));
    expect(payload.errorMessage).toHaveLength(512 + "...[truncated]".length);
    expect(payload.errorMessage).toMatch(/\.\.\.\[truncated\]$/);
  });
});

// ---------------------------------------------------------------------------
// Redaction tests — fuzz each REDACT_KEY at multiple nesting levels
// ---------------------------------------------------------------------------

describe("emitAuthAudit — redaction via shared.redact()", () => {
  it("never logs the raw value of any REDACT_KEY at the top level", () => {
    const sensitiveValue = "super-secret-value-12345";

    for (const key of REDACT_KEYS) {
      consoleSpy.mockClear();

      // Inject sensitive key into a field that accepts an object (reason is
      // a string field, so we test via a custom property on an extended event
      // — we cast to bypass the type system for the fuzz scenario).
      const event = {
        ...minimalEvent(),
        [key]: sensitiveValue,
      } as unknown as Omit<AuthAuditEvent, "ts" | "correlationId">;

      emitAuthAudit(event);

      const line = consoleSpy.mock.calls[0]?.[0] as string;
      expect(line, `key "${key}" leaked in output`).not.toContain(sensitiveValue);
    }
  });
});

describe("redact() utility — nesting levels", () => {
  const sensitiveValue = "hunter2";

  it("redacts at depth 0 (flat object)", () => {
    for (const key of REDACT_KEYS) {
      const result = redact({ [key]: sensitiveValue }) as Record<string, unknown>;
      expect(result[key]).toBe("[REDACTED]");
    }
  });

  it("redacts at depth 1 (nested object)", () => {
    for (const key of REDACT_KEYS) {
      const result = redact({ outer: { [key]: sensitiveValue } }) as {
        outer: Record<string, unknown>;
      };
      expect(result.outer[key]).toBe("[REDACTED]");
    }
  });

  it("redacts at depth 2 (doubly nested object)", () => {
    for (const key of REDACT_KEYS) {
      const result = redact({ a: { b: { [key]: sensitiveValue } } }) as {
        a: { b: Record<string, unknown> };
      };
      expect(result.a.b[key]).toBe("[REDACTED]");
    }
  });

  it("redacts inside arrays", () => {
    for (const key of REDACT_KEYS) {
      const result = redact([{ [key]: sensitiveValue }]) as Array<Record<string, unknown>>;
      expect(result[0][key]).toBe("[REDACTED]");
    }
  });

  it("does NOT redact safe keys", () => {
    const result = redact({ action: "signin_succeeded", userId: "user-1" }) as Record<
      string,
      unknown
    >;
    expect(result.action).toBe("signin_succeeded");
    expect(result.userId).toBe("user-1");
  });

  it("does not mutate the original object", () => {
    const original = { password: "secret", userId: "user-1" };
    redact(original);
    expect(original.password).toBe("secret");
  });
});

// ---------------------------------------------------------------------------
// AuthActionName exhaustiveness check
// ---------------------------------------------------------------------------

describe("AuthActionName union", () => {
  const ALL_ACTIONS: AuthActionName[] = [
    "signup_started",
    "signup_completed",
    "signup_failed",
    "signin_succeeded",
    "signin_failed",
    "account_locked",
    "password_reset_requested",
    "password_reset_completed",
    "email_verification_requested",
    "email_verification_completed",
    "claim_completed",
    "session_revoked",
    "membership_added",
    "membership_removed",
    "org_created",
    "org_deleted",
    "hibp_unavailable",
    "captcha_failed",
    "billing_rollback",
  ];

  it("emits successfully for every defined AuthActionName", () => {
    for (const action of ALL_ACTIONS) {
      consoleSpy.mockClear();
      emitAuthAudit(minimalEvent({ action }));
      expect(consoleSpy).toHaveBeenCalledOnce();
    }
  });
});

// ---------------------------------------------------------------------------
// truncate() helper unit tests (from shared.ts)
// ---------------------------------------------------------------------------

describe("truncate() helper", () => {
  it("returns undefined for undefined input", () => {
    expect(truncate(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(truncate("")).toBeUndefined();
  });

  it("returns string unchanged when within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates and appends marker when over limit", () => {
    const result = truncate("abcdefghij", 5);
    expect(result).toBe("abcde...[truncated]");
  });

  it("uses 512 as the default max", () => {
    const exact = "x".repeat(512);
    expect(truncate(exact)).toBe(exact);
    const over = "x".repeat(513);
    expect(truncate(over)).toMatch(/\.\.\.\[truncated\]$/);
  });
});
