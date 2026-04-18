/**
 * Unit tests for forgotPasswordAction.
 *
 * Verifies:
 *   1. Always returns the generic success message regardless of whether the
 *      email matches any account (enumeration resistance).
 *   2. Per-IP rate limit enforced (5/hr); still returns generic success.
 *   3. Per-account (email-keyed) rate limit enforced (3/hr); still returns generic success.
 *   4. `password_reset_requested` audit emitted on every terminal path.
 *   5. `passwordResets` metric incremented on every terminal path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before imports (vi.mock is hoisted)
// ---------------------------------------------------------------------------

// Mock next/headers so the action can import without Next.js runtime.
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));

// Mock Better Auth — we never actually call the DB in unit tests.
vi.mock("@/src/lib/auth-server", () => ({
  auth: {
    api: {
      requestPasswordReset: vi.fn(),
    },
  },
}));

vi.mock("@/src/lib/audit/auth", () => ({
  emitAuthAudit: vi.fn(),
}));

vi.mock("@/src/lib/metrics/auth", () => ({
  passwordResets: { inc: vi.fn() },
  captchaFailures: { inc: vi.fn() },
}));

// CAPTCHA verifier — default ok:true so existing tests see the disabled-mode
// behaviour (no enforcement). Individual tests override to simulate failure.
vi.mock("@/src/lib/auth/captcha", () => ({
  verifyCaptcha: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/src/lib/debug", () => ({
  recordDebugError: vi.fn(),
  isDebug: false,
}));

// Mock checkRateLimit + checkRateLimitByKey with controllable returns.
const mockCheckRateLimit = vi.fn();
const mockCheckRateLimitByKey = vi.fn();

vi.mock("@/src/lib/rate-limiter", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  checkRateLimitByKey: (...args: unknown[]) => mockCheckRateLimitByKey(...args),
  getClientIP: vi.fn(() => "10.0.0.1"),
}));

// ---------------------------------------------------------------------------
// SUT + mock imports (after mock declarations)
// ---------------------------------------------------------------------------

import { forgotPasswordAction } from "../forgot-password";
import { auth } from "@/src/lib/auth-server";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { passwordResets, captchaFailures } from "@/src/lib/metrics/auth";
import { verifyCaptcha } from "@/src/lib/auth/captcha";

const mockRequestPasswordReset = (
  auth.api.requestPasswordReset as unknown as ReturnType<typeof vi.fn>
);
const mockEmitAuthAudit = emitAuthAudit as unknown as ReturnType<typeof vi.fn>;
const mockPasswordResetsInc = (
  passwordResets as unknown as { inc: ReturnType<typeof vi.fn> }
).inc;
const mockCaptchaFailuresInc = (
  captchaFailures as unknown as { inc: ReturnType<typeof vi.fn> }
).inc;
const mockVerifyCaptcha = verifyCaptcha as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALLOWED: import("@/src/lib/rate-limiter").RateLimitResult = {
  allowed: true,
  current: 1,
  limit: 5,
  remaining: 4,
  resetIn: 3600,
  resetAt: Math.ceil((Date.now() + 3600_000) / 1000),
};

const DENIED: import("@/src/lib/rate-limiter").RateLimitResult = {
  allowed: false,
  current: 6,
  limit: 5,
  remaining: 0,
  resetIn: 3000,
  resetAt: Math.ceil((Date.now() + 3_000_000) / 1000),
};

const GENERIC_MESSAGE =
  "If an account exists for that email, a reset link has been sent.";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: both rate limits allow the request.
  mockCheckRateLimit.mockResolvedValue(ALLOWED);
  mockCheckRateLimitByKey.mockResolvedValue(ALLOWED);
  mockRequestPasswordReset.mockResolvedValue({ status: true });
  mockVerifyCaptcha.mockResolvedValue({ ok: true });
});

describe("forgotPasswordAction", () => {
  describe("enumeration resistance", () => {
    it("returns the generic success message when the email matches", async () => {
      const result = await forgotPasswordAction("alice@example.com");
      expect(result.ok).toBe(true);
      expect(result.message).toBe(GENERIC_MESSAGE);
    });

    it("returns the same generic success message when Better Auth throws (email not found)", async () => {
      // Better Auth surfaces nothing to the caller when a non-existent email
      // is requested — but even if it throws, we swallow it and return the
      // same shape.
      mockRequestPasswordReset.mockRejectedValueOnce(
        new Error("User not found"),
      );
      const result = await forgotPasswordAction("nobody@example.com");
      expect(result.ok).toBe(true);
      expect(result.message).toBe(GENERIC_MESSAGE);
    });

    it("response shape is identical for match and non-match paths", async () => {
      mockRequestPasswordReset.mockResolvedValueOnce({ status: true });
      const matchResult = await forgotPasswordAction("real@example.com");

      mockRequestPasswordReset.mockRejectedValueOnce(new Error("not found"));
      const noMatchResult = await forgotPasswordAction("ghost@example.com");

      expect(matchResult).toEqual(noMatchResult);
    });
  });

  describe("rate limiting — IP", () => {
    it("returns generic success (not an error) when the IP rate limit fires", async () => {
      mockCheckRateLimit.mockResolvedValueOnce(DENIED);
      const result = await forgotPasswordAction("alice@example.com");
      expect(result.ok).toBe(true);
      expect(result.message).toBe(GENERIC_MESSAGE);
    });

    it("does NOT call requestPasswordReset when the IP rate limit fires", async () => {
      mockCheckRateLimit.mockResolvedValueOnce(DENIED);
      await forgotPasswordAction("alice@example.com");
      expect(mockRequestPasswordReset).not.toHaveBeenCalled();
    });

    it("emits audit with outcome rate_limited when IP rate limit fires", async () => {
      mockCheckRateLimit.mockResolvedValueOnce(DENIED);
      await forgotPasswordAction("alice@example.com");
      expect(mockEmitAuthAudit).toHaveBeenCalledOnce();
      const call = mockEmitAuthAudit.mock.calls[0][0];
      expect(call.action).toBe("password_reset_requested");
      expect(call.outcome).toBe("rate_limited");
    });

    it("increments passwordResets metric with outcome rate_limited", async () => {
      mockCheckRateLimit.mockResolvedValueOnce(DENIED);
      await forgotPasswordAction("alice@example.com");
      expect(mockPasswordResetsInc).toHaveBeenCalledWith({ outcome: "rate_limited" });
    });
  });

  describe("rate limiting — account (email-keyed)", () => {
    it("returns generic success when the account rate limit fires", async () => {
      mockCheckRateLimitByKey.mockResolvedValueOnce(DENIED);
      const result = await forgotPasswordAction("alice@example.com");
      expect(result.ok).toBe(true);
      expect(result.message).toBe(GENERIC_MESSAGE);
    });

    it("does NOT call requestPasswordReset when the account rate limit fires", async () => {
      mockCheckRateLimitByKey.mockResolvedValueOnce(DENIED);
      await forgotPasswordAction("alice@example.com");
      expect(mockRequestPasswordReset).not.toHaveBeenCalled();
    });

    it("emits audit with outcome rate_limited when account rate limit fires", async () => {
      mockCheckRateLimitByKey.mockResolvedValueOnce(DENIED);
      await forgotPasswordAction("alice@example.com");
      const call = mockEmitAuthAudit.mock.calls[0][0];
      expect(call.action).toBe("password_reset_requested");
      expect(call.outcome).toBe("rate_limited");
    });
  });

  describe("audit emission", () => {
    it("emits password_reset_requested audit on successful Better Auth call", async () => {
      await forgotPasswordAction("alice@example.com");
      expect(mockEmitAuthAudit).toHaveBeenCalledOnce();
      const call = mockEmitAuthAudit.mock.calls[0][0];
      expect(call.action).toBe("password_reset_requested");
      expect(call.outcome).toBe("ok");
    });

    it("emits password_reset_requested audit even when Better Auth throws", async () => {
      mockRequestPasswordReset.mockRejectedValueOnce(new Error("db error"));
      await forgotPasswordAction("alice@example.com");
      expect(mockEmitAuthAudit).toHaveBeenCalledOnce();
      const call = mockEmitAuthAudit.mock.calls[0][0];
      expect(call.action).toBe("password_reset_requested");
      expect(call.outcome).toBe("failed");
    });
  });

  describe("metrics", () => {
    it("increments passwordResets with ok on successful call", async () => {
      await forgotPasswordAction("alice@example.com");
      expect(mockPasswordResetsInc).toHaveBeenCalledWith({ outcome: "ok" });
    });

    it("increments passwordResets with failed when Better Auth throws", async () => {
      mockRequestPasswordReset.mockRejectedValueOnce(new Error("oops"));
      await forgotPasswordAction("alice@example.com");
      expect(mockPasswordResetsInc).toHaveBeenCalledWith({ outcome: "failed" });
    });
  });

  describe("CAPTCHA enforcement (Task 31)", () => {
    it("returns generic success when the captcha fails (enumeration resistance)", async () => {
      mockVerifyCaptcha.mockResolvedValueOnce({
        ok: false,
        reason: "invalid-input-response",
      });
      const result = await forgotPasswordAction({
        email: "alice@example.com",
        captchaToken: "bad-token",
      });
      expect(result.ok).toBe(true);
      expect(result.message).toBe(GENERIC_MESSAGE);
    });

    it("does NOT call requestPasswordReset when the captcha fails", async () => {
      mockVerifyCaptcha.mockResolvedValueOnce({ ok: false, reason: "x" });
      await forgotPasswordAction({
        email: "alice@example.com",
        captchaToken: "bad-token",
      });
      expect(mockRequestPasswordReset).not.toHaveBeenCalled();
    });

    it("emits captcha_failed audit and increments captchaFailures", async () => {
      mockVerifyCaptcha.mockResolvedValueOnce({ ok: false, reason: "x" });
      await forgotPasswordAction({
        email: "alice@example.com",
        captchaToken: "bad-token",
      });

      const captchaAudits = mockEmitAuthAudit.mock.calls
        .map((c: unknown[]) => c[0] as Record<string, unknown>)
        .filter((e) => e.action === "captcha_failed");
      expect(captchaAudits.length).toBe(1);
      expect(captchaAudits[0]?.outcome).toBe("failed");
      expect(captchaAudits[0]?.reason).toBe("forgot_password");

      expect(mockCaptchaFailuresInc).toHaveBeenCalledOnce();
      expect(mockCaptchaFailuresInc).toHaveBeenCalledWith(
        expect.objectContaining({ provider: expect.any(String) }),
      );
    });

    it("passing no captcha token still succeeds in disabled-provider mode", async () => {
      // verifyCaptcha returns ok:true for empty token in disabled mode — this
      // is the default mock, simulating the local-dev flow.
      const result = await forgotPasswordAction("alice@example.com");
      expect(result.ok).toBe(true);
      expect(result.message).toBe(GENERIC_MESSAGE);
      expect(mockCaptchaFailuresInc).not.toHaveBeenCalled();
    });
  });
});
