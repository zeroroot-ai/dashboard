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

export const CSRF_COOKIE_NAME = 'csrf-token';

/** Generate a cryptographically random CSRF token (64 hex chars). */
function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/** Set the CSRF cookie on a NextResponse. */
function setCsrfCookie(response: NextResponse, token: string): void {
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    path: '/',
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false, // client JS must read and echo back as header
    maxAge: 86400, // 1 day
  });
}

/** Read the csrf-token cookie value from an incoming request. */
function getCsrfTokenFromCookies(request: NextRequest): string | null {
  return request.cookies.get(CSRF_COOKIE_NAME)?.value ?? null;
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
    setCsrfCookie(response, generateCsrfToken());
  }
}
