/**
 * Unit tests for checkPasswordAction.
 *
 * Verifies:
 *   1. Empty / non-string input → ok:false with reason 'invalid_input'.
 *   2. isPasswordBreached returns breached:true → ok:true breached:true + count.
 *   3. isPasswordBreached returns breached:false → ok:true breached:false.
 *   4. isPasswordBreached returns breached:'unknown' → ok:false + reason, audit emitted.
 *   5. isPasswordBreached throws → ok:false reason 'internal_error', audit emitted.
 *   6. hibpChecks counter incremented with correct outcome label on every path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — vi.mock is hoisted before imports; factories must not reference
// variables declared in the module scope to avoid TDZ errors. Instead, use
// vi.fn() directly inside the factory and re-export from a stable reference
// via the module's named export so tests can spy on it.
// ---------------------------------------------------------------------------

vi.mock("@/src/lib/auth/hibp", () => ({
  isPasswordBreached: vi.fn(),
}));

vi.mock("@/src/lib/metrics/auth", () => ({
  hibpChecks: { inc: vi.fn() },
}));

vi.mock("@/src/lib/audit/auth", () => ({
  emitAuthAudit: vi.fn(),
}));

// ---------------------------------------------------------------------------
// SUT and mock module imports AFTER mock declarations.
// ---------------------------------------------------------------------------

import { checkPasswordAction } from "../check-password";
import { isPasswordBreached } from "@/src/lib/auth/hibp";
import { hibpChecks } from "@/src/lib/metrics/auth";
import { emitAuthAudit } from "@/src/lib/audit/auth";

const mockIsPasswordBreached = isPasswordBreached as unknown as ReturnType<typeof vi.fn>;
const mockHibpChecksInc = (hibpChecks as unknown as { inc: ReturnType<typeof vi.fn> }).inc;
const mockEmitAuthAudit = emitAuthAudit as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkPasswordAction", () => {
  describe("invalid input", () => {
    it("returns ok:false for empty string", async () => {
      const result = await checkPasswordAction({ password: "" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("invalid_input");
      }
      expect(mockIsPasswordBreached).not.toHaveBeenCalled();
      expect(mockHibpChecksInc).not.toHaveBeenCalled();
    });
  });

  describe("breached password", () => {
    it("returns ok:true breached:true with count when HIBP reports a breach", async () => {
      mockIsPasswordBreached.mockResolvedValueOnce({ breached: true, count: 12345 });

      const result = await checkPasswordAction({ password: "hunter2" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.breached).toBe(true);
        expect(result.count).toBe(12345);
      }
      expect(mockHibpChecksInc).toHaveBeenCalledWith({ outcome: "breached" });
      expect(mockEmitAuthAudit).not.toHaveBeenCalled();
    });
  });

  describe("clean password", () => {
    it("returns ok:true breached:false when HIBP finds no breach", async () => {
      mockIsPasswordBreached.mockResolvedValueOnce({ breached: false, count: 0 });

      const result = await checkPasswordAction({ password: "Correct#Horse1Battery" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.breached).toBe(false);
        expect(result.count).toBe(0);
      }
      expect(mockHibpChecksInc).toHaveBeenCalledWith({ outcome: "clean" });
      expect(mockEmitAuthAudit).not.toHaveBeenCalled();
    });
  });

  describe("unknown / unavailable", () => {
    it("returns ok:false and emits hibp_unavailable audit when HIBP returns unknown", async () => {
      mockIsPasswordBreached.mockResolvedValueOnce({
        breached: "unknown",
        reason: "timeout",
      });

      const result = await checkPasswordAction({ password: "SomePassword1!" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("timeout");
      }
      expect(mockHibpChecksInc).toHaveBeenCalledWith({ outcome: "unknown" });
      expect(mockEmitAuthAudit).toHaveBeenCalledOnce();
      const auditCall = mockEmitAuthAudit.mock.calls[0][0];
      expect(auditCall.action).toBe("hibp_unavailable");
      expect(auditCall.outcome).toBe("failed");
      expect(auditCall.reason).toBe("timeout");
    });

    it("returns ok:false and emits audit when isPasswordBreached throws", async () => {
      mockIsPasswordBreached.mockRejectedValueOnce(new Error("unexpected"));

      const result = await checkPasswordAction({ password: "SomePassword1!" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("internal_error");
      }
      expect(mockHibpChecksInc).toHaveBeenCalledWith({ outcome: "unknown" });
      expect(mockEmitAuthAudit).toHaveBeenCalledOnce();
      const auditCall = mockEmitAuthAudit.mock.calls[0][0];
      expect(auditCall.action).toBe("hibp_unavailable");
      expect(auditCall.outcome).toBe("failed");
    });
  });
});
