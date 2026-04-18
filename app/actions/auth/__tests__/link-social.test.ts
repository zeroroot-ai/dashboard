/**
 * Unit tests for linkSocialAction.
 *
 * Covers:
 *  - Unauthenticated caller → UNAUTHENTICATED (linkSocialAccount NOT called)
 *  - Invalid provider name → INVALID_PROVIDER
 *  - Rate limit exceeded → RATE_LIMITED
 *  - Happy path → { ok: true, url }
 *  - auth.api.linkSocialAccount throws → PROVIDER_ERROR
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
  getCorrelationId: vi.fn().mockReturnValue("test-corr-link"),
}));

vi.mock("@/src/lib/audit/auth", () => ({
  emitAuthAudit: vi.fn(),
}));

vi.mock("@/src/lib/debug", () => ({
  recordDebugError: vi.fn(),
  isDebug: false,
}));

// Session mock — returns a signed-in user by default.
vi.mock("@/app/actions/auth/session", () => ({
  getSession: vi.fn().mockResolvedValue({ user: { id: "user-123" } }),
}));

vi.mock("@/src/lib/auth-server", () => ({
  auth: {
    api: {
      linkSocialAccount: vi.fn(),
    },
  },
}));

// ---------------------------------------------------------------------------
// Imports AFTER mock declarations.
// ---------------------------------------------------------------------------

import { linkSocialAction } from "../link-social";
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

describe("linkSocialAction — authentication gate", () => {
  beforeEach(() => {
    (emitAuthAudit as Mock).mockClear();
    (auth.api.linkSocialAccount as unknown as Mock).mockClear();
    stubAllProviders();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns UNAUTHENTICATED when there is no session", async () => {
    (getSession as Mock).mockResolvedValueOnce(null);
    const result = await linkSocialAction({ provider: "github" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNAUTHENTICATED");
  });

  it("does NOT call linkSocialAccount when unauthenticated", async () => {
    (getSession as Mock).mockResolvedValueOnce(null);
    await linkSocialAction({ provider: "github" });
    expect(auth.api.linkSocialAccount as unknown as Mock).not.toHaveBeenCalled();
  });
});

describe("linkSocialAction — provider validation", () => {
  beforeEach(() => {
    (emitAuthAudit as Mock).mockClear();
    (auth.api.linkSocialAccount as unknown as Mock).mockClear();
    stubAllProviders();
    (getSession as Mock).mockResolvedValue({ user: { id: "user-123" } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns INVALID_PROVIDER for an unknown provider", async () => {
    const result = await linkSocialAction({ provider: "twitter" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_PROVIDER");
  });
});

describe("linkSocialAction — rate limiting", () => {
  beforeEach(() => {
    (emitAuthAudit as Mock).mockClear();
    (auth.api.linkSocialAccount as unknown as Mock).mockClear();
    stubAllProviders();
    (getSession as Mock).mockResolvedValue({ user: { id: "user-123" } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns RATE_LIMITED when rate limit is exceeded", async () => {
    (checkRateLimit as Mock).mockResolvedValueOnce({ allowed: false });
    const result = await linkSocialAction({ provider: "github" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RATE_LIMITED");
  });
});

describe("linkSocialAction — happy path", () => {
  const MOCK_URL = "https://github.com/login/oauth/authorize?...";

  beforeEach(() => {
    (emitAuthAudit as Mock).mockClear();
    (auth.api.linkSocialAccount as unknown as Mock).mockClear();
    stubAllProviders();
    (getSession as Mock).mockResolvedValue({ user: { id: "user-123" } });
    (checkRateLimit as Mock).mockResolvedValue({ allowed: true });
    (auth.api.linkSocialAccount as unknown as Mock).mockResolvedValue({ url: MOCK_URL });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns { ok: true, url } on success", async () => {
    const result = await linkSocialAction({ provider: "github" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe(MOCK_URL);
  });

  it("emits a link_social audit with outcome ok", async () => {
    await linkSocialAction({ provider: "github" });
    const auditCalls = (emitAuthAudit as Mock).mock.calls.map((c) => c[0]);
    const linked = auditCalls.find((e) => e.action === "link_social" && e.outcome === "ok");
    expect(linked).toBeTruthy();
  });
});

describe("linkSocialAction — provider error", () => {
  beforeEach(() => {
    (emitAuthAudit as Mock).mockClear();
    (auth.api.linkSocialAccount as unknown as Mock).mockClear();
    stubAllProviders();
    (getSession as Mock).mockResolvedValue({ user: { id: "user-123" } });
    (checkRateLimit as Mock).mockResolvedValue({ allowed: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns PROVIDER_ERROR when linkSocialAccount throws", async () => {
    (auth.api.linkSocialAccount as unknown as Mock).mockRejectedValueOnce(new Error("provider down"));
    const result = await linkSocialAction({ provider: "github" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PROVIDER_ERROR");
  });
});
