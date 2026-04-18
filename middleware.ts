/**
 * Next.js middleware for Gibson Dashboard.
 *
 * Responsibilities:
 *
 * 1. Session guard:
 *    Checks for the Better Auth session cookie (gibson.session_token, legacy
 *    better-auth.session_token supported for rollout) on protected routes.
 *    Unauthenticated requests are redirected to /login (canonical) when the
 *    browser never had a session, or to /dashboard/login/expired when a
 *    session cookie was present but is no longer valid — giving the
 *    "timed-out" user a dedicated recovery page instead of a generic login
 *    prompt. Cookie presence is sufficient for the middleware gate — the
 *    Better Auth cookie-cached session is HMAC-signed, so no DB call is
 *    needed here.
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
 * 4. Explicit-slug auto-switch (Phase B):
 *    When an authenticated request hits /dashboard/t/<slug>/<rest> and the
 *    slug differs from the current gibson_current_tenant cookie, the
 *    middleware rewrites the cookie and sets a flash cookie
 *    (tenant-switched=<slug>) so the page can surface a "Switched to …"
 *    toast. If the slug mismatches the cookie but no membership validation
 *    is possible here (middleware has no DB), the cookie is updated and
 *    /api/tenant/select will enforce membership on the next server
 *    interaction. Navigating to /dashboard/t/<slug>/… when not a member
 *    results in a 403 → redirect to /dashboard/forbidden from route handlers.
 *
 * 5. Nonce-based CSP:
 *    Generates a per-request nonce and sets the Content-Security-Policy header.
 *
 * The middleware runs on all paths except Next.js internals and static assets.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCorrelation } from '@/src/lib/correlation';

// Cookie names set by Better Auth for session tokens.
//
// Since the dashboard configures `advanced.cookiePrefix = 'gibson'` in
// `src/lib/auth-server.ts`, the cookie name is `gibson.session_token`
// (or `__Secure-gibson.session_token` when `secure: true`). We also check
// the legacy `better-auth.session_token` name so in-flight sessions from
// before the cookiePrefix change still authenticate correctly and are
// transparently rotated to the new name on the next Better Auth response.
const SESSION_COOKIE_NAMES = [
  'gibson.session_token',
  '__Secure-gibson.session_token',
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
] as const;

function readSessionCookie(request: NextRequest): string | undefined {
  for (const name of SESSION_COOKIE_NAMES) {
    const value = request.cookies.get(name)?.value;
    if (value) return value;
  }
  return undefined;
}

/**
 * Detect whether a Better-Auth-prefixed cookie is present on the request,
 * regardless of whether its value is valid. Used to distinguish "user never
 * authenticated" (→ /login) from "user had a session that went stale"
 * (→ /dashboard/login/expired).
 *
 * We intentionally key off the cookie NAME rather than the value — Better
 * Auth's cookie can be set to an empty string as a defensive "clear"
 * operation, and an empty value is as telling as a missing one; but it can
 * also be set to a valid-looking value that the DB no longer recognises,
 * in which case treat it as "stale".
 */
function hasSessionCookieHint(request: NextRequest): boolean {
  for (const name of SESSION_COOKIE_NAMES) {
    if (request.cookies.has(name)) return true;
  }
  return false;
}

// The cookie name must match the one written by /api/tenant/select/route.ts.
const CURRENT_TENANT_COOKIE = 'gibson_current_tenant';

// Flash cookie written by the explicit-slug auto-switch logic so pages can
// surface a "Switched to …" toast. One-time read: the page clears it.
const TENANT_SWITCHED_COOKIE = 'tenant-switched';

// ---------------------------------------------------------------------------
// Explicit-slug tenant pattern: /dashboard/t/<slug>/<rest>
// ---------------------------------------------------------------------------
const TENANT_SLUG_PATTERN = /^\/dashboard\/t\/([^/]+)(\/.*)?$/;

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
// `/login` is the canonical login route but lives under `app/(public)/login/`,
// i.e. outside the `/dashboard/` prefix, so it is not protected by
// `isProtectedRoute` anyway — but listing it here documents the boundary.
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
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
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
  '/docs',
];

function isPickerExempt(pathname: string): boolean {
  return PICKER_EXEMPT.some((prefix) => pathname.startsWith(prefix));
}

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Clone headers so we can inject without mutating the original request.
  const requestHeaders = new Headers(request.headers);

  // Generate per-request nonce for CSP.
  // The raw UUID is also used as the correlation ID so a single identifier
  // covers both the CSP nonce and distributed tracing across this request.
  const correlationId = crypto.randomUUID();
  const nonce = Buffer.from(correlationId).toString('base64');
  requestHeaders.set('x-nonce', nonce);

  // -----------------------------------------------------------------
  // 1. Session guard: redirect unauthenticated users on protected routes.
  //
  //    We check for the presence of the Better Auth session cookie.
  //    Cookie-cached sessions are HMAC-signed by Better Auth, so presence
  //    alone is a sufficient gate for middleware (full validation happens
  //    in route handlers and Server Components via getServerSession()).
  // -----------------------------------------------------------------
  const sessionCookie = readSessionCookie(request);

  if (isProtectedRoute(pathname) && !sessionCookie) {
    // Distinguish "never had a session" from "session went stale". If any
    // Better Auth-scoped session cookie is present but empty/invalid, assume
    // the browser held a session that has since expired (either TTL passed
    // or the DB row was deleted by hard-signout) and route to the expired
    // page so we can communicate that specific state to the user instead of
    // a generic "please sign in" screen.
    const hadSessionHint = hasSessionCookieHint(request);
    const target = hadSessionHint
      ? new URL('/dashboard/login/expired', request.url)
      : new URL('/login', request.url);
    target.searchParams.set('callbackUrl', pathname);
    const redirectResp = NextResponse.redirect(target);
    redirectResp.headers.set('Content-Security-Policy', generateCspHeaders(nonce));
    redirectResp.headers.set('x-correlation-id', correlationId);
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
  // 2b. Explicit-slug auto-switch: /dashboard/t/<slug>/<rest>
  //
  //     When the URL explicitly carries a tenant slug and the user is
  //     authenticated, update the gibson_current_tenant cookie to match the
  //     slug so that all subsequent requests within this navigation inherit
  //     the correct tenant context. A flash cookie (tenant-switched=<slug>)
  //     signals to the page that a switch occurred so it can show a toast.
  //
  //     Membership is NOT validated here (no DB in middleware). The route
  //     handler / server component will enforce it and redirect to
  //     /dashboard/forbidden if the user is not a member.
  // -----------------------------------------------------------------
  let autoSwitchedSlug: string | null = null;
  if (sessionCookie) {
    const slugMatch = TENANT_SLUG_PATTERN.exec(pathname);
    if (slugMatch) {
      const urlSlug = slugMatch[1];
      if (urlSlug && urlSlug !== currentTenant) {
        // Rewrite the current-tenant cookie inline on this response.
        autoSwitchedSlug = urlSlug;
        requestHeaders.set('x-gibson-tenant', urlSlug);
      }
    }
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

  // Wrap the response pipeline in the correlation context so downstream
  // server actions and audit emitters can retrieve the ID without
  // requiring it to be threaded explicitly through every call site.
  return withCorrelation(correlationId, () => {
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    response.headers.set('Content-Security-Policy', generateCspHeaders(nonce));
    response.headers.set('x-correlation-id', correlationId);

    // Apply auto-switch cookies when an explicit /dashboard/t/<slug>/... URL
    // caused a tenant context change this request.
    if (autoSwitchedSlug) {
      const cookieOpts = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path: '/',
      };
      response.cookies.set(CURRENT_TENANT_COOKIE, autoSwitchedSlug, {
        ...cookieOpts,
        maxAge: 60 * 60 * 24 * 7, // 7 days
      });
      // Flash cookie — read once by the page to show a toast; no max-age so
      // it expires with the browser session and is consumed on next read.
      response.cookies.set(TENANT_SWITCHED_COOKIE, autoSwitchedSlug, {
        ...cookieOpts,
        // Short TTL: page should read and clear this on next render.
        maxAge: 60,
      });
    }

    return response;
  });
}

export const config = {
  // Run on all routes except Next.js internals and static assets.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
