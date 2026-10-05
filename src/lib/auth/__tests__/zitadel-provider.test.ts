// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI
// @vitest-environment node
// Auth.js encrypts its cookies with jose, which needs the Node realm's
// Uint8Array. The jsdom realm has its own and jose refuses it.

/**
 * Drives the real Auth.js sign-in and callback against the Zitadel provider
 * (dashboard#88, ADR-0092), with every outbound request intercepted.
 *
 * It proves the two halves of the split:
 *
 *   - The URL the BROWSER follows is on the public issuer, and the callback
 *     URL it carries is on the public app origin.
 *   - Every request the POD makes goes to the in-cluster connect base with
 *     the instance header. A request to any public name fails the test.
 */

import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { zitadelProvider } from "../zitadel-provider";

const ISSUER = "https://app.example.test";
const CONNECT = "http://gibson-zitadel:8080";
const APP = "https://app.example.test";

// `@auth/core` is the engine under next-auth. It is not a direct dependency,
// so it is resolved from next-auth, the way next-auth itself loads it.
type AuthFn = (req: Request, config: Record<string, unknown>) => Promise<Response>;
async function loadAuth(): Promise<AuthFn> {
  const require = createRequire(import.meta.url);
  const fromNextAuth = createRequire(require.resolve("next-auth"));
  const mod = (await import(fromNextAuth.resolve("@auth/core"))) as { Auth: AuthFn };
  return mod.Auth;
}

function config() {
  return {
    trustHost: true,
    secret: "test-secret-32-bytes-of-padding-aaaaaaaa",
    basePath: "/api/auth",
    session: { strategy: "jwt" },
    providers: [
      zitadelProvider({
        issuer: ISSUER,
        connectBase: CONNECT,
        clientId: "dashboard-client",
        clientSecret: "dashboard-secret",
      }),
    ],
  };
}

interface Outbound {
  url: string;
  headers: Headers;
}

function interceptFetch(respond: (url: string) => Response) {
  const calls: Outbound[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push({ url, headers: new Headers(init?.headers) });
      return respond(url);
    }),
  );
  return calls;
}

function cookieHeader(res: Response, prior = ""): string {
  const jar = new Map<string, string>();
  for (const part of prior.split("; ").filter(Boolean)) {
    const i = part.indexOf("=");
    jar.set(part.slice(0, i), part.slice(i + 1));
  }
  for (const set of res.headers.getSetCookie()) {
    const pair = set.split(";")[0];
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    ZITADEL_URL: CONNECT,
    ZITADEL_EXTERNAL_DOMAIN: "app.example.test",
    ZITADEL_ISSUER: ISSUER,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

async function signIn(Auth: AuthFn) {
  const csrfRes = await Auth(new Request(`${APP}/api/auth/csrf`), config());
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const cookies = cookieHeader(csrfRes);
  const res = await Auth(
    new Request(`${APP}/api/auth/signin/zitadel`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies },
      body: new URLSearchParams({ csrfToken, callbackUrl: `${APP}/` }),
    }),
    config(),
  );
  return { res, cookies: cookieHeader(res, cookies) };
}

describe("zitadelProvider", () => {
  it("sends the browser to the public issuer and makes no server-side request", async () => {
    const Auth = await loadAuth();
    const calls = interceptFetch(() => new Response("unexpected", { status: 500 }));

    const { res } = await signIn(Auth);

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    // The browser follows this URL, so it is public.
    expect(location.origin).toBe(ISSUER);
    expect(location.pathname).toBe("/oauth/v2/authorize");
    // Zitadel sends the browser back here, so it is public too.
    expect(location.searchParams.get("redirect_uri")).toBe(`${APP}/api/auth/callback/zitadel`);
    expect(location.searchParams.get("scope")).toContain("urn:zitadel:iam:user:resourceowner");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    // No discovery: a discovery request is a server-side call to the issuer.
    expect(calls).toEqual([]);
  });

  it("exchanges the code on the connect base with the instance header, and dials no public name", async () => {
    const Auth = await loadAuth();
    const now = Math.floor(Date.now() / 1000);
    const idToken = [
      b64url({ alg: "RS256", typ: "JWT" }),
      b64url({ iss: ISSUER, aud: "dashboard-client", sub: "user-1", iat: now, exp: now + 600, name: "Ada" }),
      "c2lnbmF0dXJl",
    ].join(".");
    const calls = interceptFetch((url) => {
      if (url === `${CONNECT}/oauth/v2/token`) {
        return new Response(
          JSON.stringify({ access_token: "at-1", token_type: "Bearer", expires_in: 600, id_token: idToken }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    const { res: signInRes, cookies } = await signIn(Auth);
    const state = new URL(signInRes.headers.get("location") ?? "").searchParams.get("state") ?? "";

    const callbackRes = await Auth(
      new Request(`${APP}/api/auth/callback/zitadel?code=code-1&state=${encodeURIComponent(state)}`, {
        headers: { cookie: cookies },
      }),
      config(),
    );

    // The sign-in completed: a session cookie is set and the browser goes
    // back to the app.
    expect(callbackRes.status).toBe(302);
    expect(new URL(callbackRes.headers.get("location") ?? "").origin).toBe(APP);
    expect(callbackRes.headers.getSetCookie().some((c) => /session-token=/.test(c))).toBe(true);

    // Every server-side request went to the Service name with the header.
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(new URL(call.url).origin).toBe(CONNECT);
      expect(call.headers.get("x-zitadel-instance-host")).toBe("app.example.test");
    }
    expect(calls.map((c) => c.url)).toContain(`${CONNECT}/oauth/v2/token`);
  });

  it("fails the sign-in when an endpoint points at a public name", async () => {
    const Auth = await loadAuth();
    const calls = interceptFetch(() => new Response("{}", { status: 200 }));
    // The defect this guards: the token endpoint on the issuer, as before.
    const broken = () => ({
      ...config(),
      providers: [
        zitadelProvider({
          issuer: ISSUER,
          connectBase: ISSUER,
          clientId: "dashboard-client",
          clientSecret: "dashboard-secret",
        }),
      ],
    });

    const csrfRes = await Auth(new Request(`${APP}/api/auth/csrf`), broken());
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    let cookies = cookieHeader(csrfRes);
    const signInRes = await Auth(
      new Request(`${APP}/api/auth/signin/zitadel`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookies },
        body: new URLSearchParams({ csrfToken, callbackUrl: `${APP}/` }),
      }),
      broken(),
    );
    cookies = cookieHeader(signInRes, cookies);
    const state = new URL(signInRes.headers.get("location") ?? "").searchParams.get("state") ?? "";

    const callbackRes = await Auth(
      new Request(`${APP}/api/auth/callback/zitadel?code=code-1&state=${encodeURIComponent(state)}`, {
        headers: { cookie: cookies },
      }),
      broken(),
    );

    // zitadelFetch refused the public origin, so nothing reached the network
    // and Auth.js sent the browser to its error page with no session.
    expect(calls).toEqual([]);
    expect(callbackRes.headers.getSetCookie().some((c) => /session-token=[^;]+\./.test(c))).toBe(false);
    expect(callbackRes.headers.get("location") ?? "").toMatch(/error/);
  });
});
