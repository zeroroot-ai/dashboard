/**
 * Integration tests — social sign-in flow (dashboard-social-providers spec, Task 19).
 *
 * Tests the social sign-in server action layer plus the account-linking policy
 * (account-takeover guard) through mocked Better Auth API responses.
 *
 * Why mocks instead of a real OAuth2 server:
 *   Better Auth's social sign-in flow (signInSocial) returns an authorization
 *   URL which the browser then navigates to. The actual OAuth2 token exchange
 *   happens in the browser <-> provider <-> callback route round-trip. There is
 *   no way to exercise that end-to-end in a unit/integration test without a
 *   running browser (that is Playwright's job, Task 20). What we CAN test here
 *   is every decision the server-side actions and guards make:
 *
 *   (a) New-user path: signInSocialAction returns a valid authorization URL and
 *       emits the correct audit event; the createPersonalOrg helper creates the
 *       org idempotently when called by the afterCreate hook.
 *
 *   (b) Returning-user path (verified email match): signInSocialAction returns
 *       a URL; Better Auth's linkage policy (account.accountLinking.allowDifferentEmails=false)
 *       is enforced server-side — simulated here by Better Auth returning the
 *       auth URL normally when the account already exists with a matching
 *       verified email.
 *
 *   (c) Hostile-takeover guard (unverified email): Better Auth throws when the
 *       incoming provider email matches a Gibson user whose emailVerified=false.
 *       signInSocialAction must surface this as PROVIDER_ERROR and emit a
 *       signin_social_failed audit event.
 *
 *   (d) Unlink-last-credential guard: unlinkSocialAction with a single linked
 *       provider and no password returns LAST_CREDENTIAL without calling
 *       unlinkAccount.
 *
 * The account.accountLinking configuration is at src/lib/auth-server.ts:
 *   account.accountLinking.enabled = true
 *   account.accountLinking.allowDifferentEmails = false  ← hostile-takeover guard
 *   account.accountLinking.trustedProviders = ["github", "gitlab", "google", "microsoft"]
 *
 * Better Auth enforces the unverified-email rejection internally by checking
 * the user row's emailVerified flag when processing the OAuth callback. Since
 * we cannot run the full callback in a unit test, scenario (c) is tested by
 * asserting that when auth.api.signInSocial throws the "email_doesn't_match"
 * or "UNAUTHORIZED" error class Better Auth would raise, signInSocialAction
 * propagates it as PROVIDER_ERROR.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mock declarations — must be hoisted before imports.
// ---------------------------------------------------------------------------

// next/headers — return minimal headers with a forwarded IP.
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "10.1.2.3" })),
}));

// Rate limiter — always allow.
vi.mock("@/src/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIP: vi.fn(() => "10.1.2.3"),
}));

// Social providers — enable GitHub by default.
vi.mock("@/src/lib/social-providers", () => ({
  buildSocialProviders: vi.fn(() => ({
    config: {},
    enabled: ["github"],
  })),
  // re-export the type shim
}));

// Redirect allowlist — pass through.
vi.mock("@/src/lib/auth/redirect-allowlist", () => ({
  validateRedirectTo: vi.fn((url: string | undefined) => url ?? "/"),
}));

// Correlation — stable ID.
vi.mock("@/src/lib/correlation", () => ({
  getCorrelationId: vi.fn().mockReturnValue("test-corr-id"),
}));

// Audit emitter — spy so we can assert event sequences.
vi.mock("@/src/lib/audit/auth", () => ({
  emitAuthAudit: vi.fn(),
}));

// Debug recorder — no-op.
vi.mock("@/src/lib/debug", () => ({
  recordDebugError: vi.fn(),
  isDebug: false,
}));

// Better Auth server — full api mock.
vi.mock("@/src/lib/auth-server", () => ({
  auth: {
    $context: Promise.resolve({}),
    api: {
      signInSocial: vi.fn(),
      listUserAccounts: vi.fn(),
      unlinkAccount: vi.fn(),
    },
  },
}));

// Session — default: no session (override per test where needed).
vi.mock("@/app/actions/auth/session", () => ({
  getSession: vi.fn().mockResolvedValue(null),
}));

// Org adapter — used by createPersonalOrg.
vi.mock("better-auth/plugins/organization", () => ({
  getOrgAdapter: vi.fn(() => ({
    findOrganizationBySlug: vi.fn().mockResolvedValue(null),
    createOrganization: vi.fn().mockResolvedValue({
      id: "org-new",
      slug: "alice-gh",
      name: "Alice GH",
    }),
    createMember: vi.fn().mockResolvedValue({}),
  })),
}));

// ---------------------------------------------------------------------------
// Imports (after mock declarations).
// ---------------------------------------------------------------------------

import { signInSocialAction } from "@/app/actions/auth/signin-social";
import { unlinkSocialAction } from "@/app/actions/auth/unlink-social";
import { createPersonalOrg } from "@/src/lib/auth/create-personal-org";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { auth } from "@/src/lib/auth-server";
import { getSession } from "@/app/actions/auth/session";
import { getOrgAdapter } from "better-auth/plugins/organization";

// Typed references to mocks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authApi = (auth as any).api as {
  signInSocial: Mock;
  listUserAccounts: Mock;
  unlinkAccount: Mock;
};
const mockEmitAuthAudit = emitAuthAudit as Mock;
const mockGetSession = getSession as Mock;
const mockGetOrgAdapter = getOrgAdapter as Mock;

// ---------------------------------------------------------------------------
// Scenario (a): New-user social sign-in — action + personal org creation
// ---------------------------------------------------------------------------

describe("(a) new-user social sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Better Auth returns an authorize URL.
    authApi.signInSocial.mockResolvedValue({
      url: "https://github.com/login/oauth/authorize?client_id=test&state=abc",
    });
    // Org adapter: no existing org for this user.
    mockGetOrgAdapter.mockReturnValue({
      findOrganizationBySlug: vi.fn().mockResolvedValue(null),
      createOrganization: vi.fn().mockResolvedValue({
        id: "org-new",
        slug: "alice-gh",
        name: "alice-gh",
      }),
      createMember: vi.fn().mockResolvedValue({}),
    });
  });

  it("returns { ok: true, url } containing the GitHub authorize endpoint", async () => {
    const result = await signInSocialAction({ provider: "github" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok:true");
    expect(result.url).toContain("github.com/login/oauth/authorize");
  });

  it("emits signin_social_started with outcome ok before calling signInSocial", async () => {
    await signInSocialAction({ provider: "github" });
    const auditCalls = mockEmitAuthAudit.mock.calls.map(
      (c: unknown[]) => (c[0] as { action: string; outcome: string }),
    );
    const startedEvent = auditCalls.find((e) => e.action === "signin_social_started");
    expect(startedEvent).toBeDefined();
    expect(startedEvent?.outcome).toBe("ok");
  });

  it("passes the provider id to auth.api.signInSocial", async () => {
    await signInSocialAction({ provider: "github" });
    expect(authApi.signInSocial).toHaveBeenCalledOnce();
    const body = authApi.signInSocial.mock.calls[0][0].body;
    expect(body.provider).toBe("github");
    expect(body.disableRedirect).toBe(true);
  });

  it("createPersonalOrg creates the org on first call and skips on second (idempotency)", async () => {
    const adapter = {
      findOrganizationBySlug: vi.fn().mockResolvedValue(null),
      createOrganization: vi.fn().mockResolvedValue({
        id: "org-id-1",
        slug: "alice-gh",
        name: "alice-gh",
      }),
      createMember: vi.fn().mockResolvedValue({}),
    };
    mockGetOrgAdapter.mockReturnValue(adapter);

    // First call — org does not exist.
    const result1 = await createPersonalOrg("user-123", "alice-gh");
    expect(result1.created).toBe(true);
    expect(result1.slug).toBe("alice-gh");
    expect(adapter.createOrganization).toHaveBeenCalledOnce();
    expect(adapter.createMember).toHaveBeenCalledOnce();

    // Second call — org now exists (simulate by returning it from the adapter).
    adapter.findOrganizationBySlug.mockResolvedValue({
      id: "org-id-1",
      slug: "alice-gh",
      name: "alice-gh",
    });
    const result2 = await createPersonalOrg("user-123", "alice-gh");
    expect(result2.created).toBe(false);
    // createOrganization should NOT have been called again.
    expect(adapter.createOrganization).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Scenario (b): Returning verified user — sign-in flow continues normally
//
// Better Auth's account.accountLinking.allowDifferentEmails=false (the
// hostile-takeover guard) ensures that when an existing verified-email user
// signs in via GitHub and the provider email matches, Better Auth automatically
// links the account. The signInSocialAction sees a normal URL response.
// ---------------------------------------------------------------------------

describe("(b) returning user with verified email — auto-link succeeds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Better Auth returns the auth URL normally — the auto-link happens
    // inside the callback after the browser redirects.
    authApi.signInSocial.mockResolvedValue({
      url: "https://github.com/login/oauth/authorize?client_id=test&state=xyz",
    });
  });

  it("returns { ok: true, url } for a verified returning user", async () => {
    const result = await signInSocialAction({ provider: "github" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok:true");
    expect(result.url).toBeTruthy();
  });

  it("calls auth.api.signInSocial with callbackURL pointing at the provider callback route", async () => {
    await signInSocialAction({ provider: "github" });
    const body = authApi.signInSocial.mock.calls[0][0].body;
    expect(body.callbackURL).toMatch(/\/api\/auth\/callback\/github/);
  });
});

// ---------------------------------------------------------------------------
// Scenario (c): Hostile-takeover guard — unverified email user cannot be linked
//
// Better Auth enforces allowDifferentEmails=false during the OAuth callback.
// When the incoming provider email matches a Gibson user whose emailVerified=false,
// Better Auth throws an APIError. This scenario verifies that signInSocialAction
// surfaces the error as PROVIDER_ERROR and emits a signin_social_failed audit.
//
// This is the load-bearing test for Requirement 3 of the spec.
// ---------------------------------------------------------------------------

describe("(c) unverified-email hostile-takeover guard — sign-in rejected", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Simulate Better Auth rejecting because the target user's email is
    // unverified. Better Auth raises an APIError whose message contains
    // "UNAUTHORIZED" or "email_doesn't_match" (see dist/oauth2/link-account.mjs).
    authApi.signInSocial.mockRejectedValue(
      Object.assign(new Error("UNAUTHORIZED"), { status: 401 }),
    );
  });

  it("returns { ok: false, code: PROVIDER_ERROR } when Better Auth rejects the linkage", async () => {
    const result = await signInSocialAction({ provider: "github" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected ok:false");
    expect(result.code).toBe("PROVIDER_ERROR");
  });

  it("emits signin_social_failed audit with outcome=failed when Better Auth rejects", async () => {
    await signInSocialAction({ provider: "github" });
    const auditCalls = mockEmitAuthAudit.mock.calls.map(
      (c: unknown[]) => (c[0] as { action: string; outcome: string }),
    );
    const failedEvent = auditCalls.find((e) => e.action === "signin_social_failed");
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.outcome).toBe("failed");
  });

  it("does NOT return a URL when Better Auth rejects the linkage", async () => {
    const result = await signInSocialAction({ provider: "github" });
    expect(result.ok).toBe(false);
    // Type narrowing — result.url only exists on ok:true
    expect((result as { url?: string }).url).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario (d): Unlink-last-credential guard
//
// A user with only one social provider linked and no password must not be
// able to unlink that provider (it would lock them out of their account).
// unlinkSocialAction must return LAST_CREDENTIAL and NOT call unlinkAccount.
// ---------------------------------------------------------------------------

describe("(d) unlink-last-credential guard", () => {
  const SIGNED_IN_USER_ID = "user-social-only";

  beforeEach(() => {
    vi.clearAllMocks();
    // Simulate a signed-in user with only GitHub linked (no password).
    mockGetSession.mockResolvedValue({
      user: { id: SIGNED_IN_USER_ID, email: "alice@example.com" },
    });
    // listUserAccounts returns only the GitHub social account — no "credential"
    // account row, which means no email+password.
    authApi.listUserAccounts.mockResolvedValue([
      { providerId: "github", accountId: "gh-alice-123" },
    ]);
    authApi.unlinkAccount.mockResolvedValue({});
  });

  it("returns LAST_CREDENTIAL when the user has only one sign-in method", async () => {
    const result = await unlinkSocialAction({ provider: "github" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected ok:false");
    expect(result.code).toBe("LAST_CREDENTIAL");
  });

  it("does NOT call auth.api.unlinkAccount when LAST_CREDENTIAL guard fires", async () => {
    await unlinkSocialAction({ provider: "github" });
    expect(authApi.unlinkAccount).not.toHaveBeenCalled();
  });

  it("emits a last_credential audit event", async () => {
    await unlinkSocialAction({ provider: "github" });
    const auditCalls = mockEmitAuthAudit.mock.calls.map(
      (c: unknown[]) => (c[0] as { action: string; reason: string }),
    );
    const guardEvent = auditCalls.find((e) => e.reason === "last_credential");
    expect(guardEvent).toBeDefined();
  });

  it("succeeds when the user has GitHub + a password (two methods)", async () => {
    // Add a "credential" row to simulate a password-bearing account.
    authApi.listUserAccounts.mockResolvedValue([
      { providerId: "credential", accountId: SIGNED_IN_USER_ID },
      { providerId: "github", accountId: "gh-alice-123" },
    ]);

    const result = await unlinkSocialAction({ provider: "github" });
    expect(result.ok).toBe(true);
    expect(authApi.unlinkAccount).toHaveBeenCalledOnce();
  });

  it("succeeds when the user has GitHub + Google (two methods) and unlinks GitHub", async () => {
    authApi.listUserAccounts.mockResolvedValue([
      { providerId: "github", accountId: "gh-alice-123" },
      { providerId: "google", accountId: "gg-alice-456" },
    ]);

    const result = await unlinkSocialAction({ provider: "github" });
    expect(result.ok).toBe(true);
    expect(authApi.unlinkAccount).toHaveBeenCalledOnce();
  });

  it("returns NOT_LINKED when the target provider is not on the account", async () => {
    const result = await unlinkSocialAction({ provider: "google" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected ok:false");
    expect(result.code).toBe("NOT_LINKED");
    expect(authApi.unlinkAccount).not.toHaveBeenCalled();
  });
});
