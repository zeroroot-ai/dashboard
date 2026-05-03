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
 * The `post_logout_redirect_uri` must be pre-registered on the OIDC client —
 * the Zitadel bootstrap Job registers `https://<dashboard-host>/` and
 * `http://localhost:3000/` for exactly this purpose.
 *
 * Why this lives at a custom path rather than as a middleware hook on
 * next-auth's `/api/auth/signout`: Auth.js's built-in `signOut` server action
 * doesn't expose hooks to inject a downstream redirect, and its response is
 * already committed by the time user code runs.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth, signOut } from "@/auth";

const ZITADEL_ISSUER =
  process.env.ZITADEL_ISSUER ?? "https://auth.zero-day.local";
const POST_LOGOUT_REDIRECT_PATH = "/";

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

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const idToken = session?.idToken;
  const clientId = process.env.ZITADEL_DASHBOARD_CLIENT_ID;

  // Compute the absolute post-logout redirect URL from AUTH_URL / the
  // request's own origin so it matches what was registered with Zitadel.
  const postLogoutRedirectUri = new URL(
    POST_LOGOUT_REDIRECT_PATH,
    process.env.AUTH_URL ?? req.nextUrl.origin,
  ).toString();

  // Clear the Auth.js session cookie first. Pass redirect: false so we own
  // the final redirect (to Zitadel's end_session_endpoint), not Auth.js.
  await signOut({ redirect: false });

  // ALWAYS redirect through Zitadel's end_session — without it, Zitadel's
  // SSO cookie remains and silently re-authenticates the user on the next
  // /login. id_token_hint is the preferred shape; client_id is the documented
  // fallback when the hint is unavailable.
  const endSession = new URL(`${ZITADEL_ISSUER}/oidc/v1/end_session`);
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
  return res;
}

// Accept POST too — the sign-out form in no-workspace/page.tsx posts rather
// than GETs, and this route should handle either method identically.
export const POST = GET;
