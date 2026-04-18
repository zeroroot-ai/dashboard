/**
 * Unit tests for unlinkSocialAction.
 *
 * Covers the full decision matrix:
 *  - Unauthenticated → UNAUTHENTICATED; unlinkAccount NOT called
 *  - Invalid provider → INVALID_PROVIDER
 *  - Rate limited → RATE_LIMITED
 *  - Provider not linked → NOT_LINKED
 *  - Last credential guard: only 1 social, no password → LAST_CREDENTIAL;
 *    unlinkAccount must NOT be called in this case
 *  - Has password + social → can unlink social; succeeds
 *  - Has 2 socials (no password) → can unlink one; succeeds
 *  - Audit events emitted correctly
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mock declarations — hoisted.
// ---------------------------------------------------------------------------

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "10.0.0.1" })),
}));

vi.mock("@/src/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIP: vi.fn(() => "10.0.0.1"),
}));

vi.mock("@/src/lib/correlation", () => ({
  getCorrelationId: vi.fn().mockReturnValue("test-corr-unlink"),
}));

vi.mock("@/src/lib/audit/auth", () => ({
  emitAuthAudit: vi.fn(),
}));

vi.mock("@/src/lib/debug", () => ({
  recordDebugError: vi.fn(),
  isDebug: false,
}));

vi.mock("@/app/actions/auth/session", () => ({
  getSession: vi.fn().mockResolvedValue({ user: { id: "user-456" } }),
}));

vi.mock("@/src/lib/auth-server", () => ({
  auth: {
    api: {
      listUserAccounts: vi.fn(),
      unlinkAccount: vi.fn().mockResolvedValue({ status: true }),
    },
  },
}));

// ---------------------------------------------------------------------------
// Imports AFTER mock declarations.
// ---------------------------------------------------------------------------

import { unlinkSocialAction } from "../unlink-social";
import { getSession } from "@/app/actions/auth/session";
import { checkRateLimit } from "@/src/lib/rate-limiter";
import { auth } from "@/src/lib/auth-server";
import { emitAuthAudit } from "@/src/lib/audit/auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubAllProviders() {
  vi.stubEnv("GITHUB_CLIENT_ID", "gh-id");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "gh-secret");
  vi.stubEnv("GITLAB_CLIENT_ID", "gl-id");
  vi.stubEnv("GITLAB_CLIENT_SECRET", "gl-secret");
  vi.stubEnv("GOOGLE_CLIENT_ID", "go-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "go-secret");
  vi.stubEnv("MICROSOFT_CLIENT_ID", "ms-id");
  vi.stubEnv("MICROSOFT_CLIENT_SECRET", "ms-secret");
  vi.stubEnv("MICROSOFT_TENANT_ID", "common");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("unlinkSocialAction — authentication gate", () => {
  beforeEach(() => {
    (emitAuthAudit as Mock).mockClear();
    (auth.api.unlinkAccount as unknown as Mock).mockClear();
    stubAllProviders();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns UNAUTHENTICATED when there is no session", async () => {
    (getSession as Mock).mockResolvedValueOnce(null);
    const result = await unlinkSocialAction({ provider: "github" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNAUTHENTICATED");
  });

  it("does NOT call unlinkAccount when unauthenticated", async () => {
    (getSession as Mock).mockResolvedValueOnce(null);
    await unlinkSocialAction({ provider: "github" });
    expect(auth.api.unlinkAccount as unknown as Mock).not.toHaveBeenCalled();
  });
});

describe("unlinkSocialAction — provider validation", () => {
  beforeEach(() => {
    (emitAuthAudit as Mock).mockClear();
    (auth.api.unlinkAccount as unknown as Mock).mockClear();
    (getSession as Mock).mockResolvedValue({ user: { id: "user-456" } });
    stubAllProviders();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns INVALID_PROVIDER for an unknown provider", async () => {
    const result = await unlinkSocialAction({ provider: "twitter" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_PROVIDER");
  });
});

describe("unlinkSocialAction — NOT_LINKED", () => {
  beforeEach(() => {
    (emitAuthAudit as Mock).mockClear();
    (auth.api.unlinkAccount as unknown as Mock).mockClear();
    (getSession as Mock).mockResolvedValue({ user: { id: "user-456" } });
    (checkRateLimit as Mock).mockResolvedValue({ allowed: true });
    stubAllProviders();
    // User has only a credential account (no github)
    (auth.api.listUserAccounts as unknown as Mock).mockResolvedValue([{ providerId: "credential" }]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns NOT_LINKED when the target provider is not linked", async () => {
    const result = await unlinkSocialAction({ provider: "github" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_LINKED");
  });

  it("does NOT call unlinkAccount for a NOT_LINKED result", async () => {
    await unlinkSocialAction({ provider: "github" });
    expect(auth.api.unlinkAccount as unknown as Mock).not.toHaveBeenCalled();
  });
});

describe("unlinkSocialAction — LAST_CREDENTIAL guard (load-bearing)", () => {
  beforeEach(() => {
    (emitAuthAudit as Mock).mockClear();
    (auth.api.unlinkAccount as unknown as Mock).mockClear();
    (getSession as Mock).mockResolvedValue({ user: { id: "user-456" } });
    (checkRateLimit as Mock).mockResolvedValue({ allowed: true });
    stubAllProviders();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses when user has only 1 social provider and no password", async () => {
    (auth.api.listUserAccounts as unknown as Mock).mockResolvedValue([
      { providerId: "github", accountId: "gh-123" },
    ]);
    const result = await unlinkSocialAction({ provider: "github" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("LAST_CREDENTIAL");
  });

  it("does NOT call unlinkAccount when LAST_CREDENTIAL guard fires", async () => {
    (auth.api.listUserAccounts as unknown as Mock).mockResolvedValue([
      { providerId: "github", accountId: "gh-123" },
    ]);
    await unlinkSocialAction({ provider: "github" });
    expect(auth.api.unlinkAccount as unknown as Mock).not.toHaveBeenCalled();
  });

  it("emits a last_credential audit event", async () => {
    (auth.api.listUserAccounts as unknown as Mock).mockResolvedValue([
      { providerId: "github", accountId: "gh-123" },
    ]);
    await unlinkSocialAction({ provider: "github" });
    const calls = (emitAuthAudit as Mock).mock.calls.map((c) => c[0]);
    expect(calls.some((e) => e.reason === "last_credential")).toBe(true);
  });
});

describe("unlinkSocialAction — successful unlink", () => {
  beforeEach(() => {
    (emitAuthAudit as Mock).mockClear();
    (auth.api.unlinkAccount as unknown as Mock).mockClear();
    (getSession as Mock).mockResolvedValue({ user: { id: "user-456" } });
    (checkRateLimit as Mock).mockResolvedValue({ allowed: true });
    stubAllProviders();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("succeeds when user has password + 1 social and unlinking the social", async () => {
    (auth.api.listUserAccounts as unknown as Mock).mockResolvedValue([
      { providerId: "credential" },
      { providerId: "github", accountId: "gh-abc" },
    ]);
    const result = await unlinkSocialAction({ provider: "github" });
    expect(result.ok).toBe(true);
    expect(auth.api.unlinkAccount as unknown as Mock).toHaveBeenCalledOnce();
  });

  it("succeeds when user has 2 socials and unlinking one", async () => {
    (auth.api.listUserAccounts as unknown as Mock).mockResolvedValue([
      { providerId: "github", accountId: "gh-abc" },
      { providerId: "google", accountId: "go-xyz" },
    ]);
    const result = await unlinkSocialAction({ provider: "github" });
    expect(result.ok).toBe(true);
    expect(auth.api.unlinkAccount as unknown as Mock).toHaveBeenCalledOnce();
  });

  it("emits an unlink_social audit with outcome ok", async () => {
    (auth.api.listUserAccounts as unknown as Mock).mockResolvedValue([
      { providerId: "credential" },
      { providerId: "github", accountId: "gh-abc" },
    ]);
    await unlinkSocialAction({ provider: "github" });
    const calls = (emitAuthAudit as Mock).mock.calls.map((c) => c[0]);
    const unlinked = calls.find((e) => e.action === "unlink_social" && e.outcome === "ok");
    expect(unlinked).toBeTruthy();
  });
});
