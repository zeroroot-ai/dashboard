/**
 * Unit tests for the CSRF double-submit primitives in `src/lib/csrf.ts`,
 * focused on `ensureCsrfCookie` — the middleware seeder that re-homes the
 * cookie writer removed from the deleted api proxy (dashboard#862).
 */

import { describe, it, expect } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

import {
  ensureCsrfCookie,
  validateCsrfToken,
  CSRF_COOKIE_NAME,
} from '../csrf';

function reqWithCookie(token?: string): NextRequest {
  const req = new NextRequest('https://app.example.com/dashboard');
  if (token !== undefined) {
    req.cookies.set(CSRF_COOKIE_NAME, token);
  }
  return req;
}

describe('ensureCsrfCookie', () => {
  it('seeds a fresh token cookie when the request has none', () => {
    const res = NextResponse.next();
    ensureCsrfCookie(reqWithCookie(undefined), res);

    const set = res.cookies.get(CSRF_COOKIE_NAME);
    expect(set).toBeDefined();
    // 32 random bytes → 64 hex chars.
    expect(set!.value).toMatch(/^[0-9a-f]{64}$/);
    expect(set!.sameSite).toBe('strict');
    // client JS must read it to echo back as the header.
    expect(set!.httpOnly).toBe(false);
  });

  it('does NOT overwrite an existing token cookie (stable across navigations)', () => {
    const existing = 'a'.repeat(64);
    const res = NextResponse.next();
    ensureCsrfCookie(reqWithCookie(existing), res);

    // No Set-Cookie written when one already rides the request.
    expect(res.cookies.get(CSRF_COOKIE_NAME)).toBeUndefined();
  });

  it('seeds a token that subsequently validates against an echoed header', () => {
    const res = NextResponse.next();
    ensureCsrfCookie(reqWithCookie(undefined), res);
    const token = res.cookies.get(CSRF_COOKIE_NAME)!.value;

    // Simulate the next request: client echoes the seeded cookie as the header.
    const next = new NextRequest('https://app.example.com/api/missions/x/start', {
      method: 'POST',
      headers: { 'x-csrf-token': token },
    });
    next.cookies.set(CSRF_COOKIE_NAME, token);

    expect(validateCsrfToken(next)).toBe(true);
  });
});
