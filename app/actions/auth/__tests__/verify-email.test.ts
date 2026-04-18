/**
 * Unit tests for verifyEmailAction.
 *
 * Verifies:
 *   1. Happy path — valid token → { ok: true }, audit emitted, counter incremented.
 *   2. Invalid token — Better Auth throws a non-expired error → { ok: false, code: 'TOKEN_INVALID' }.
 *   3. Expired token — Better Auth throws an "expired" error → { ok: false, code: 'TOKEN_EXPIRED' }.
 *   4. Empty / missing token → { ok: false, code: 'TOKEN_INVALID' } without calling auth.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — vi.mock is hoisted; factories must NOT reference outer variables
// (TDZ). Use vi.fn() inline in the factory; obtain references via imports.
// ---------------------------------------------------------------------------

vi.mock("@/src/lib/auth-server", () => ({
  auth: {
    api: {
      verifyEmail: vi.fn(),
    },
  },
}));

vi.mock("@/src/lib/audit/auth", () => ({
  emitAuthAudit: vi.fn(),
}));

vi.mock("@/src/lib/metrics/auth", () => ({
  emailVerifications: { inc: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks.
// ---------------------------------------------------------------------------

import { verifyEmailAction } from "../verify-email";
import { auth } from "@/src/lib/auth-server";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { emailVerifications } from "@/src/lib/metrics/auth";

const mockVerifyEmail = (
  auth as unknown as { api: { verifyEmail: ReturnType<typeof vi.fn> } }
).api.verifyEmail;
const mockEmitAuthAudit = emitAuthAudit as unknown as ReturnType<typeof vi.fn>;
const mockEmailVerificationsInc = (
  emailVerifications as unknown as { inc: ReturnType<typeof vi.fn> }
).inc;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifyEmailAction", () => {
  describe("happy path", () => {
    it("returns ok:true, emits audit, increments counter on valid token", async () => {
      mockVerifyEmail.mockResolvedValueOnce({ status: true });

      const result = await verifyEmailAction("valid-token-abc");

      expect(result).toEqual({ ok: true });
      expect(mockVerifyEmail).toHaveBeenCalledWith({
        query: { token: "valid-token-abc" },
      });
      expect(mockEmitAuthAudit).toHaveBeenCalledOnce();
      const auditCall = mockEmitAuthAudit.mock.calls[0][0];
      expect(auditCall.action).toBe("email_verification_completed");
      expect(auditCall.outcome).toBe("ok");
      expect(mockEmailVerificationsInc).toHaveBeenCalledWith({ outcome: "ok" });
    });
  });

  describe("invalid token", () => {
    it("returns ok:false code:TOKEN_INVALID when Better Auth throws a non-expired error", async () => {
      mockVerifyEmail.mockRejectedValueOnce(new Error("INVALID_TOKEN: token not found"));

      const result = await verifyEmailAction("bad-token");

      expect(result).toEqual({ ok: false, code: "TOKEN_INVALID" });
      expect(mockEmitAuthAudit).toHaveBeenCalledOnce();
      const auditCall = mockEmitAuthAudit.mock.calls[0][0];
      expect(auditCall.action).toBe("email_verification_completed");
      expect(auditCall.outcome).toBe("failed");
      expect(auditCall.errorCode).toBe("TOKEN_INVALID");
      expect(mockEmailVerificationsInc).toHaveBeenCalledWith({ outcome: "failed" });
    });
  });

  describe("expired token", () => {
    it("returns ok:false code:TOKEN_EXPIRED when Better Auth throws an expired error", async () => {
      mockVerifyEmail.mockRejectedValueOnce(new Error("Token has expired"));

      const result = await verifyEmailAction("expired-token");

      expect(result).toEqual({ ok: false, code: "TOKEN_EXPIRED" });
      expect(mockEmitAuthAudit).toHaveBeenCalledOnce();
      const auditCall = mockEmitAuthAudit.mock.calls[0][0];
      expect(auditCall.action).toBe("email_verification_completed");
      expect(auditCall.outcome).toBe("failed");
      expect(auditCall.errorCode).toBe("TOKEN_EXPIRED");
      expect(mockEmailVerificationsInc).toHaveBeenCalledWith({ outcome: "failed" });
    });

    it("returns ok:false code:TOKEN_EXPIRED when error message contains TOKEN_EXPIRED", async () => {
      mockVerifyEmail.mockRejectedValueOnce(new Error("TOKEN_EXPIRED"));

      const result = await verifyEmailAction("stale-token");

      expect(result).toEqual({ ok: false, code: "TOKEN_EXPIRED" });
    });
  });

  describe("empty / missing token", () => {
    it("returns ok:false code:TOKEN_INVALID for an empty string without calling auth", async () => {
      const result = await verifyEmailAction("");

      expect(result).toEqual({ ok: false, code: "TOKEN_INVALID" });
      expect(mockVerifyEmail).not.toHaveBeenCalled();
      expect(mockEmailVerificationsInc).toHaveBeenCalledWith({ outcome: "failed" });
    });
  });
});
