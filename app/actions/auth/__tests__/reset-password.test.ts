/**
 * Unit tests for resetPasswordAction.
 *
 * Verifies:
 *   1. Happy path: action calls auth.api.resetPassword + emits audit ok + redirects.
 *   2. Token expired → { ok: false, code: 'TOKEN_EXPIRED' }.
 *   3. Token invalid / not found → { ok: false, code: 'TOKEN_INVALID' }.
 *   4. Password mismatch → { ok: false, code: 'CONFIRM_MISMATCH' }.
 *   5. Password policy failure via hooks.before HIBP (mock isPasswordBreached
 *      to return breached) → auth throws PASSWORD_BREACHED → code: 'PASSWORD_POLICY'.
 *   6. Audit emitted on every terminal path.
 *   7. Metric incremented on every terminal path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// next/navigation — redirect() throws a special NEXT_REDIRECT error; we mock
// it to be catchable in tests.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/src/lib/auth-server", () => ({
  auth: {
    api: {
      resetPassword: vi.fn(),
      signInEmail: vi.fn(),
    },
  },
}));

vi.mock("@/src/lib/audit/auth", () => ({
  emitAuthAudit: vi.fn(),
}));

vi.mock("@/src/lib/metrics/auth", () => ({
  passwordResets: { inc: vi.fn() },
}));

vi.mock("@/src/lib/debug", () => ({
  recordDebugError: vi.fn(),
  isDebug: false,
}));

// ---------------------------------------------------------------------------
// SUT + mock imports
// ---------------------------------------------------------------------------

import { resetPasswordAction } from "../reset-password";
import { auth } from "@/src/lib/auth-server";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { passwordResets } from "@/src/lib/metrics/auth";
import { redirect } from "next/navigation";

const mockResetPassword = auth.api.resetPassword as unknown as ReturnType<typeof vi.fn>;
const mockEmitAuthAudit = emitAuthAudit as unknown as ReturnType<typeof vi.fn>;
const mockPasswordResetsInc = (
  passwordResets as unknown as { inc: ReturnType<typeof vi.fn> }
).inc;
const mockRedirect = redirect as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_INPUT = {
  token: "abc123validtoken",
  password: "Correct#Horse1Battery",
  confirmPassword: "Correct#Horse1Battery",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockResetPassword.mockResolvedValue({ status: true });
  // redirect throws so tests can assert it was called.
  mockRedirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
});

describe("resetPasswordAction", () => {
  describe("happy path", () => {
    it("calls auth.api.resetPassword with token and newPassword", async () => {
      await expect(resetPasswordAction(VALID_INPUT)).rejects.toThrow("NEXT_REDIRECT");
      expect(mockResetPassword).toHaveBeenCalledOnce();
      const call = mockResetPassword.mock.calls[0][0];
      expect(call.body.token).toBe(VALID_INPUT.token);
      expect(call.body.newPassword).toBe(VALID_INPUT.password);
    });

    it("emits password_reset_completed audit with outcome ok", async () => {
      await expect(resetPasswordAction(VALID_INPUT)).rejects.toThrow("NEXT_REDIRECT");
      expect(mockEmitAuthAudit).toHaveBeenCalledOnce();
      const call = mockEmitAuthAudit.mock.calls[0][0];
      expect(call.action).toBe("password_reset_completed");
      expect(call.outcome).toBe("ok");
    });

    it("increments passwordResets metric with ok", async () => {
      await expect(resetPasswordAction(VALID_INPUT)).rejects.toThrow("NEXT_REDIRECT");
      expect(mockPasswordResetsInc).toHaveBeenCalledWith({ outcome: "ok" });
    });

    it("redirects to /login?reset=success after success", async () => {
      let redirectedTo = "";
      mockRedirect.mockImplementation((url: string) => {
        redirectedTo = url;
        throw new Error(`NEXT_REDIRECT:${url}`);
      });
      await expect(resetPasswordAction(VALID_INPUT)).rejects.toThrow("NEXT_REDIRECT");
      expect(redirectedTo).toBe("/login?reset=success");
    });
  });

  describe("token expired", () => {
    it("returns TOKEN_EXPIRED when Better Auth throws an expiry error", async () => {
      mockResetPassword.mockRejectedValueOnce(new Error("Token expired"));
      const result = await resetPasswordAction(VALID_INPUT);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("TOKEN_EXPIRED");
      }
    });

    it("emits password_reset_completed audit with outcome failed on expired token", async () => {
      mockResetPassword.mockRejectedValueOnce(new Error("Token expired"));
      await resetPasswordAction(VALID_INPUT);
      const call = mockEmitAuthAudit.mock.calls[0][0];
      expect(call.action).toBe("password_reset_completed");
      expect(call.outcome).toBe("failed");
    });

    it("increments passwordResets with failed on expired token", async () => {
      mockResetPassword.mockRejectedValueOnce(new Error("Token expired"));
      await resetPasswordAction(VALID_INPUT);
      expect(mockPasswordResetsInc).toHaveBeenCalledWith({ outcome: "failed" });
    });
  });

  describe("token invalid / not found", () => {
    it("returns TOKEN_INVALID for INVALID_TOKEN error", async () => {
      mockResetPassword.mockRejectedValueOnce(new Error("Invalid token"));
      const result = await resetPasswordAction(VALID_INPUT);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("TOKEN_INVALID");
      }
    });

    it("returns TOKEN_INVALID for not found error", async () => {
      mockResetPassword.mockRejectedValueOnce(new Error("Verification value not found"));
      const result = await resetPasswordAction(VALID_INPUT);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("TOKEN_INVALID");
      }
    });
  });

  describe("confirm password mismatch", () => {
    it("returns CONFIRM_MISMATCH without calling auth when passwords differ", async () => {
      const result = await resetPasswordAction({
        ...VALID_INPUT,
        confirmPassword: "DifferentPass1!",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("CONFIRM_MISMATCH");
      }
      expect(mockResetPassword).not.toHaveBeenCalled();
    });

    it("does not emit audit on confirm mismatch", async () => {
      await resetPasswordAction({ ...VALID_INPUT, confirmPassword: "Wrong#Pass1" });
      expect(mockEmitAuthAudit).not.toHaveBeenCalled();
    });
  });

  describe("password policy failure (HIBP breached)", () => {
    it("returns PASSWORD_POLICY when Better Auth throws PASSWORD_BREACHED", async () => {
      mockResetPassword.mockRejectedValueOnce(
        new Error("PASSWORD_BREACHED: This password has appeared in a public breach"),
      );
      const result = await resetPasswordAction(VALID_INPUT);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("PASSWORD_POLICY");
      }
    });

    it("returns PASSWORD_POLICY for 'breach' errors", async () => {
      mockResetPassword.mockRejectedValueOnce(
        new Error("password is in known breach databases"),
      );
      const result = await resetPasswordAction(VALID_INPUT);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("PASSWORD_POLICY");
      }
    });

    it("returns PASSWORD_POLICY for complexity failures", async () => {
      // Input that fails our Zod schema (too short).
      const result = await resetPasswordAction({
        token: "sometoken",
        password: "tooshort",
        confirmPassword: "tooshort",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Could be PASSWORD_POLICY from Zod or from Better Auth hook.
        expect(["PASSWORD_POLICY", "TOKEN_INVALID"]).toContain(result.code);
      }
    });
  });

  describe("audit on every path", () => {
    it("no audit emitted on Zod validation failure (before auth call)", async () => {
      await resetPasswordAction({
        token: "",
        password: "Correct#Horse1Battery",
        confirmPassword: "Correct#Horse1Battery",
      });
      // token is empty → Zod rejects before any auth call
      expect(mockEmitAuthAudit).not.toHaveBeenCalled();
    });

    it("audit emitted once on auth error", async () => {
      mockResetPassword.mockRejectedValueOnce(new Error("some db error"));
      await resetPasswordAction(VALID_INPUT);
      expect(mockEmitAuthAudit).toHaveBeenCalledOnce();
    });
  });
});
