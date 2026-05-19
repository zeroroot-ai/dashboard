/**
 * Tests for resolvePostSignInRedirect — the Auth.js `redirect()` callback's
 * core logic, extracted as a pure function (dashboard#228).
 */

import { describe, expect, it } from "vitest";
import { resolvePostSignInRedirect } from "../post-signin-redirect";

const BASE = "https://app.zero-day.local:30443";

describe("resolvePostSignInRedirect — default to /dashboard", () => {
  it("falls back to /dashboard when url is the bare baseUrl", () => {
    expect(resolvePostSignInRedirect(BASE, BASE)).toBe(`${BASE}/dashboard`);
  });

  it("falls back to /dashboard when url is just '/'", () => {
    expect(resolvePostSignInRedirect("/", BASE)).toBe(`${BASE}/dashboard`);
  });

  it("falls back to /dashboard when url is undefined", () => {
    expect(resolvePostSignInRedirect(undefined, BASE)).toBe(
      `${BASE}/dashboard`,
    );
  });

  it("falls back to /dashboard when url is null", () => {
    expect(resolvePostSignInRedirect(null, BASE)).toBe(`${BASE}/dashboard`);
  });

  it("falls back to /dashboard when url is an empty string", () => {
    expect(resolvePostSignInRedirect("", BASE)).toBe(`${BASE}/dashboard`);
  });

  it("falls back to /dashboard when same-origin URL has an empty path", () => {
    expect(resolvePostSignInRedirect(`${BASE}/`, BASE)).toBe(
      `${BASE}/dashboard`,
    );
  });
});

describe("resolvePostSignInRedirect — preserves intentional deep links", () => {
  it("preserves a relative deep-link path", () => {
    expect(
      resolvePostSignInRedirect("/dashboard/pages/findings", BASE),
    ).toBe(`${BASE}/dashboard/pages/findings`);
  });

  it("preserves a relative path with a query string", () => {
    expect(
      resolvePostSignInRedirect("/dashboard?tab=overview", BASE),
    ).toBe(`${BASE}/dashboard?tab=overview`);
  });

  it("preserves the canonical /dashboard target", () => {
    expect(resolvePostSignInRedirect("/dashboard", BASE)).toBe(
      `${BASE}/dashboard`,
    );
  });

  it("normalises a same-origin absolute URL to its path", () => {
    expect(
      resolvePostSignInRedirect(`${BASE}/dashboard/pages/missions`, BASE),
    ).toBe(`${BASE}/dashboard/pages/missions`);
  });

  it("preserves search params on a same-origin absolute URL", () => {
    expect(
      resolvePostSignInRedirect(
        `${BASE}/dashboard/pages/missions?id=42`,
        BASE,
      ),
    ).toBe(`${BASE}/dashboard/pages/missions?id=42`);
  });
});

describe("resolvePostSignInRedirect — rejects open-redirect attempts", () => {
  it("rejects cross-origin absolute URLs", () => {
    expect(
      resolvePostSignInRedirect("https://evil.example.com/x", BASE),
    ).toBe(`${BASE}/dashboard`);
  });

  it("rejects protocol-relative URLs (open-redirect via //evil.com/x)", () => {
    expect(resolvePostSignInRedirect("//evil.example.com/x", BASE)).toBe(
      `${BASE}/dashboard`,
    );
  });

  it("rejects unparseable URLs", () => {
    expect(resolvePostSignInRedirect("not a url", BASE)).toBe(
      `${BASE}/dashboard`,
    );
  });

  it("rejects javascript: scheme", () => {
    expect(
      resolvePostSignInRedirect("javascript:alert(1)", BASE),
    ).toBe(`${BASE}/dashboard`);
  });

  it("rejects data: scheme", () => {
    expect(
      resolvePostSignInRedirect("data:text/html,<script>1</script>", BASE),
    ).toBe(`${BASE}/dashboard`);
  });

  it("rejects non-string input (number)", () => {
    expect(resolvePostSignInRedirect(42, BASE)).toBe(`${BASE}/dashboard`);
  });
});
