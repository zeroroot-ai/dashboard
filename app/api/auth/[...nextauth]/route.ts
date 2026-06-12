/**
 * Auth.js v5 route handler.
 *
 * Exposes the GET and POST handlers that Auth.js needs to handle OIDC
 * callbacks, sign-in initiations, and sign-out flows. The wildcard segment
 * ([...nextauth]) matches:
 *   GET  /api/auth/callback/zitadel , OIDC code→token exchange callback
 *   GET  /api/auth/signin           , sign-in page redirect
 *   GET  /api/auth/signout          , sign-out page redirect
 *   POST /api/auth/signin/zitadel   , form-based sign-in initiation
 *   POST /api/auth/signout          , sign-out action
 *   GET  /api/auth/session          , session JSON (used by Auth.js internals)
 *   GET  /api/auth/csrf             , CSRF token endpoint
 *
 * This route must remain public (excluded from the middleware matcher) so that
 * Auth.js can complete the OIDC callback without requiring a pre-existing
 * session. The middleware.ts matcher already excludes `api/auth/*`.
 *
 * No custom logic here, all session shaping, claim forwarding, and
 * authorization callbacks live in auth.ts.
 *
 * IMPORTANT: the GET handler wraps handlers.GET to sanitize incoming OIDC
 * callback URLs before Auth.js processes them. See sanitizeCallbackUrl below.
 */

import { handlers } from "@/auth";
import { NextRequest } from "next/server";

/**
 * Re-encodes literal '+' in the URL query string as '%2B' before Auth.js
 * parses it.
 *
 * Root cause (dashboard#<filed below>): Zitadel v4 includes auth codes in
 * callback URLs using standard base64 encoding (RFC 4648), which uses '+' and
 * '/' as the 62nd and 63rd characters. Zitadel does not percent-encode these
 * in the redirect Location / callbackUrl. When the browser follows the
 * redirect and the server receives the request, @auth/core builds
 * `request.query` via `Object.fromEntries(url.searchParams)`. The WHATWG URL
 * spec mandates that URLSearchParams decodes '+' as ' ' (space), so any auth
 * code containing '+' arrives at Auth.js with a space at that position.
 *
 * Auth.js passes the corrupted code to Zitadel's token endpoint.  Zitadel
 * tries to base64-decode it and fails:
 *   Errors.User.Code.Invalid (OIDC-ahLi2), err.parent="illegal base64 data
 *   at input byte N"
 *
 * This is intermittent: a 12-byte auth code encoded in standard base64 has a
 * ~40% probability of containing at least one '+' character, so roughly two
 * out of five login attempts fail.
 *
 * Fix: replace bare '+' with '%2B' in the query string before handing the
 * request to Auth.js.  '+' in OIDC code/state/pkce parameters is always a
 * base64 character, never a legitimate application/x-www-form-urlencoded
 * space.  '%2B' round-trips through URLSearchParams correctly as '+'.
 *
 * This function is O(|query string|) and allocates only when '+' is present.
 */
function sanitizeCallbackUrl(req: NextRequest): NextRequest {
  if (!req.url.includes("+")) return req;
  const qi = req.url.indexOf("?");
  if (qi === -1) return req;
  const sanitized =
    req.url.slice(0, qi) + "?" + req.url.slice(qi + 1).replace(/\+/g, "%2B");
  return new NextRequest(sanitized, req);
}

export function GET(req: NextRequest) {
  return handlers.GET(sanitizeCallbackUrl(req));
}

export const POST = handlers.POST;
