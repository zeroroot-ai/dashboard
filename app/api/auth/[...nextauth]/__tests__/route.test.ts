/**
 * @vitest-environment node
 *
 * Unit tests for the Auth.js catch-all route handler at
 * app/api/auth/[...nextauth]/route.ts.
 *
 * Focus (dashboard#818, security audit): the GET handler must strip the
 * server-only Zitadel credentials (`accessToken`, `idToken`) from the
 * public `GET /api/auth/session` JSON response so they never reach the
 * browser, while leaving every other Auth.js endpoint untouched.
 *
 * The session callback (auth.ts) intentionally attaches these tokens for
 * SERVER-SIDE consumers (user-token.ts, middleware.ts, federated-signout),
 * which read them via in-process `auth()` and never via this HTTP route.
 * The route-level strip is the actual redaction for the wire response.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mock the Auth.js handlers. handlers.GET returns whatever the underlying
// Auth.js endpoint would return; we drive it per-test.
// ---------------------------------------------------------------------------
const mockHandlersGet = vi.fn();
const mockHandlersPost = vi.fn();

vi.mock("@/auth", () => ({
  handlers: {
    GET: (req: unknown) => mockHandlersGet(req),
    POST: (req: unknown) => mockHandlersPost(req),
  },
}));

import { GET } from "../route";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("auth route GET — session token stripping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips accessToken and idToken from /api/auth/session", async () => {
    mockHandlersGet.mockResolvedValue(
      jsonResponse({
        user: { id: "u1", email: "a@b.co" },
        accessToken: "header.payload.sig",
        idToken: "id.header.payload",
        expires: "2099-01-01T00:00:00.000Z",
      }),
    );

    const res = await GET(
      new NextRequest("https://app.example.com/api/auth/session"),
    );
    const body = await res.json();

    expect(body).not.toHaveProperty("accessToken");
    expect(body).not.toHaveProperty("idToken");
    // Non-secret session shape survives.
    expect(body.user).toEqual({ id: "u1", email: "a@b.co" });
    expect(body.expires).toBe("2099-01-01T00:00:00.000Z");
  });

  it("leaves an unauthenticated empty session ({}) untouched", async () => {
    mockHandlersGet.mockResolvedValue(jsonResponse({}));

    const res = await GET(
      new NextRequest("https://app.example.com/api/auth/session"),
    );
    expect(await res.json()).toEqual({});
  });

  it("does not touch non-session Auth.js endpoints (e.g. /csrf)", async () => {
    const original = jsonResponse({ csrfToken: "abc123" });
    mockHandlersGet.mockResolvedValue(original);

    const res = await GET(
      new NextRequest("https://app.example.com/api/auth/csrf"),
    );
    // Returned verbatim (same instance) — no re-serialisation.
    expect(res).toBe(original);
    expect(await res.json()).toEqual({ csrfToken: "abc123" });
  });

  it("passes redirect responses (OIDC callback) through unchanged", async () => {
    const redirect = new Response(null, {
      status: 302,
      headers: { location: "https://app.example.com/dashboard" },
    });
    mockHandlersGet.mockResolvedValue(redirect);

    const res = await GET(
      new NextRequest("https://app.example.com/api/auth/callback/zitadel"),
    );
    expect(res).toBe(redirect);
    expect(res.status).toBe(302);
  });

  it("preserves the '+' → '%2B' callback-url sanitisation", async () => {
    mockHandlersGet.mockResolvedValue(jsonResponse({}));

    await GET(
      new NextRequest(
        "https://app.example.com/api/auth/callback/zitadel?code=a+b/c",
      ),
    );

    const passedReq = mockHandlersGet.mock.calls[0]?.[0] as NextRequest;
    expect(passedReq.url).toContain("code=a%2Bb/c");
  });
});
