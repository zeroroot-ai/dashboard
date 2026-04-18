/**
 * Unit tests for buildSocialProviders().
 *
 * Uses vi.stubEnv to set env vars per test case and vi.unstubAllEnvs in
 * afterEach to restore the original state. No network calls are made;
 * no real Better Auth boot occurs.
 *
 * Coverage matrix:
 *  - Per provider: all-set → provider appears in config + enabled list
 *  - Per provider: ID only → throws with ID var name in message
 *  - Per provider: secret only → throws with secret var name in message
 *  - All empty → no-throw, empty enabled list
 *  - Microsoft: credentials set, tenant empty → throws with MICROSOFT_TENANT_ID in message
 *  - Microsoft: credentials set, tenant set → enabled
 *  - PROVIDER_ORDER export matches expected canonical order
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// The module is imported fresh per test-file load. Because buildSocialProviders()
// reads process.env at call-time (not at import time), we can call the function
// multiple times within the same test file with different stubbed env vars.
import {
  buildSocialProviders,
  PROVIDER_ORDER,
  type ProviderId,
} from "../social-providers";

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubProvider(
  provider: "GITHUB" | "GITLAB" | "GOOGLE",
  id: string,
  secret: string
) {
  vi.stubEnv(`${provider}_CLIENT_ID`, id);
  vi.stubEnv(`${provider}_CLIENT_SECRET`, secret);
}

function stubMicrosoft(id: string, secret: string, tenantId: string) {
  vi.stubEnv("MICROSOFT_CLIENT_ID", id);
  vi.stubEnv("MICROSOFT_CLIENT_SECRET", secret);
  vi.stubEnv("MICROSOFT_TENANT_ID", tenantId);
}

function clearAll() {
  for (const key of [
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "GITLAB_CLIENT_ID",
    "GITLAB_CLIENT_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET",
    "MICROSOFT_TENANT_ID",
  ]) {
    vi.stubEnv(key, "");
  }
}

// ---------------------------------------------------------------------------
// PROVIDER_ORDER
// ---------------------------------------------------------------------------

describe("PROVIDER_ORDER", () => {
  it("exports canonical order: github → gitlab → google → microsoft", () => {
    expect(PROVIDER_ORDER).toEqual<ProviderId[]>(["github", "gitlab", "google", "microsoft"]);
  });
});

// ---------------------------------------------------------------------------
// All providers disabled
// ---------------------------------------------------------------------------

describe("all providers disabled (no env vars set)", () => {
  it("returns empty enabled list and empty config without throwing", () => {
    clearAll();
    const result = buildSocialProviders();
    expect(result.enabled).toEqual([]);
    expect(result.config).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

describe("GitHub provider", () => {
  it("enables github when both CLIENT_ID and CLIENT_SECRET are set", () => {
    clearAll();
    stubProvider("GITHUB", "gh-client-id", "gh-secret");
    const { enabled, config } = buildSocialProviders();
    expect(enabled).toContain("github");
    expect(config).toHaveProperty("github");
  });

  it("throws when GITHUB_CLIENT_ID is set but GITHUB_CLIENT_SECRET is missing", () => {
    clearAll();
    vi.stubEnv("GITHUB_CLIENT_ID", "gh-client-id");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "");
    expect(() => buildSocialProviders()).toThrowError(/GITHUB_CLIENT_SECRET/);
  });

  it("throws when GITHUB_CLIENT_SECRET is set but GITHUB_CLIENT_ID is missing", () => {
    clearAll();
    vi.stubEnv("GITHUB_CLIENT_ID", "");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "gh-secret");
    expect(() => buildSocialProviders()).toThrowError(/GITHUB_CLIENT_ID/);
  });

  it("throw message names the offending variable (ID missing case)", () => {
    clearAll();
    vi.stubEnv("GITHUB_CLIENT_ID", "");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "gh-secret");
    expect(() => buildSocialProviders()).toThrowError("GITHUB_CLIENT_ID");
  });

  it("throw message names the offending variable (secret missing case)", () => {
    clearAll();
    vi.stubEnv("GITHUB_CLIENT_ID", "gh-client-id");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "");
    expect(() => buildSocialProviders()).toThrowError("GITHUB_CLIENT_SECRET");
  });
});

// ---------------------------------------------------------------------------
// GitLab
// ---------------------------------------------------------------------------

describe("GitLab provider", () => {
  it("enables gitlab when both CLIENT_ID and CLIENT_SECRET are set", () => {
    clearAll();
    stubProvider("GITLAB", "gl-client-id", "gl-secret");
    const { enabled, config } = buildSocialProviders();
    expect(enabled).toContain("gitlab");
    expect(config).toHaveProperty("gitlab");
  });

  it("throws when GITLAB_CLIENT_ID is set but GITLAB_CLIENT_SECRET is missing", () => {
    clearAll();
    vi.stubEnv("GITLAB_CLIENT_ID", "gl-client-id");
    vi.stubEnv("GITLAB_CLIENT_SECRET", "");
    expect(() => buildSocialProviders()).toThrowError(/GITLAB_CLIENT_SECRET/);
  });

  it("throws when GITLAB_CLIENT_SECRET is set but GITLAB_CLIENT_ID is missing", () => {
    clearAll();
    vi.stubEnv("GITLAB_CLIENT_ID", "");
    vi.stubEnv("GITLAB_CLIENT_SECRET", "gl-secret");
    expect(() => buildSocialProviders()).toThrowError(/GITLAB_CLIENT_ID/);
  });
});

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

describe("Google provider", () => {
  it("enables google when both CLIENT_ID and CLIENT_SECRET are set", () => {
    clearAll();
    stubProvider("GOOGLE", "go-client-id", "go-secret");
    const { enabled, config } = buildSocialProviders();
    expect(enabled).toContain("google");
    expect(config).toHaveProperty("google");
  });

  it("throws when GOOGLE_CLIENT_ID is set but GOOGLE_CLIENT_SECRET is missing", () => {
    clearAll();
    vi.stubEnv("GOOGLE_CLIENT_ID", "go-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(() => buildSocialProviders()).toThrowError(/GOOGLE_CLIENT_SECRET/);
  });

  it("throws when GOOGLE_CLIENT_SECRET is set but GOOGLE_CLIENT_ID is missing", () => {
    clearAll();
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "go-secret");
    expect(() => buildSocialProviders()).toThrowError(/GOOGLE_CLIENT_ID/);
  });
});

// ---------------------------------------------------------------------------
// Microsoft (Entra ID)
// ---------------------------------------------------------------------------

describe("Microsoft provider", () => {
  it("enables microsoft when CLIENT_ID, CLIENT_SECRET, and TENANT_ID are all set", () => {
    clearAll();
    stubMicrosoft("ms-client-id", "ms-secret", "common");
    const { enabled, config } = buildSocialProviders();
    expect(enabled).toContain("microsoft");
    expect(config).toHaveProperty("microsoft");
  });

  it("throws when MICROSOFT_CLIENT_ID is set but MICROSOFT_CLIENT_SECRET is missing", () => {
    clearAll();
    vi.stubEnv("MICROSOFT_CLIENT_ID", "ms-client-id");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "");
    vi.stubEnv("MICROSOFT_TENANT_ID", "common");
    expect(() => buildSocialProviders()).toThrowError(/MICROSOFT_CLIENT_SECRET/);
  });

  it("throws when MICROSOFT_CLIENT_SECRET is set but MICROSOFT_CLIENT_ID is missing", () => {
    clearAll();
    vi.stubEnv("MICROSOFT_CLIENT_ID", "");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "ms-secret");
    vi.stubEnv("MICROSOFT_TENANT_ID", "common");
    expect(() => buildSocialProviders()).toThrowError(/MICROSOFT_CLIENT_ID/);
  });

  it("throws with specific MICROSOFT_TENANT_ID message when credentials set but tenant ID is empty", () => {
    clearAll();
    vi.stubEnv("MICROSOFT_CLIENT_ID", "ms-client-id");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "ms-secret");
    vi.stubEnv("MICROSOFT_TENANT_ID", "");
    expect(() => buildSocialProviders()).toThrowError(/MICROSOFT_TENANT_ID/);
  });

  it("throw message for missing tenant ID is the exact design.md message fragment", () => {
    clearAll();
    vi.stubEnv("MICROSOFT_CLIENT_ID", "ms-client-id");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "ms-secret");
    vi.stubEnv("MICROSOFT_TENANT_ID", "");
    expect(() => buildSocialProviders()).toThrowError(
      /Microsoft provider requires MICROSOFT_TENANT_ID/
    );
  });

  it("does not throw when MICROSOFT_TENANT_ID is 'organizations'", () => {
    clearAll();
    stubMicrosoft("ms-client-id", "ms-secret", "organizations");
    expect(() => buildSocialProviders()).not.toThrow();
  });

  it("does not throw when MICROSOFT_TENANT_ID is a GUID-style value", () => {
    clearAll();
    stubMicrosoft("ms-client-id", "ms-secret", "3fa85f64-5717-4562-b3fc-2c963f66afa6");
    expect(() => buildSocialProviders()).not.toThrow();
  });

  it("does not include microsoft in enabled list when no Microsoft env vars are set", () => {
    clearAll();
    const { enabled } = buildSocialProviders();
    expect(enabled).not.toContain("microsoft");
  });
});

// ---------------------------------------------------------------------------
// Multiple providers simultaneously
// ---------------------------------------------------------------------------

describe("multiple providers enabled simultaneously", () => {
  it("enabled list matches the subset that is configured, in canonical order", () => {
    clearAll();
    stubProvider("GITHUB", "gh-id", "gh-secret");
    stubProvider("GOOGLE", "go-id", "go-secret");
    const { enabled } = buildSocialProviders();
    expect(enabled).toEqual(["github", "google"]);
  });

  it("all four enabled at once returns all four in canonical order", () => {
    clearAll();
    stubProvider("GITHUB", "gh-id", "gh-secret");
    stubProvider("GITLAB", "gl-id", "gl-secret");
    stubProvider("GOOGLE", "go-id", "go-secret");
    stubMicrosoft("ms-id", "ms-secret", "common");
    const { enabled } = buildSocialProviders();
    expect(enabled).toEqual<ProviderId[]>(["github", "gitlab", "google", "microsoft"]);
  });

  it("config object has exactly the keys that are enabled", () => {
    clearAll();
    stubProvider("GITLAB", "gl-id", "gl-secret");
    stubMicrosoft("ms-id", "ms-secret", "consumers");
    const { config, enabled } = buildSocialProviders();
    expect(Object.keys(config).sort()).toEqual([...enabled].sort());
  });
});
