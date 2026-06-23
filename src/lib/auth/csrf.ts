/**
 * CSRF guard for mutating dashboard route handlers.
 *
 * Spec: zero-trust-hardening Req 11.5.
 *
 * The dashboard's session cookie is `sameSite: 'lax'` so that cross-tab
 * navigation from email/marketing pages still carries the session into
 * the app, switching to `'strict'` would break the OIDC sign-in flow.
 * To compensate, every mutating route handler under `app/api/**` must
 * call `requireCsrf(request)` before any state change.
 *
 * Design:
 *   - Reuses the `csrf-token` cookie defined in `src/lib/csrf.ts`
 *     (double-submit cookie pattern; the cookie is `sameSite: 'strict'`
 *     itself, so a cross-site form post cannot forge the matching cookie
 *     value).
 *     NOTE (dashboard#862): that cookie's only seeder (proxy.ts) was removed
 *     in the E9 sweep, so the cookie is currently never set and this guard
 *     fails closed on the mission routes. Tracked for re-seed-or-retire in #862.
 *   - Compares the cookie value to the `x-csrf-token` request header
 *     OR to a `csrf` field in the request body (multipart or
 *     `application/x-www-form-urlencoded` form posts), Auth.js v5's
 *     own action endpoints accept the same shape, so existing forms
 *     do not need to change.
 *   - Comparison is constant-time via `crypto.timingSafeEqual`.
 *   - Throws `CsrfError` on any mismatch; route handlers wrap with
 *     try/catch and return `403 { error: 'csrf-token-required' }` (the
 *     helper `csrfErrorResponse` builds the canonical body).
 *
 * Auth.js v5 mints its own CSRF token at `/api/auth/csrf` for its own
 * action routes. We do NOT reuse that token here, that token is bound
 * to Auth.js's action protocol and rotates on its own schedule. The
 * `csrf-token` cookie is a generic per-session token that client code
 * already echoes via `src/lib/api/fetch.ts`, so wiring this helper to it
 * requires no client-side changes (subject to #862 re-seeding the cookie).
 *
 * @module auth/csrf
 */

import 'server-only';

import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { CSRF_COOKIE_NAME } from '@/src/lib/csrf';

/** Header name used in the double-submit pattern. */
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** Form-field name used as a fallback for HTML form posts. */
export const CSRF_FORM_FIELD = 'csrf';

/** Machine-readable failure reasons. Surfaced in 403 response bodies. */
export type CsrfErrorReason =
  | 'csrf-cookie-missing'
  | 'csrf-token-missing'
  | 'csrf-token-mismatch';

/**
 * Thrown by {@link requireCsrf} on every check failure. Route handlers
 * catch this and return a 403 response via {@link csrfErrorResponse}.
 */
export class CsrfError extends Error {
  readonly reason: CsrfErrorReason;
  constructor(reason: CsrfErrorReason, detail: string) {
    super(`csrf: ${reason}: ${detail}`);
    this.name = 'CsrfError';
    this.reason = reason;
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Read the CSRF token submitted by the client. Prefers the
 * `x-csrf-token` header (the standard path used by `src/lib/api/fetch.ts`);
 * falls back to a `csrf` field on form-encoded request bodies for
 * HTML form posts that cannot set headers.
 *
 * For form-encoded payloads we read the body via `request.clone()` so the
 * route handler can still consume the original request. Multipart bodies
 * are NOT supported here, multipart-form mutating routes should set the
 * `x-csrf-token` header explicitly via `src/lib/api/fetch.ts`.
 */
async function readSubmittedToken(request: NextRequest): Promise<string | null> {
  const header = request.headers.get(CSRF_HEADER_NAME);
  if (header) return header;

  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    try {
      const cloned = request.clone();
      const text = await cloned.text();
      const params = new URLSearchParams(text);
      const formToken = params.get(CSRF_FORM_FIELD);
      if (formToken) return formToken;
    } catch {
      // Body unavailable / already consumed, fall through to "missing".
    }
  }

  return null;
}

/**
 * Require a valid CSRF token on a mutating request. Throws
 * {@link CsrfError} if the proxy-seeded cookie is missing, the request
 * carries no token, or the values do not match (constant-time compare).
 *
 * Call this at the top of every POST/PUT/PATCH/DELETE handler under
 * `app/api/**` whose effects are user-visible. Handlers that are
 * Auth.js-authoritative (e.g. `/api/auth/[...nextauth]`) do NOT need
 * this, Auth.js validates its own CSRF token on those routes.
 *
 * Usage:
 *   try {
 *     await requireCsrf(request);
 *   } catch (err) {
 *     if (err instanceof CsrfError) return csrfErrorResponse(err);
 *     throw err;
 *   }
 */
export async function requireCsrf(request: NextRequest): Promise<void> {
  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value ?? '';
  if (!cookieToken) {
    throw new CsrfError(
      'csrf-cookie-missing',
      `the ${CSRF_COOKIE_NAME} cookie is absent, the proxy did not seed it (browser may have third-party cookies blocked or the request bypassed the proxy)`,
    );
  }

  const submittedToken = await readSubmittedToken(request);
  if (!submittedToken) {
    throw new CsrfError(
      'csrf-token-missing',
      `request has no ${CSRF_HEADER_NAME} header and no ${CSRF_FORM_FIELD} form field`,
    );
  }

  if (!constantTimeEquals(cookieToken, submittedToken)) {
    throw new CsrfError(
      'csrf-token-mismatch',
      `submitted token does not match the ${CSRF_COOKIE_NAME} cookie`,
    );
  }
}

/**
 * Build the canonical 403 response body for a {@link CsrfError}. Route
 * handlers use this so every mutating path returns a uniform shape.
 */
export function csrfErrorResponse(err: CsrfError): NextResponse {
  return NextResponse.json(
    { error: 'csrf-token-required', reason: err.reason },
    { status: 403 },
  );
}
