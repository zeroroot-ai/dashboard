/**
 * Integration tests for signInAction — Task 30 (account lockout) + Task 31
 * (CAPTCHA after repeated IP failures).
 *
 * Scenarios:
 *   (a) 10 consecutive invalid-credential attempts for the same email →
 *       transition into locked state on attempt 11, subsequent attempts
 *       return the generic failure + `outcome: locked` audit, no further
 *       per-account counter increments.
 *   (b) While locked, even a correct password is rejected with the same
 *       generic "invalid email or password" message.
 *   (c) A successful sign-in resets the per-account failure counter.
 *   (d) CAPTCHA required once the per-IP failure counter reaches the
 *       threshold (>5 in 5 min). Action returns CAPTCHA_REQUIRED without
 *       a token and CAPTCHA_FAILED with a bad token.
 *   (e) Account-locked notification email is dispatched exactly once per
 *       lockout window even across multiple failed attempts.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mock declarations — vi.mock is hoisted before any import.
// ---------------------------------------------------------------------------

// next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "10.0.0.1" })),
}));

// Rate limiter — always allow the per-IP 20/min guard for these tests; the
// per-account and per-IP-captcha counters live in the signin.ts module's
// own store.
vi.mock("@/src/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIP: vi.fn(() => "10.0.0.1"),
}));

// CAPTCHA verifier — default to ok:true (disabled mode); individual tests
// override to simulate enabled-provider failures.
vi.mock("@/src/lib/auth/captcha", () => ({
  verifyCaptcha: vi.fn().mockResolvedValue({ ok: true }),
}));

// Correlation — stable ID.
vi.mock("@/src/lib/correlation", () => ({
  getCorrelationId: vi.fn().mockReturnValue("test-correlation-id"),
}));

// Audit emitter — spy.
vi.mock("@/src/lib/audit/auth", () => ({
  emitAuthAudit: vi.fn(),
}));

// Metrics — spies with explicit inc methods per counter referenced by the SUT.
vi.mock("@/src/lib/metrics/auth", () => ({
  signinAttempts: { inc: vi.fn() },
  accountLockouts: { inc: vi.fn() },
  captchaFailures: { inc: vi.fn() },
}));

// Debug recorder — no-op.
vi.mock("@/src/lib/debug", () => ({
  recordDebugError: vi.fn(),
  isDebug: false,
}));

// Redis store — force the fall-back to in-memory by returning null/false for
// every op. The SUT's in-memory Map is what the tests exercise.
vi.mock("@/src/lib/redis-store", () => ({
  getJSON: vi.fn().mockResolvedValue(null),
  setJSON: vi.fn().mockResolvedValue(false),
  delKey: vi.fn().mockResolvedValue(false),
}));

// Email provider — capture send() calls without dispatching anything.
const mockEmailSend = vi.fn().mockResolvedValue(undefined);
vi.mock("@/src/lib/email/provider", () => ({
  getEmailProvider: vi.fn(() => ({ send: mockEmailSend })),
}));

// Email template renderer — pass-through stub.
vi.mock("@/src/lib/email/templates/account-locked", () => ({
  render: vi.fn((ctx: { email: string }) => ({
    to: ctx.email,
    subject: "Account locked",
    text: "locked",
    html: "<p>locked</p>",
  })),
}));

// Better Auth server — signInEmail is the single method the SUT calls.
vi.mock("@/src/lib/auth-server", () => ({
  auth: {
    api: {
      signInEmail: vi.fn(),
    },
  },
}));

// ---------------------------------------------------------------------------
// Imports AFTER mock declarations.
// ---------------------------------------------------------------------------

import {
  signInAction,
  __resetSigninLockoutStateForTests,
} from "../signin";
import { auth } from "@/src/lib/auth-server";
import { verifyCaptcha } from "@/src/lib/auth/captcha";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import {
  signinAttempts,
  accountLockouts,
  captchaFailures,
} from "@/src/lib/metrics/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authApiAny = (auth as any).api;

const mockSignInEmail = authApiAny.signInEmail as Mock;
const mockVerifyCaptcha = verifyCaptcha as Mock;
const mockEmitAuthAudit = emitAuthAudit as Mock;
const mockSigninAttemptsInc = (signinAttempts as unknown as { inc: Mock }).inc;
const mockAccountLockoutsInc = (accountLockouts as unknown as { inc: Mock }).inc;
const mockCaptchaFailuresInc = (captchaFailures as unknown as { inc: Mock }).inc;

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const GOOD = {
  email: "alice@example.com",
  password: "Correct-Horse-Battery-Staple1!",
};
const BAD = {
  email: "alice@example.com",
  password: "wrong-password",
};

async function waitMicrotasks() {
  // The account-locked email is dispatched via `void sendLockoutEmailOnce(...)`.
  // Flush the microtask + setImmediate queues so any pending promise
  // resolutions (the `getEmailProvider().send(...)` call) settle before the
  // assertion in tests that inspect mockEmailSend.
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(async () => {
  vi.clearAllMocks();
  await __resetSigninLockoutStateForTests();

  // Safe defaults.
  mockSignInEmail.mockReset();
  mockVerifyCaptcha.mockResolvedValue({ ok: true });
  mockEmailSend.mockClear();
  mockEmailSend.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// (a) 10 fails trigger lockout
// ---------------------------------------------------------------------------

describe("(a) 10 invalid-credential attempts trigger account lockout", () => {
  it("11th attempt is rejected with outcome=locked audit and no counter increment", async () => {
    mockSignInEmail.mockRejectedValue(new Error("Invalid credentials"));

    // 10 failures accumulate the per-account counter but don't lock yet
    // (lockout transitions on the attempt that pushes the count PAST the
    // threshold — i.e. count > 10). signin.ts uses `accountCount > 10`.
    for (let i = 0; i < 10; i++) {
      const r = await signInAction(BAD);
      expect(r.ok).toBe(false);
    }

    // The 11th attempt is what transitions the account into the locked state.
    const lockingResult = await signInAction(BAD);
    expect(lockingResult.ok).toBe(false);

    // accountLockouts metric incremented exactly once up to this point.
    expect(mockAccountLockoutsInc).toHaveBeenCalledTimes(1);

    // The 12th attempt must short-circuit at the locked-state check with
    // outcome=locked — no further signInEmail call.
    const callCountBefore = mockSignInEmail.mock.calls.length;
    const lockedResult = await signInAction(BAD);
    expect(lockedResult.ok).toBe(false);
    expect(mockSignInEmail.mock.calls.length).toBe(callCountBefore);

    // The 12th attempt's audit records outcome=locked.
    const lockedAuditCall = mockEmitAuthAudit.mock.calls
      .map((c: unknown[]) => c[0] as Record<string, unknown>)
      .filter(
        (e) =>
          e.action === "signin_failed" &&
          e.outcome === "locked" &&
          e.reason === "account_locked",
      );
    expect(lockedAuditCall.length).toBeGreaterThanOrEqual(1);

    // account_locked audit fired exactly once across the whole sequence.
    const lockedEvents = mockEmitAuthAudit.mock.calls
      .map((c: unknown[]) => c[0] as Record<string, unknown>)
      .filter((e) => e.action === "account_locked");
    expect(lockedEvents.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (b) Lockout rejects the correct password too
// ---------------------------------------------------------------------------

describe("(b) lockout window rejects correct password", () => {
  it("returns the generic failure message even for the right credential while locked", async () => {
    mockSignInEmail.mockRejectedValue(new Error("Invalid credentials"));

    // Drive into the locked state (11 failures).
    for (let i = 0; i < 11; i++) {
      await signInAction(BAD);
    }

    // Switch Better Auth to succeed — but the locked-state guard should
    // prevent signInEmail from ever being called.
    mockSignInEmail.mockReset();
    mockSignInEmail.mockResolvedValue({ user: { id: "user-abc" } });

    const result = await signInAction(GOOD);
    expect(result.ok).toBe(false);
    if (!result.ok && "message" in result) {
      expect(result.message).toBe("Invalid email or password.");
    }

    // signInEmail NOT invoked while locked.
    expect(mockSignInEmail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (c) Successful sign-in resets the per-account counter
// ---------------------------------------------------------------------------

describe("(c) success resets per-account counter", () => {
  it("after 5 failures then a success, the next failure is the 1st in a new window", async () => {
    // Drive 5 failures.
    mockSignInEmail.mockRejectedValue(new Error("Invalid credentials"));
    for (let i = 0; i < 5; i++) {
      await signInAction(BAD);
    }

    // Then succeed.
    mockSignInEmail.mockReset();
    mockSignInEmail.mockResolvedValue({ user: { id: "user-abc" } });
    const ok = await signInAction(GOOD);
    expect(ok.ok).toBe(true);

    // Now drive 10 more failures: lockout should NOT trigger until the 11th
    // since the counter was reset.
    mockSignInEmail.mockReset();
    mockSignInEmail.mockRejectedValue(new Error("Invalid credentials"));

    // Clear the mock call history before resuming failures.
    mockAccountLockoutsInc.mockClear();

    for (let i = 0; i < 10; i++) {
      const r = await signInAction(BAD);
      expect(r.ok).toBe(false);
    }

    // accountLockouts NOT yet incremented — we are still in the "below threshold"
    // regime because the counter was reset after the success.
    expect(mockAccountLockoutsInc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (d) CAPTCHA required after 5 IP failures
// ---------------------------------------------------------------------------

describe("(d) CAPTCHA after 5 IP failures", () => {
  it("returns CAPTCHA_REQUIRED without a token once the IP threshold is reached", async () => {
    mockSignInEmail.mockRejectedValue(new Error("Invalid credentials"));
    // Simulate an enabled-provider rejection for an empty token.
    mockVerifyCaptcha.mockImplementation(async (token: string) => {
      if (token.length === 0) {
        return { ok: false, reason: "missing_token" };
      }
      return { ok: true };
    });

    // 5 failures bring the IP counter to the threshold.
    for (let i = 0; i < 5; i++) {
      await signInAction(BAD);
    }

    // 6th attempt without a token → CAPTCHA_REQUIRED.
    const result = await signInAction(BAD);
    expect(result.ok).toBe(false);
    if (!result.ok && "code" in result) {
      expect(result.code).toBe("CAPTCHA_REQUIRED");
    }

    // captchaFailures metric incremented with a provider label.
    expect(mockCaptchaFailuresInc).toHaveBeenCalled();
    const lastCaptchaCall = mockCaptchaFailuresInc.mock.calls.at(-1);
    expect(lastCaptchaCall?.[0]).toEqual(
      expect.objectContaining({ provider: expect.any(String) }),
    );
  });

  it("returns CAPTCHA_FAILED when a bad token is provided past the threshold", async () => {
    mockSignInEmail.mockRejectedValue(new Error("Invalid credentials"));
    mockVerifyCaptcha.mockImplementation(async (token: string) => {
      if (token === "bad-token") return { ok: false, reason: "invalid-input-response" };
      if (token.length === 0) return { ok: false, reason: "missing_token" };
      return { ok: true };
    });

    for (let i = 0; i < 5; i++) {
      await signInAction(BAD);
    }

    const result = await signInAction({ ...BAD, captchaToken: "bad-token" });
    expect(result.ok).toBe(false);
    if (!result.ok && "code" in result) {
      expect(result.code).toBe("CAPTCHA_FAILED");
    }
  });
});

// ---------------------------------------------------------------------------
// (e) Lockout notification email fires once per window
// ---------------------------------------------------------------------------

describe("(e) account-locked email throttled to one per window", () => {
  it("dispatches the email exactly once even across multiple failed attempts while locked", async () => {
    mockSignInEmail.mockRejectedValue(new Error("Invalid credentials"));

    // Drive into the locked state.
    for (let i = 0; i < 11; i++) {
      await signInAction(BAD);
    }

    // Flush microtasks so the fire-and-forget sendLockoutEmailOnce call
    // completes before we assert.
    await waitMicrotasks();

    // Exactly one email dispatch so far.
    expect(mockEmailSend).toHaveBeenCalledTimes(1);

    // More failed attempts while locked — no additional emails.
    for (let i = 0; i < 5; i++) {
      await signInAction(BAD);
    }
    await waitMicrotasks();

    expect(mockEmailSend).toHaveBeenCalledTimes(1);

    // Spot-check the email recipient — the template was called with the
    // normalized email address.
    const sent = mockEmailSend.mock.calls[0]?.[0] as { to?: string };
    expect(sent?.to).toBe("alice@example.com");
  });

  it("signinAttempts metric records invalid_credentials and locked outcomes", async () => {
    mockSignInEmail.mockRejectedValue(new Error("Invalid credentials"));

    // Drive 10 failures + 1 lockout transition + 1 post-lock attempt.
    for (let i = 0; i < 12; i++) {
      await signInAction(BAD);
    }

    const outcomes = mockSigninAttemptsInc.mock.calls.map(
      (c: unknown[]) => (c[0] as { outcome: string }).outcome,
    );
    expect(outcomes).toContain("failed");
    expect(outcomes).toContain("locked");
  });
});
