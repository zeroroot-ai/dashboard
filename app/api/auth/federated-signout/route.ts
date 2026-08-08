/**
 * Federated sign-out route.
 *
 * Auth.js's `signOut()` only clears the dashboard's own session cookie. Zitadel
 * keeps a parallel session cookie, so on the next visit to `/login`, the OIDC
 * `authorize` endpoint sees the still-active Zitadel session and silently
 * re-issues tokens, making it feel like sign-out never happened.
 *
 * Fix: after clearing the Auth.js cookie, redirect the browser to Zitadel's
 * `end_session_endpoint` with `id_token_hint` (the last-issued ID token) and a
 * `post_logout_redirect_uri` pointing back at our landing page. Zitadel then:
 *
 *  1. Validates the hint
 *  2. Kills its own session cookie on `auth.zeroroot.local`
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
 * the same source-of-truth value. This route sends the env verbatim, no path
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
import { signOut } from "@/auth";
import { ACTIVE_TENANT_COOKIE_NAME } from "@/src/lib/auth/active-tenant";
import { isSecureRequest } from "@/src/lib/csrf";
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

function clearActiveTenantCookie(req: NextRequest, res: NextResponse): void {
  // Mirror the attributes setActiveTenant uses when writing the cookie
  // (src/lib/auth/active-tenant.ts) so the browser accepts the overwrite.
  // Path=/ + sameSite=lax + httpOnly + Secure-when-the-request-is-https.
  //
  // The Secure flag tracks the REQUEST SCHEME, not NODE_ENV. Keying it to
  // NODE_ENV gets it wrong in both directions: a production image running with
  // NODE_ENV unset writes a non-Secure cookie over https, and a local https
  // run writes Secure=false. Worse for a clear, the browser matches the
  // overwrite against the original cookie's attributes, so a mismatched Secure
  // flag means the delete is silently dropped and the tenant scope survives
  // logout.
  res.cookies.set(ACTIVE_TENANT_COOKIE_NAME, "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
  });
}

/**
 * Cross-site request forgery guard for a navigation endpoint.
 *
 * This route mutates state (it destroys the user's dashboard AND IdP session),
 * so it must not be triggerable by another origin. It is reached by ordinary
 * navigations rather than by `fetch`, so the double-submit header token used
 * elsewhere is not available here: `window.location.href = ...` and
 * `<form method="post">` cannot attach an `x-csrf-token` header.
 *
 * Fetch metadata is the right mechanism for that shape. The browser sets these
 * headers itself and script cannot forge them:
 *
 *   - `Sec-Fetch-Site: cross-site`  -> another origin initiated it. Reject.
 *   - `Sec-Fetch-Dest` other than `document` -> the request came from a
 *     subresource load (`<img src=...>`, `<script src=...>`, `fetch`), never a
 *     real logout. Reject, this is the classic zero-click logout-CSRF vector.
 *   - `Sec-Fetch-Site: none` -> user typed the URL / used a bookmark. Allow.
 *
 * Legacy clients that send no fetch metadata fall back to an `Origin` check,
 * and an absent `Origin` on a top-level navigation is allowed (that is what a
 * user-initiated navigation looks like).
 */
function isCrossSiteRequest(req: NextRequest): boolean {
  const site = req.headers.get('sec-fetch-site');
  const dest = req.headers.get('sec-fetch-dest');

  if (site !== null) {
    if (site === 'cross-site') return true;
    // Only a real navigation may sign the user out. `empty` (fetch/XHR),
    // `image`, `script`, `iframe` etc. are all forgery vectors.
    if (dest !== null && dest !== 'document') return true;
    return false;
  }

  // No fetch metadata: fall back to Origin.
  const origin = req.headers.get('origin');
  if (origin === null) return false; // top-level navigation, no Origin sent
  try {
    return new URL(origin).origin !== req.nextUrl.origin;
  } catch {
    return true;
  }
}

async function handleSignout(req: NextRequest): Promise<NextResponse> {
  if (isCrossSiteRequest(req)) {
    logger.warn(
      {
        route: 'auth/federated-signout',
        secFetchSite: req.headers.get('sec-fetch-site'),
        secFetchDest: req.headers.get('sec-fetch-dest'),
      },
      'rejected cross-site sign-out attempt',
    );
    return NextResponse.json({ error: 'cross_site_request' }, { status: 403 });
  }

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
      "POST_LOGOUT_REDIRECT_URI env is unset, dashboard cannot complete RP-initiated logout. Check helm/gibson-workloads dashboard.auth.postLogoutRedirectURIs",
    );
    return NextResponse.json(
      { error: "logout_misconfigured" },
      { status: 500 },
    );
  }

  // Zitadel needs to resolve the RP for the end_session call. Two shapes are
  // accepted: `id_token_hint` (resolved via the aud claim) or `client_id`.
  //
  // We deliberately use client_id ONLY. `id_token_hint` would put the raw ID
  // token, a signed bearer credential carrying the user's identity claims,
  // into a URL the browser navigates to. URLs are not a safe place for
  // credentials: they land in browser history, in the `Referer` sent onward
  // from the post-logout landing page, in any intermediary access log, and in
  // the address bar over the user's shoulder. client_id carries no secret and
  // drives the same RP-initiated logout.
  if (!clientId) {
    logger.error(
      { route: "auth/federated-signout" },
      "ZITADEL_CLIENT_ID env is unset, cannot drive RP-initiated logout. Check helm/gibson-workloads dashboard ZITADEL_CLIENT_ID wiring.",
    );
    return NextResponse.json(
      { error: "logout_misconfigured" },
      { status: 500 },
    );
  }

  // Clear the Auth.js session cookie first. Pass redirect: false so we own
  // the final redirect (to Zitadel's end_session_endpoint), not Auth.js.
  await signOut({ redirect: false });

  // ALWAYS redirect through Zitadel's end_session, without it, Zitadel's
  // SSO cookie remains and silently re-authenticates the user on the next
  // /login. Only client_id is sent, never the ID token, see above.
  // ZITADEL_ISSUER is REQUIRED at boot (src/lib/env-validator.ts), no fallback.
  const zitadelIssuer = (await import("@/src/lib/env-validator")).env.ZITADEL_ISSUER;
  const endSession = new URL(`${zitadelIssuer}/oidc/v1/end_session`);
  endSession.searchParams.set("client_id", clientId);
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
  clearActiveTenantCookie(req, res);
  return res;
}

/**
 * POST is the correct method for a sign-out: it mutates state. The sign-out
 * forms in `no-workspace/page.tsx` and `onboarding/page.tsx` use it.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleSignout(req);
}

/**
 * GET is still accepted because the primary logout affordances navigate to
 * this route (`window.location.href = "/api/auth/federated-signout"` in the
 * sidebar and header user menus) and middleware redirects tenantless sessions
 * here. Both are same-origin navigations.
 *
 * The forgery risk that normally makes a state-changing GET unacceptable is
 * closed by `isCrossSiteRequest`: a cross-origin page cannot produce a request
 * with `Sec-Fetch-Site: same-origin`, and the zero-click subresource vectors
 * (`<img>`, `<script>`, `fetch`) are rejected on `Sec-Fetch-Dest`.
 *
 * Follow-up: once the two `window.location.href` call sites and the middleware
 * redirect are converted to POST, delete this handler and let the route be
 * POST-only.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return handleSignout(req);
}
