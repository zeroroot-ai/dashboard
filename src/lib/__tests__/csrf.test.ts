/**
 * Unit tests for the CSRF double-submit primitives in `src/lib/csrf.ts`,
 * focused on `ensureCsrfCookie` — the middleware seeder that re-homes the
 * cookie writer removed from the deleted api proxy (dashboard#862).
 */

import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

import {
  ensureCsrfCookie,
  validateCsrfToken,
  csrfCookieNameFor,
  isSecureRequest,
  CSRF_COOKIE_NAME,
  CSRF_COOKIE_NAME_INSECURE,
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

describe('CSRF cookie naming and Secure attribute', () => {
  it('uses the __Host- prefixed name on a TLS origin', () => {
    expect(CSRF_COOKIE_NAME).toBe('__Host-csrf-token');

    const res = NextResponse.next();
    ensureCsrfCookie(new NextRequest('https://app.example.com/dashboard'), res);

    const set = res.cookies.get(CSRF_COOKIE_NAME);
    expect(set).toBeDefined();
    // All three are REQUIRED by the __Host- prefix; without any one of them the
    // browser silently drops the cookie.
    expect(set!.secure).toBe(true);
    expect(set!.path).toBe('/');
    expect(set!.domain).toBeUndefined();
  });

  it('keys Secure to the request scheme, NOT to NODE_ENV', () => {
    // The regression this guards: `secure: process.env.NODE_ENV === 'production'`
    // marked cookies Secure on a production build served over plain http (so the
    // browser dropped them) and left them non-Secure on a dev build behind the
    // TLS edge. Pin the behavior with NODE_ENV explicitly set to the value that
    // would have produced the wrong answer under the old rule.
    vi.stubEnv('NODE_ENV', 'development');
    try {
      const res = NextResponse.next();
      ensureCsrfCookie(new NextRequest('https://app.example.com/dashboard'), res);

      // Dev build, TLS request → still Secure.
      expect(res.cookies.get(CSRF_COOKIE_NAME)!.secure).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }

    // And the mirror case: production build, plain-http request → NOT Secure,
    // because the browser could not store it if it were.
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const res = NextResponse.next();
      ensureCsrfCookie(new NextRequest('http://localhost:3000/dashboard'), res);

      expect(res.cookies.get(CSRF_COOKIE_NAME_INSECURE)!.secure).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('falls back to the unprefixed name on a plain-http origin', () => {
    const req = new NextRequest('http://localhost:3000/dashboard');
    expect(isSecureRequest(req)).toBe(false);
    expect(csrfCookieNameFor(req)).toBe(CSRF_COOKIE_NAME_INSECURE);

    const res = NextResponse.next();
    ensureCsrfCookie(req, res);

    // __Host- requires Secure, and a browser will not store a Secure cookie
    // over plain http, so the prefixed name must NOT be used here.
    expect(res.cookies.get(CSRF_COOKIE_NAME)).toBeUndefined();
    const set = res.cookies.get(CSRF_COOKIE_NAME_INSECURE);
    expect(set).toBeDefined();
    expect(set!.secure).toBe(false);
  });

  it('honours x-forwarded-proto when TLS terminates at the edge', () => {
    // The deployed shape: Envoy terminates TLS and forwards plain http to the
    // pod, so nextUrl.protocol is http even though the user is on https.
    const req = new NextRequest('http://dashboard.svc:3000/dashboard', {
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(isSecureRequest(req)).toBe(true);
    expect(csrfCookieNameFor(req)).toBe(CSRF_COOKIE_NAME);

    const res = NextResponse.next();
    ensureCsrfCookie(req, res);
    expect(res.cookies.get(CSRF_COOKIE_NAME)!.secure).toBe(true);
  });

  it('reads the first entry of a chained x-forwarded-proto', () => {
    const req = new NextRequest('http://dashboard.svc:3000/dashboard', {
      headers: { 'x-forwarded-proto': 'https, http' },
    });
    expect(isSecureRequest(req)).toBe(true);
  });

  it('validates a token seeded under either cookie name', () => {
    for (const name of [CSRF_COOKIE_NAME, CSRF_COOKIE_NAME_INSECURE]) {
      const token = 'b'.repeat(64);
      const req = new NextRequest('https://app.example.com/api/missions/x/start', {
        method: 'POST',
        headers: { 'x-csrf-token': token },
      });
      req.cookies.set(name, token);
      expect(validateCsrfToken(req), `cookie name ${name}`).toBe(true);
    }
  });
});
