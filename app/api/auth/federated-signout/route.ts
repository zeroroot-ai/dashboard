/**
 * Federated sign-out route.
 *
 * Auth.js's `signOut()` only clears the dashboard's own session cookie. Zitadel
 * keeps a parallel session cookie — so on the next visit to `/login`, the OIDC
 * `authorize` endpoint sees the still-active Zitadel session and silently
 * re-issues tokens, making it feel like sign-out never happened.
 *
 * Fix: after clearing the Auth.js cookie, redirect the browser to Zitadel's
 * `end_session_endpoint` with `id_token_hint` (the last-issued ID token) and a
 * `post_logout_redirect_uri` pointing back at our landing page. Zitadel then:
 *
 *  1. Validates the hint
 *  2. Kills its own session cookie on `auth.zero-day.local`
 *  3. Redirects the browser back to our post_logout URL
 *
 * Multi-tenant note: Zitadel maintains one SSO session per user, not one per
 * tenant. RP-initiated `end_session` terminates that single session globally,
 * which is the intended logout-from-all-tenants behavior. The dashboard-side
 * tenant-scope cookie (`gibson_active_tenant`) is cleared on this response too
 * so the next sign-in re-runs default-tenant resolution / picker logic rather
 * than auto-routing the user back into the tenant they had selected at logout
 * time.
 *
 * The `post_logout_redirect_uri` MUST be pre-registered on the Zitadel OIDC
 * client byte-for-byte. The chart owns both sides of that contract: the
 * `gibson-dashboard` OIDC client registration (gibson-operators chart) and the
 * `POST_LOGOUT_REDIRECT_URI` env on this pod (gibson-workloads chart) read from
 * the same source-of-truth value. This route sends the env verbatim — no path
 * append, no origin synthesis from `req.nextUrl.origin`. The previous shape
 * appended a trailing slash and silently drifted from the registration, which
 * Zitadel rejected with `invalid_request / post_logout_redirect_uri invalid`.
 *
 * Why this lives at a custom path rather than as a middleware hook on
 * next-auth's `/api/auth/signout`: Auth.js's built-in `signOut` server action
 * doesn't expose hooks to inject a downstream redirect, and its response is
 * already committed by the time user code runs.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth, signOut } from "@/auth";
import { ACTIVE_TENANT_COOKIE_NAME } from "@/src/lib/auth/active-tenant";
import { logger } from "@/src/lib/logger";

// Auth.js v5 cookie names. Names differ in production (Secure cookie prefix)
// vs. development (no prefix). We clear both forms defensively.
//
// For `__Secure-` and `__Host-` prefixed cookies the browser REQUIRES the
// Set-Cookie header that overwrites them to include the matching `Secure`
// attribute (and for `__Host-`, no Domain + Path=/). Without it, the browser
// silently rejects the overwrite and the session cookie survives.
const AUTHJS_COOKIES: ReadonlyArray<{
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none";
}> = [
  { name: "__Secure-authjs.session-token", secure: true, httpOnly: true, sameSite: "lax" },
  { name: "authjs.session-token", secure: false, httpOnly: true, sameSite: "lax" },
  { name: "__Host-authjs.csrf-token", secure: true, httpOnly: true, sameSite: "lax" },
  { name: "authjs.csrf-token", secure: false, httpOnly: true, sameSite: "lax" },
  { name: "__Secure-authjs.callback-url", secure: true, httpOnly: true, sameSite: "lax" },
  { name: "authjs.callback-url", secure: false, httpOnly: true, sameSite: "lax" },
];

function clearAuthCookies(res: NextResponse): void {
  for (const c of AUTHJS_COOKIES) {
    res.cookies.set(c.name, "", {
      maxAge: 0,
      path: "/",
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      // __Host- prefix forbids Domain attribute; __Secure- and unprefixed
      // cookies don't need one when omitted (the cookie binds to the host
      // that set it, which is what we want).
    });
  }
}

function clearActiveTenantCookie(res: NextResponse): void {
  // Mirror the attributes setActiveTenant uses when writing the cookie
  // (src/lib/auth/active-tenant.ts) so the browser accepts the overwrite.
  // Path=/ + sameSite=lax + httpOnly + secure-in-production.
  res.cookies.set(ACTIVE_TENANT_COOKIE_NAME, "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const idToken = session?.idToken;

  // The user-flow OIDC client (gibson-dashboard, registered as an
  // authorization-code App in Zitadel). This is the client whose
  // postLogoutRedirectURIs the chart registers; sending end_session
  // with any other client_id (notably ZITADEL_DASHBOARD_CLIENT_ID,
  // which points at the gibson-dashboard-service MACHINE_USER for
  // s2s client_credentials and has zero postLogoutRedirectURIs)
  // makes Zitadel reject with `invalid_request /
  // post_logout_redirect_uri invalid`. See dashboard#76.
  const clientId = process.env.ZITADEL_CLIENT_ID;

  // The exact URI Zitadel has registered for this OIDC client. The chart
  // (gibson-workloads dashboard.auth.postLogoutRedirectURIs) projects the
  // first registered URI into this env verbatim, and the gibson-operators
  // chart registers the same list on the OIDC client. Sending anything
  // else (origin synthesis, path append, trailing-slash drift) makes
  // Zitadel reject the logout with `invalid_request`.
  const postLogoutRedirectUri = process.env.POST_LOGOUT_REDIRECT_URI;
  if (!postLogoutRedirectUri) {
    logger.error(
      { route: "auth/federated-signout" },
      "POST_LOGOUT_REDIRECT_URI env is unset — dashboard cannot complete RP-initiated logout. Check helm/gibson-workloads dashboard.auth.postLogoutRedirectURIs",
    );
    return NextResponse.json(
      { error: "logout_misconfigured" },
      { status: 500 },
    );
  }

  // We need EITHER an id_token_hint OR a client_id for Zitadel to
  // accept the end_session call. id_token_hint is preferred (Zitadel
  // resolves the client by aud claim); client_id is the documented
  // fallback for sessions that have lost the id_token (refresh
  // cycles, JWT-shape changes, etc.). If neither is available we
  // can't drive a real RP-initiated logout — fail loud rather than
  // silently sending an unauthenticated end_session that Zitadel
  // would reject anyway.
  if (!idToken && !clientId) {
    logger.error(
      { route: "auth/federated-signout" },
      "ZITADEL_CLIENT_ID env is unset AND session has no idToken — cannot drive RP-initiated logout. Check helm/gibson-workloads dashboard ZITADEL_CLIENT_ID wiring.",
    );
    return NextResponse.json(
      { error: "logout_misconfigured" },
      { status: 500 },
    );
  }

  // Clear the Auth.js session cookie first. Pass redirect: false so we own
  // the final redirect (to Zitadel's end_session_endpoint), not Auth.js.
  await signOut({ redirect: false });

  // ALWAYS redirect through Zitadel's end_session — without it, Zitadel's
  // SSO cookie remains and silently re-authenticates the user on the next
  // /login. id_token_hint is the preferred shape; client_id is the documented
  // fallback when the hint is unavailable.
  // ZITADEL_ISSUER is REQUIRED at boot (src/lib/env-validator.ts) — no fallback.
  const zitadelIssuer = (await import("@/src/lib/env-validator")).env.ZITADEL_ISSUER;
  const endSession = new URL(`${zitadelIssuer}/oidc/v1/end_session`);
  if (idToken) {
    endSession.searchParams.set("id_token_hint", idToken);
  } else if (clientId) {
    endSession.searchParams.set("client_id", clientId);
  }
  endSession.searchParams.set(
    "post_logout_redirect_uri",
    postLogoutRedirectUri,
  );

  const res = NextResponse.redirect(endSession.toString());
  // Belt-and-suspenders: explicitly expire every Auth.js cookie shape on the
  // response. signOut() should do this, but observed behaviour is that the
  // session cookie occasionally survives the call when redirect: false is set,
  // letting middleware see a still-valid JWT on the next request and bouncing
  // the user straight back into /dashboard.
  clearAuthCookies(res);
  // Multi-tenant: also drop the active-tenant cookie so the next sign-in
  // runs default-tenant resolution / picker afresh, not auto-routing the
  // user back into the tenant they were viewing at logout time.
  clearActiveTenantCookie(res);
  return res;
}

// Accept POST too — the sign-out form in no-workspace/page.tsx posts rather
// than GETs, and this route should handle either method identically.
export const POST = GET;
