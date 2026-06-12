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
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/** Set the CSRF cookie on a NextResponse. */
export function setCsrfCookie(response: NextResponse, token: string): void {
  response.cookies.set(CSRF_COOKIE_NAME, token, {
    path: '/',
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false, // client JS must read and echo back as header
    maxAge: 86400, // 1 day
  });
}

/** Read the csrf-token cookie value from an incoming request. */
export function getCsrfTokenFromCookies(request: NextRequest): string | null {
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
