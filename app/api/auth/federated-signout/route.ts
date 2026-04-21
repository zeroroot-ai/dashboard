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

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const idToken = session?.idToken;

  // Compute the absolute post-logout redirect URL from AUTH_URL / the
  // request's own origin so it matches what was registered with Zitadel.
  const postLogoutRedirectUri = new URL(
    POST_LOGOUT_REDIRECT_PATH,
    process.env.AUTH_URL ?? req.nextUrl.origin,
  ).toString();

  // Clear the Auth.js session cookie first. Pass redirect: false so we own
  // the final redirect (to Zitadel's end_session_endpoint), not Auth.js.
  await signOut({ redirect: false });

  // If we never captured an ID token (e.g., stale cookie / JWT predates the
  // idToken claim), there's nothing to hint with — just drop them on the
  // landing page.
  if (!idToken) {
    return NextResponse.redirect(postLogoutRedirectUri);
  }

  const endSession = new URL(`${ZITADEL_ISSUER}/oidc/v1/end_session`);
  endSession.searchParams.set("id_token_hint", idToken);
  endSession.searchParams.set(
    "post_logout_redirect_uri",
    postLogoutRedirectUri,
  );

  return NextResponse.redirect(endSession.toString());
}

// Accept POST too — the sign-out form in no-workspace/page.tsx posts rather
// than GETs, and this route should handle either method identically.
export const POST = GET;
