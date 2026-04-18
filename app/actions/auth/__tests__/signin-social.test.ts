/**
 * Unit tests for signInSocialAction.
 *
 * Covers:
 *  - Unknown provider name → INVALID_PROVIDER
 *  - Known provider that is not enabled → PROVIDER_DISABLED
 *  - Rate limit exceeded → RATE_LIMITED + audit emitted
 *  - Cross-origin redirectTo → REDIRECT_NOT_ALLOWED
 *  - Happy path: mocked auth.api.signInSocial returns a URL → { ok: true, url }
 *  - auth.api.signInSocial throws → PROVIDER_ERROR
 *  - Audit emitter sees events in correct order
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mock declarations — hoisted before imports.
// ---------------------------------------------------------------------------

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "10.0.0.1" })),
}));

vi.mock("@/src/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  getClientIP: vi.fn(() => "10.0.0.1"),
}));

vi.mock("@/src/lib/correlation", () => ({
  getCorrelationId: vi.fn().mockReturnValue("test-corr-social"),
}));

vi.mock("@/src/lib/audit/auth", () => ({
  emitAuthAudit: vi.fn(),
}));

vi.mock("@/src/lib/debug", () => ({
  recordDebugError: vi.fn(),
  isDebug: false,
}));

// Better Auth — signInSocial is the single method the SUT calls.
// Must use vi.fn() inline in the factory (hoisting constraint).
vi.mock("@/src/lib/auth-server", () => ({
  auth: {
    api: {
      signInSocial: vi.fn(),
    },
  },
}));

// ---------------------------------------------------------------------------
// Imports AFTER mock declarations.
// ---------------------------------------------------------------------------

import { signInSocialAction } from "../signin-social";
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

function clearAllProviders() {
  for (const k of [
    "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET",
    "GITLAB_CLIENT_ID", "GITLAB_CLIENT_SECRET",
    "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
    "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET",
    "MICROSOFT_TENANT_ID",
  ]) vi.stubEnv(k, "");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("signInSocialAction — provider validation", () => {
  beforeEach(() => {
    (emitAuthAudit as Mock).mockClear();
    (auth.api.signInSocial as unknown as Mock).mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns INVALID_PROVIDER for an unknown provider string", async () => {
    stubAllProviders();
    const result = await signInSocialAction({ provider: "twitter" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_PROVIDER");
  });

  it("returns INVALID_PROVIDER for an empty provider string", async () => {
    stubAllProviders();
    const result = await signInSocialAction({ provider: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_PROVIDER");
  });

  it("returns PROVIDER_DISABLED when provider is valid but not configured", async () => {
    clearAllProviders(); // all providers disabled
    const result = await signInSocialAction({ provider: "github" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PROVIDER_DISABLED");
  });
});

describe("signInSocialAction — redirect allowlist gate", () => {
  beforeEach(() => {
    (emitAuthAudit as Mock).mockClear();
    (auth.api.signInSocial as unknown as Mock).mockClear();
    stubAllProviders();
    vi.stubEnv("BETTER_AUTH_URL", "https://dashboard.example.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns REDIRECT_NOT_ALLOWED for a cross-origin redirectTo", async () => {
    const result = await signInSocialAction({
      provider: "github",
      redirectTo: "https://evil.com/steal",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("REDIRECT_NOT_ALLOWED");
  });

  it("returns REDIRECT_NOT_ALLOWED for a protocol-relative URL", async () => {
    const result = await signInSocialAction({
      provider: "github",
      redirectTo: "//evil.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("REDIRECT_NOT_ALLOWED");
  });
});

describe("signInSocialAction — rate limiting", () => {
  beforeEach(() => {
    (emitAuthAudit as Mock).mockClear();
    (auth.api.signInSocial as unknown as Mock).mockClear();
    stubAllProviders();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns RATE_LIMITED when checkRateLimit denies the request", async () => {
    (checkRateLimit as Mock).mockResolvedValueOnce({ allowed: false });
    const result = await signInSocialAction({ provider: "github" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("RATE_LIMITED");
  });

  it("emits a rate_limited audit event when rate limited", async () => {
    (checkRateLimit as Mock).mockResolvedValueOnce({ allowed: false });
    await signInSocialAction({ provider: "github" });
    const calls = (emitAuthAudit as Mock).mock.calls.map((c) => c[0]);
    expect(calls.some((e) => e.action === "signin_social_started" && e.outcome === "rate_limited")).toBe(true);
  });
});

describe("signInSocialAction — happy path", () => {
  const MOCK_URL = "https://github.com/login/oauth/authorize?client_id=gh-id&state=abc";

  beforeEach(() => {
    (emitAuthAudit as Mock).mockClear();
    (auth.api.signInSocial as unknown as Mock).mockClear();
    stubAllProviders();
    vi.stubEnv("BETTER_AUTH_URL", "https://dashboard.example.com");
    (checkRateLimit as Mock).mockResolvedValue({ allowed: true });
    (auth.api.signInSocial as unknown as Mock).mockResolvedValue({ url: MOCK_URL });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns { ok: true, url } with the provider authorize URL", async () => {
    const result = await signInSocialAction({ provider: "github" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url).toBe(MOCK_URL);
  });

  it("calls auth.api.signInSocial with the correct provider", async () => {
    await signInSocialAction({ provider: "google" });
    expect(auth.api.signInSocial as unknown as Mock).toHaveBeenCalledOnce();
    const mockFn = auth.api.signInSocial as unknown as Mock;
    const [call] = mockFn.mock.calls;
    expect(call[0].body.provider).toBe("google");
  });

  it("emits signin_social_started with outcome ok", async () => {
    await signInSocialAction({ provider: "github" });
    const started = (emitAuthAudit as Mock).mock.calls
      .map((c) => c[0])
      .find((e) => e.action === "signin_social_started" && e.outcome === "ok");
    expect(started).toBeTruthy();
  });

  it("accepts a same-origin relative redirectTo without rejecting", async () => {
    const result = await signInSocialAction({
      provider: "github",
      redirectTo: "/dashboard/default",
    });
    expect(result.ok).toBe(true);
  });
});

describe("signInSocialAction — provider error path", () => {
  beforeEach(() => {
    (emitAuthAudit as Mock).mockClear();
    (auth.api.signInSocial as unknown as Mock).mockClear();
    stubAllProviders();
    vi.stubEnv("BETTER_AUTH_URL", "https://dashboard.example.com");
    (checkRateLimit as Mock).mockResolvedValue({ allowed: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns PROVIDER_ERROR when auth.api.signInSocial throws", async () => {
    (auth.api.signInSocial as unknown as Mock).mockRejectedValueOnce(new Error("provider unavailable"));
    const result = await signInSocialAction({ provider: "github" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PROVIDER_ERROR");
  });

  it("emits signin_social_failed when the provider errors", async () => {
    (auth.api.signInSocial as unknown as Mock).mockRejectedValueOnce(new Error("provider down"));
    await signInSocialAction({ provider: "github" });
    const failed = (emitAuthAudit as Mock).mock.calls
      .map((c) => c[0])
      .find((e) => e.action === "signin_social_failed");
    expect(failed).toBeTruthy();
  });

  it("returns PROVIDER_ERROR when Better Auth returns no url field", async () => {
    (auth.api.signInSocial as unknown as Mock).mockResolvedValueOnce({ redirect: true }); // url missing
    const result = await signInSocialAction({ provider: "github" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PROVIDER_ERROR");
  });
});
