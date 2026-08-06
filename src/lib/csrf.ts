/**
 * CSRF Protection, Double Submit Cookie Pattern
 *
 * The client reads the csrf-token cookie and sends it back as the
 * x-csrf-token header on every mutating request. The server compares
 * the two values using a constant-time comparison to prevent timing
 * attacks.
 */

import { randomBytes, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Cookie name on a secure origin.
 *
 * The `__Host-` prefix is enforced by the BROWSER, not by us: it refuses to
 * store the cookie unless the Set-Cookie carries `Secure`, has `Path=/`, and
 * has NO `Domain` attribute. That last property is the one that matters here.
 * Without the prefix, a sibling host on the registrable domain (or anything
 * that can get a Set-Cookie past the browser for a parent domain) can overwrite
 * the CSRF cookie, and a double-submit scheme whose cookie an attacker can
 * write is not a defence: they set both halves and the constant-time compare
 * happily agrees.
 */
export const CSRF_COOKIE_NAME = '__Host-csrf-token';

/**
 * Cookie name on a plain-http origin.
 *
 * `__Host-` REQUIRES the `Secure` attribute, and a browser will not store a
 * Secure cookie over plain http on a non-localhost origin. A self-hosted
 * install being brought up before its certificate is installed is exactly that
 * case, and silently failing to store the CSRF cookie there would turn every
 * mutating request into a 403 with no clue why. So http origins get the
 * unprefixed name and https origins get the prefixed one; the read path below
 * accepts either.
 */
export const CSRF_COOKIE_NAME_INSECURE = 'csrf-token';

/**
 * Whether this request arrived over TLS.
 *
 * Keyed to the REQUEST, not to `NODE_ENV`. NODE_ENV describes how the bundle
 * was built and says nothing about the scheme a given request used: a
 * production build served over plain http (self-hosted pre-cert, a health
 * probe, a misconfigured ingress) got `Secure` cookies it could not store,
 * and a dev build behind the kind edge's TLS got non-Secure cookies it should
 * have marked Secure.
 *
 * `x-forwarded-proto` is the operative signal because every deployed topology
 * puts Envoy in front of this app and terminates TLS there, so `req.nextUrl`
 * reports the internal http hop. The header is only trusted because nothing
 * reaches this process without traversing that proxy; a direct-to-pod caller
 * spoofing it can only downgrade its OWN cookie.
 */
export function isSecureRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    // May be a comma-separated list when several proxies are chained; the
    // client-facing scheme is the first entry.
    return forwardedProto.split(',')[0]!.trim().toLowerCase() === 'https';
  }
  return request.nextUrl.protocol === 'https:';
}

/** The cookie name this request's origin can actually store. */
export function csrfCookieNameFor(request: NextRequest): string {
  return isSecureRequest(request) ? CSRF_COOKIE_NAME : CSRF_COOKIE_NAME_INSECURE;
}

/** Generate a cryptographically random CSRF token (64 hex chars). */
function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/** Set the CSRF cookie on a NextResponse, named for the request's scheme. */
function setCsrfCookie(
  request: NextRequest,
  response: NextResponse,
  token: string,
): void {
  const secure = isSecureRequest(request);
  response.cookies.set(secure ? CSRF_COOKIE_NAME : CSRF_COOKIE_NAME_INSECURE, token, {
    // `path: '/'`, no `domain`, and `secure` are all REQUIRED by the `__Host-`
    // prefix. Changing any of them silently stops the browser storing it.
    path: '/',
    sameSite: 'strict',
    secure,
    httpOnly: false, // client JS must read and echo back as header
    maxAge: 86400, // 1 day
  });
}

/**
 * Read the CSRF cookie from an incoming request.
 *
 * Prefers the `__Host-` prefixed name and falls back to the unprefixed one, so
 * a request is read correctly regardless of which scheme seeded it (and so an
 * in-flight scheme change does not lock a user out mid-session).
 */
export function getCsrfTokenFromCookies(request: NextRequest): string | null {
  return (
    request.cookies.get(CSRF_COOKIE_NAME)?.value ??
    request.cookies.get(CSRF_COOKIE_NAME_INSECURE)?.value ??
    null
  );
}

/**
 * Validate CSRF by comparing the cookie value to the x-csrf-token header
 * using constant-time comparison (crypto.timingSafeEqual).
 *
 * Returns false if either value is missing or they do not match.
 */
export function validateCsrfToken(request: NextRequest): boolean {
  const cookieToken = getCsrfTokenFromCookies(request);
  const headerToken = request.headers.get('x-csrf-token');

  if (!cookieToken || !headerToken) {
    return false;
  }

  const cookieBuf = Buffer.from(cookieToken);
  const headerBuf = Buffer.from(headerToken);

  // timingSafeEqual requires equal-length buffers
  if (cookieBuf.length !== headerBuf.length) {
    return false;
  }

  return timingSafeEqual(cookieBuf, headerBuf);
}

/**
 * Seed the `csrf-token` cookie on a response when the incoming request does
 * not already carry one. Called from middleware on every pass-through
 * response so the double-submit token exists by the time client code issues
 * a mutating request (the client reads the cookie and echoes it as the
 * `x-csrf-token` header — see src/lib/api/fetch.ts).
 *
 * The previous seeder lived in the api proxy (`src/lib/api/proxy.ts`), which
 * was removed in the E9 sweep; middleware is the correct home since it runs
 * on every navigation before any route handler that calls `requireCsrf`.
 */
export function ensureCsrfCookie(request: NextRequest, response: NextResponse): void {
  if (!getCsrfTokenFromCookies(request)) {
    setCsrfCookie(request, response, generateCsrfToken());
  }
}
