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
import { NextRequest, NextResponse } from "next/server";

/**
 * Fields that the Auth.js `session` callback (auth.ts) attaches for
 * SERVER-SIDE consumers only and that must NEVER cross the wire to the
 * browser. These are raw Zitadel bearer credentials:
 *
 *   - accessToken , a valid `Authorization: Bearer` against Envoy/the daemon
 *                   (src/lib/auth/user-token.ts, middleware.ts, mySessions.ts).
 *   - idToken     , the `id_token_hint` for federated logout
 *                   (app/api/auth/federated-signout/route.ts).
 *
 * Auth.js v5 with `session.strategy: "jwt"` serialises whatever the `session`
 * callback returns into the public `GET /api/auth/session` response body and
 * the client-side next-auth cache (SessionProvider / useSession). Server-side
 * `auth()` / getServerSession() invoke the callback IN-PROCESS and never hit
 * this HTTP route, so stripping the tokens here keeps every server consumer
 * working while denying the browser access to the raw credentials
 * (dashboard#818). The session-client.ts shim narrows the shape client-side,
 * but only AFTER the JSON has already crossed the wire, so it is cosmetic, not
 * a redaction. This filter is the actual redaction.
 */
const SESSION_SERVER_ONLY_FIELDS = ["accessToken", "idToken"] as const;

/**
 * Strip server-only token fields from a `GET /api/auth/session` JSON response
 * before it reaches the browser. Returns the original response untouched for
 * any other Auth.js endpoint or non-JSON body.
 */
async function stripServerOnlySessionFields(
  req: NextRequest,
  res: Response,
): Promise<Response> {
  // Only the session endpoint returns the session JSON. Other Auth.js GETs
  // (csrf, providers, signin/signout pages, OIDC callback redirects) are
  // untouched.
  if (!req.nextUrl.pathname.endsWith("/session")) return res;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return res;

  let body: unknown;
  try {
    body = await res.clone().json();
  } catch {
    // Non-JSON / empty body (e.g. `{}` for an unauthenticated session is still
    // valid JSON; a parse failure means there is nothing token-bearing to
    // strip). Return the original response unchanged.
    return res;
  }

  if (!body || typeof body !== "object") return res;
  const record = body as Record<string, unknown>;
  let mutated = false;
  for (const field of SESSION_SERVER_ONLY_FIELDS) {
    if (field in record) {
      delete record[field];
      mutated = true;
    }
  }
  if (!mutated) return res;

  // Rebuild the response, preserving status + headers (minus content-length,
  // which the runtime recomputes for the new body).
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return NextResponse.json(record, { status: res.status, headers });
}

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

export async function GET(req: NextRequest) {
  const sanitized = sanitizeCallbackUrl(req);
  const res = await handlers.GET(sanitized);
  return stripServerOnlySessionFields(sanitized, res);
}

export const POST = handlers.POST;
