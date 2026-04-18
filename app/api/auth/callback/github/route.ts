/**
 * GitHub OAuth2 callback route.
 *
 * This is the sole exception to the "no public auth HTTP surface" rule —
 * OAuth2 callback URLs must be HTTP endpoints that receive the provider's
 * redirect. Better Auth handles the token exchange, user creation/linking,
 * session cookie, and final redirect.
 *
 * Missing-email handling (GitHub private-email case):
 *   GitHub users with private email settings return no email from the OAuth
 *   callback. After auth.handler processes the callback, this route checks
 *   whether the created/linked session belongs to a user with no email. If
 *   so it generates a 15-minute HMAC-signed nonce and redirects the browser
 *   to /signin/provide-email?token=<nonce> so the user can supply a verified
 *   email address before being admitted to the dashboard.
 *
 * Allowed by: scripts/check-no-public-auth.mjs (explicit allowlist).
 * Whitelisted redirect URI at GitHub: {BETTER_AUTH_URL}/api/auth/callback/github
 */

import { auth } from "@/src/lib/auth-server";
import { generateProvideEmailNonce } from "@/src/lib/auth/provide-email-nonce";
import type { NextRequest } from "next/server";

/**
 * Extract the session from the response cookies Better Auth set on the
 * outgoing response after handling the callback. We use the session to
 * inspect the user's email field.
 *
 * Better Auth sets a cookie named `gibson.session_token` (or similar) on
 * the response. Rather than parse the cookie ourselves, we make a lightweight
 * getSession call forwarding the response's Set-Cookie headers.
 *
 * Returns the user object from the session, or null if unavailable.
 */
async function getUserFromCallbackResponse(
  response: Response,
): Promise<{ id: string; name: string; email: string | null | undefined } | null> {
  try {
    // Collect the Set-Cookie headers from the auth.handler response.
    const setCookieHeader = response.headers.get("set-cookie") ?? "";
    if (!setCookieHeader) return null;

    // Build a fake request that carries the new session cookies so getSession
    // can read the session from the DB.
    const sessionResponse = await auth.api.getSession({
      headers: new Headers({ cookie: setCookieHeader }),
    });
    if (!sessionResponse?.user) return null;
    return sessionResponse.user as { id: string; name: string; email: string | null | undefined };
  } catch {
    return null;
  }
}

async function handleCallback(request: NextRequest): Promise<Response> {
  // Let Better Auth complete the OAuth2 token exchange, user creation, and
  // session cookie setup first.
  const response = await auth.handler(request);

  // Only intercept successful redirects (3xx with a session cookie set).
  // For errors, let Better Auth's own error redirect flow pass through.
  if (!response.ok && response.status < 300) return response;
  if (response.status >= 400) return response;

  // Check whether the newly-created/linked user is missing an email.
  const user = await getUserFromCallbackResponse(response);
  if (!user || (user.email && user.email.trim().length > 0)) {
    // Email is present — normal happy path.
    return response;
  }

  // User has no email — GitHub private-email case.
  // Generate a signed nonce and redirect to the provide-email page.
  let nonce: string;
  try {
    nonce = generateProvideEmailNonce(user.id, user.name ?? "");
  } catch {
    // If nonce generation fails (e.g. BETTER_AUTH_SECRET missing), fall
    // through to the normal response — the user will hit the dashboard
    // empty-email guard on their next request.
    return response;
  }

  const baseUrl = process.env.BETTER_AUTH_URL ?? "";
  const redirectUrl = `${baseUrl}/signin/provide-email?token=${encodeURIComponent(nonce)}`;

  // Clone the response headers (including the session cookie Set-Cookie) so
  // the browser is signed in but immediately redirected to provide an email.
  const redirectResponse = Response.redirect(redirectUrl, 302);
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      redirectResponse.headers.append("set-cookie", value);
    }
  });
  return redirectResponse;
}

export async function GET(request: NextRequest): Promise<Response> {
  return handleCallback(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return handleCallback(request);
}
