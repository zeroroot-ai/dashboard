/**
 * Unit tests for validateRedirectTo.
 *
 * Covers:
 *  - Same-origin absolute URL → returns path only
 *  - Relative path → passes through as-is
 *  - Cross-origin URL → returns "/"
 *  - Protocol-relative URL ("//evil.com") → returns "/"
 *  - javascript: scheme → returns "/"
 *  - data: scheme → returns "/"
 *  - Empty / null / undefined → returns "/"
 *  - Relative path with backslash ("//\\evil.com") style → returns "/"
 *  - No BETTER_AUTH_URL configured → absolute URLs rejected, relative accepted
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateRedirectTo } from "../redirect-allowlist";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validateRedirectTo — empty / nullish input", () => {
  it("returns '/' for null", () => {
    expect(validateRedirectTo(null)).toBe("/");
  });

  it("returns '/' for undefined", () => {
    expect(validateRedirectTo(undefined)).toBe("/");
  });

  it("returns '/' for empty string", () => {
    expect(validateRedirectTo("")).toBe("/");
  });

  it("returns '/' for whitespace-only string", () => {
    expect(validateRedirectTo("   ")).toBe("/");
  });
});

describe("validateRedirectTo — relative paths (always safe)", () => {
  it("passes through a simple root-relative path", () => {
    expect(validateRedirectTo("/dashboard")).toBe("/dashboard");
  });

  it("passes through a path with a query string", () => {
    expect(validateRedirectTo("/login?next=foo")).toBe("/login?next=foo");
  });

  it("passes through a path with a hash", () => {
    expect(validateRedirectTo("/settings#linked-accounts")).toBe("/settings#linked-accounts");
  });

  it("returns '/' for the root '/'", () => {
    expect(validateRedirectTo("/")).toBe("/");
  });
});

describe("validateRedirectTo — protocol-relative and open-redirect vectors", () => {
  it("rejects protocol-relative '//evil.com'", () => {
    expect(validateRedirectTo("//evil.com")).toBe("/");
  });

  it("rejects '//evil.com/path'", () => {
    expect(validateRedirectTo("//evil.com/path")).toBe("/");
  });

  it("rejects path starting with double slash encoded as backslash '//\\evil.com'", () => {
    expect(validateRedirectTo("/\\/evil.com")).toBe("/");
  });
});

describe("validateRedirectTo — forbidden schemes", () => {
  it("rejects 'javascript:alert(1)'", () => {
    expect(validateRedirectTo("javascript:alert(1)")).toBe("/");
  });

  it("rejects 'data:text/html,<script>'", () => {
    expect(validateRedirectTo("data:text/html,<script>")).toBe("/");
  });

  it("rejects 'vbscript:...' style URLs", () => {
    expect(validateRedirectTo("vbscript:something")).toBe("/");
  });
});

describe("validateRedirectTo — same-origin absolute URL (BETTER_AUTH_URL set)", () => {
  it("accepts a same-origin URL and returns only the path", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://dashboard.example.com");
    expect(validateRedirectTo("https://dashboard.example.com/settings")).toBe("/settings");
  });

  it("accepts a same-origin URL with a query string, returns path+query", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://dashboard.example.com");
    expect(validateRedirectTo("https://dashboard.example.com/page?x=1")).toBe("/page?x=1");
  });

  it("accepts a same-origin URL with a fragment, returns path+hash", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://dashboard.example.com");
    expect(validateRedirectTo("https://dashboard.example.com/page#section")).toBe("/page#section");
  });
});

describe("validateRedirectTo — cross-origin rejection (BETTER_AUTH_URL set)", () => {
  it("rejects a different-domain absolute URL", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://dashboard.example.com");
    expect(validateRedirectTo("https://evil.com/steal")).toBe("/");
  });

  it("rejects a different subdomain", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://dashboard.example.com");
    expect(validateRedirectTo("https://evil.dashboard.example.com/")).toBe("/");
  });

  it("rejects same-host but different scheme (http vs https)", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://dashboard.example.com");
    expect(validateRedirectTo("http://dashboard.example.com/page")).toBe("/");
  });
});

describe("validateRedirectTo — no BETTER_AUTH_URL configured", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_URL", "");
  });

  it("still accepts relative paths", () => {
    expect(validateRedirectTo("/settings")).toBe("/settings");
  });

  it("rejects absolute URLs when origin is not configured", () => {
    expect(validateRedirectTo("https://dashboard.example.com/page")).toBe("/");
  });
});
