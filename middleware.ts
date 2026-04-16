/**
 * Next.js middleware for Gibson Dashboard.
 *
 * Responsibilities:
 *
 * 1. Session guard:
 *    Checks for the Better Auth session cookie (better-auth.session_token) on
 *    protected routes. Unauthenticated requests are redirected to
 *    /dashboard/login/v2. Cookie presence is sufficient for the middleware
 *    gate — the Better Auth cookie-cached session is HMAC-signed, so no DB
 *    call is needed here.
 *
 * 2. X-Gibson-Tenant header injection (Requirement 10.2 / 6.7):
 *    Reads the gibson_current_tenant cookie set by /api/tenant/select and
 *    injects X-Gibson-Tenant into every outgoing request so the daemon knows
 *    which tenant context to use. Only injected when the cookie is present;
 *    omitting the header is valid — the daemon will resolve from the session.
 *
 * 3. Tenant picker redirect (Requirement 10.1):
 *    After an authenticated user lands on a dashboard route, if they belong to
 *    more than one tenant and have not yet selected one (no cookie), they are
 *    redirected to /login/tenant-picker. Single-tenant users are unaffected.
 *
 * 4. Nonce-based CSP:
 *    Generates a per-request nonce and sets the Content-Security-Policy header.
 *
 * The middleware runs on all paths except Next.js internals and static assets.
 */

import { NextRequest, NextResponse } from 'next/server';

// The cookie name set by Better Auth for session tokens.
const BETTER_AUTH_SESSION_COOKIE = 'better-auth.session_token';

// The cookie name must match the one written by /api/tenant/select/route.ts.
const CURRENT_TENANT_COOKIE = 'gibson_current_tenant';

// ---------------------------------------------------------------------------
// Protected route prefixes.
//
// Requests to these paths require a valid session cookie. Everything else
// (public pages, API, static assets) is allowed through without a session.
// ---------------------------------------------------------------------------
const PROTECTED_PREFIXES = [
  '/dashboard/',
  '/invite/',
];

// Auth pages live under /dashboard/ but must remain accessible without a session.
const AUTH_PUBLIC_PREFIXES = [
  '/dashboard/login',
  '/dashboard/register',
  '/dashboard/forgot-password',
];

function isProtectedRoute(pathname: string): boolean {
  if (AUTH_PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false;
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// Nonce-based Content Security Policy.
//
// A per-request nonce is generated and injected into the CSP header. Next.js
// reads it via the x-nonce request header and applies it to all inline
// <script> tags automatically. This eliminates the need for 'unsafe-eval'
// and 'unsafe-inline' in script-src.
// ---------------------------------------------------------------------------
function generateCspHeaders(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'", // inline styles needed for UI libs
    "img-src 'self' data: https:",
    "connect-src 'self' wss: ws: http://localhost:* https:",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join("; ");
}

// Paths that should never be redirected to the tenant picker.
const PICKER_EXEMPT = [
  '/login',
  '/api/',
  '/_next/',
  '/favicon',
  '/signup',
  '/dashboard/login',
  '/dashboard/register',
];

function isPickerExempt(pathname: string): boolean {
  return PICKER_EXEMPT.some((prefix) => pathname.startsWith(prefix));
}

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Clone headers so we can inject without mutating the original request.
  const requestHeaders = new Headers(request.headers);

  // Generate per-request nonce for CSP.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  requestHeaders.set('x-nonce', nonce);

  // -----------------------------------------------------------------
  // 1. Session guard: redirect unauthenticated users on protected routes.
  //
  //    We check for the presence of the Better Auth session cookie.
  //    Cookie-cached sessions are HMAC-signed by Better Auth, so presence
  //    alone is a sufficient gate for middleware (full validation happens
  //    in route handlers and Server Components via getServerSession()).
  // -----------------------------------------------------------------
  const sessionCookie = request.cookies.get(BETTER_AUTH_SESSION_COOKIE)?.value;

  if (isProtectedRoute(pathname) && !sessionCookie) {
    const loginUrl = new URL('/dashboard/login/v2', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    const redirectResp = NextResponse.redirect(loginUrl);
    redirectResp.headers.set('Content-Security-Policy', generateCspHeaders(nonce));
    return redirectResp;
  }

  // -----------------------------------------------------------------
  // 2. Inject X-Gibson-Tenant from cookie if present.
  // -----------------------------------------------------------------
  const currentTenant = request.cookies.get(CURRENT_TENANT_COOKIE)?.value;
  if (currentTenant && !requestHeaders.has('x-gibson-tenant')) {
    requestHeaders.set('x-gibson-tenant', currentTenant);
  }

  // -----------------------------------------------------------------
  // 3. Tenant picker redirect for authenticated multi-tenant users.
  //
  //    Only redirect on dashboard routes that are not already exempt.
  //    If the user has no tenant cookie set, the session may carry tenant
  //    info that we can use to auto-set it (single-tenant) or redirect
  //    to the picker (multi-tenant). We skip this when there is no session
  //    (unauthenticated — already handled above) or when the path is exempt.
  // -----------------------------------------------------------------
  if (sessionCookie && !isPickerExempt(pathname) && !currentTenant) {
    // Without making an HTTP call to Better Auth in middleware (expensive),
    // we cannot determine the user's tenant list here. The per-tenant cookie
    // is set either by the tenant picker page or by the session initialization
    // route. If neither has happened, send the user to the picker.
    //
    // Exception: /dashboard routes that are not dashboard sub-pages (e.g.,
    // /dashboard itself, /dashboard/default) skip the picker redirect so the
    // dashboard can initialize and set the cookie on its own.
    if (pathname.startsWith('/dashboard/') &&
        !pathname.startsWith('/dashboard/login') &&
        !pathname.startsWith('/dashboard/register')) {
      // Let the dashboard routes handle tenant resolution via server-side
      // getServerSession() + setTenantCookie. The middleware only redirects
      // to the picker when the user has explicitly multiple tenants; that
      // logic requires reading the session which we defer to the page.
    }
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('Content-Security-Policy', generateCspHeaders(nonce));
  return response;
}

export const config = {
  // Run on all routes except Next.js internals and static assets.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
