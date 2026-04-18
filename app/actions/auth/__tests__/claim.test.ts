/**
 * @vitest-environment node
 *
 * Unit tests for claimAccountAction.
 *
 * Verifies:
 *   1. Rejects TOKEN_INVALID when findInvitationById returns null.
 *   2. Rejects TOKEN_INVALID when the invitation row's status is accepted/
 *      canceled/rejected.
 *   3. Rejects TOKEN_EXPIRED when expiresAt < now().
 *   4. Rejects CONFIRM_MISMATCH when password ≠ confirmPassword.
 *   5. Rejects PASSWORD_POLICY for weak passwords.
 *   6. Rejects PASSWORD_BREACHED when HIBP reports breached=true.
 *   7. Happy path: hashes password, links credential account, flips
 *      emailVerified, accepts invitation, signs in, redirects to dashboard.
 *
 * The module under test calls `redirect()` on success; our test harness
 * catches Next.js's `NEXT_REDIRECT` error and asserts the redirect target.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted via vi.hoisted so the factory closures can capture them.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  findInvitationById: vi.fn(),
  updateInvitation: vi.fn(),
  findUserByEmail: vi.fn(),
  updateUser: vi.fn(),
  findAccounts: vi.fn(),
  linkAccount: vi.fn(),
  updatePassword: vi.fn(),
  passwordHash: vi.fn(async (p: string) => `hashed:${p}`),
  signInEmail: vi.fn(),
  isPasswordBreached: vi.fn(),
  emitAuthAudit: vi.fn(),
  hibpInc: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`);
    // Mimic Next.js's redirect marker so the action surfaces as a throw.
    (err as unknown as { digest?: string }).digest = `NEXT_REDIRECT;${url}`;
    throw err;
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/src/lib/auth-server", () => ({
  auth: {
    $context: Promise.resolve({
      internalAdapter: {
        findUserByEmail: (e: string) => mocks.findUserByEmail(e),
        updateUser: (id: string, data: unknown) => mocks.updateUser(id, data),
        findAccounts: (id: string) => mocks.findAccounts(id),
        linkAccount: (args: unknown) => mocks.linkAccount(args),
        updatePassword: (id: string, h: string) => mocks.updatePassword(id, h),
      },
      password: {
        hash: (p: string) => mocks.passwordHash(p),
      },
    }),
    api: {
      signInEmail: (args: unknown) => mocks.signInEmail(args),
    },
  },
}));

vi.mock("better-auth/plugins/organization", () => ({
  getOrgAdapter: () => ({
    findInvitationById: (id: string) => mocks.findInvitationById(id),
    updateInvitation: (args: unknown) => mocks.updateInvitation(args),
  }),
}));

vi.mock("@/src/lib/audit/auth", () => ({
  emitAuthAudit: (...args: unknown[]) => mocks.emitAuthAudit(...args),
}));

vi.mock("@/src/lib/auth/hibp", () => ({
  isPasswordBreached: (...args: unknown[]) => mocks.isPasswordBreached(...args),
}));

vi.mock("@/src/lib/metrics/auth", () => ({
  hibpChecks: { inc: (...args: unknown[]) => mocks.hibpInc(...args) },
}));

vi.mock("@/src/lib/debug", () => ({
  recordDebugError: vi.fn(),
  isDebug: false,
}));

// Imported after all mocks are wired.
import { claimAccountAction } from "../claim";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STRONG_PW = "Correct-Horse-Battery-Staple-9!";
const TOKEN = "inv_abc_123";
const USER_ID = "user_shell_001";
const ORG_ID = "org_acme_001";
const EMAIL = "owner@acme.example";

function futureDate(daysFromNow = 7): Date {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
}

function pastDate(daysAgo = 1): Date {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Happy-path defaults; individual tests override.
  mocks.isPasswordBreached.mockResolvedValue({ breached: false });
  mocks.findUserByEmail.mockResolvedValue({ user: { id: USER_ID, email: EMAIL } });
  mocks.findAccounts.mockResolvedValue([]); // shell user — no credential yet
  mocks.linkAccount.mockResolvedValue({});
  mocks.updateUser.mockResolvedValue({});
  mocks.updateInvitation.mockResolvedValue({});
  mocks.signInEmail.mockResolvedValue({});
  mocks.findInvitationById.mockResolvedValue({
    id: TOKEN,
    email: EMAIL,
    organizationId: ORG_ID,
    status: "pending",
    expiresAt: futureDate(7),
    role: "owner",
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("claimAccountAction", () => {
  it("rejects TOKEN_INVALID when the invitation is not found", async () => {
    mocks.findInvitationById.mockResolvedValue(null);
    const res = await claimAccountAction({
      token: TOKEN,
      password: STRONG_PW,
      confirmPassword: STRONG_PW,
    });
    expect(res).toEqual({
      ok: false,
      code: "TOKEN_INVALID",
      message: expect.any(String),
    });
    expect(mocks.linkAccount).not.toHaveBeenCalled();
    expect(mocks.signInEmail).not.toHaveBeenCalled();
  });

  it("rejects TOKEN_INVALID when the invitation is already accepted", async () => {
    mocks.findInvitationById.mockResolvedValue({
      id: TOKEN,
      email: EMAIL,
      organizationId: ORG_ID,
      status: "accepted",
      expiresAt: futureDate(7),
      role: "owner",
    });
    const res = await claimAccountAction({
      token: TOKEN,
      password: STRONG_PW,
      confirmPassword: STRONG_PW,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("TOKEN_INVALID");
    }
    expect(mocks.linkAccount).not.toHaveBeenCalled();
  });

  it("rejects TOKEN_EXPIRED when expiresAt is in the past", async () => {
    mocks.findInvitationById.mockResolvedValue({
      id: TOKEN,
      email: EMAIL,
      organizationId: ORG_ID,
      status: "pending",
      expiresAt: pastDate(1),
      role: "owner",
    });
    const res = await claimAccountAction({
      token: TOKEN,
      password: STRONG_PW,
      confirmPassword: STRONG_PW,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("TOKEN_EXPIRED");
    }
  });

  it("rejects CONFIRM_MISMATCH when password != confirmPassword", async () => {
    const res = await claimAccountAction({
      token: TOKEN,
      password: STRONG_PW,
      confirmPassword: STRONG_PW + "!",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("CONFIRM_MISMATCH");
    }
    // Invitation should not even be looked up on validation failure.
    expect(mocks.findInvitationById).not.toHaveBeenCalled();
  });

  it("rejects PASSWORD_POLICY for short passwords", async () => {
    const res = await claimAccountAction({
      token: TOKEN,
      password: "short1!A",
      confirmPassword: "short1!A",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("PASSWORD_POLICY");
    }
  });

  it("rejects PASSWORD_BREACHED when HIBP reports a compromise", async () => {
    mocks.isPasswordBreached.mockResolvedValue({ breached: true });
    const res = await claimAccountAction({
      token: TOKEN,
      password: STRONG_PW,
      confirmPassword: STRONG_PW,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("PASSWORD_BREACHED");
    }
    expect(mocks.linkAccount).not.toHaveBeenCalled();
  });

  it("happy path: hashes, linkAccount, updateUser, accepts invitation, signs in, redirects", async () => {
    let caught: Error | null = null;
    try {
      await claimAccountAction({
        token: TOKEN,
        password: STRONG_PW,
        confirmPassword: STRONG_PW,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/NEXT_REDIRECT:\/dashboard\/default/);

    expect(mocks.passwordHash).toHaveBeenCalledWith(STRONG_PW);
    expect(mocks.linkAccount).toHaveBeenCalledWith({
      userId: USER_ID,
      providerId: "credential",
      accountId: USER_ID,
      password: `hashed:${STRONG_PW}`,
    });
    expect(mocks.updateUser).toHaveBeenCalledWith(USER_ID, {
      emailVerified: true,
    });
    expect(mocks.updateInvitation).toHaveBeenCalledWith({
      invitationId: TOKEN,
      status: "accepted",
    });
    expect(mocks.signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { email: EMAIL, password: STRONG_PW },
      }),
    );
    // Audit emitted with claim_completed / ok.
    const ev = mocks.emitAuthAudit.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { action?: string }).action === "claim_completed" &&
        (c[0] as { outcome?: string }).outcome === "ok",
    );
    expect(ev).toBeDefined();
  });

  it("updates (not links) a credential account when one already exists", async () => {
    mocks.findAccounts.mockResolvedValue([
      { providerId: "credential", password: "old-hash" },
    ]);
    try {
      await claimAccountAction({
        token: TOKEN,
        password: STRONG_PW,
        confirmPassword: STRONG_PW,
      });
    } catch {
      /* redirect */
    }
    expect(mocks.updatePassword).toHaveBeenCalledWith(
      USER_ID,
      `hashed:${STRONG_PW}`,
    );
    expect(mocks.linkAccount).not.toHaveBeenCalled();
  });

  it("user-missing maps to TOKEN_INVALID (does not silently succeed)", async () => {
    mocks.findUserByEmail.mockResolvedValue(null);
    const res = await claimAccountAction({
      token: TOKEN,
      password: STRONG_PW,
      confirmPassword: STRONG_PW,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("TOKEN_INVALID");
    }
    expect(mocks.linkAccount).not.toHaveBeenCalled();
  });

  it("post-claim sign-in failure still marks claim completed (redirects to /login)", async () => {
    mocks.signInEmail.mockRejectedValue(new Error("session store down"));
    let caught: Error | null = null;
    try {
      await claimAccountAction({
        token: TOKEN,
        password: STRONG_PW,
        confirmPassword: STRONG_PW,
      });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught?.message).toMatch(/NEXT_REDIRECT:\/login/);
    // Credential was still linked and invitation was still accepted.
    expect(mocks.linkAccount).toHaveBeenCalled();
    expect(mocks.updateInvitation).toHaveBeenCalledWith({
      invitationId: TOKEN,
      status: "accepted",
    });
  });
});
