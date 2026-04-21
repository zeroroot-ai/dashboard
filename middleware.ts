/**
 * Next.js middleware for Gibson Dashboard.
 *
 * Wraps Auth.js v5's `auth` middleware with one extra invariant:
 *
 *   **An authenticated request whose session has no `tenant` claim MUST NOT
 *   reach `/dashboard/*`.** Post dashboard-native-signup, every user who has
 *   finished OIDC sign-in is a member of a Zitadel org, and that org's ID is
 *   their tenant. A missing tenant is therefore a broken-state sentinel —
 *   either a half-completed signup, a stale session cookie from the pre-
 *   spec era, or a user whose Tenant CR was deleted out from under them.
 *   The correct response is a federated sign-out (clears both Auth.js cookie
 *   and Zitadel's session), not an in-dashboard loop.
 *
 * Public-route exclusions are handled in the matcher config below so
 * `auth.ts`'s `authorized` callback stays path-agnostic.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Guard that wraps the Auth.js middleware. The Auth.js `auth` export is a
 * higher-order function when called with an arg — passing a handler wraps
 * the default behaviour and lets us inject redirects based on the resolved
 * session.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  // Authenticated users with no tenant hitting /dashboard/* are in an
  // invalid state — force a federated sign-out so they come back through
  // the signup/login flow.  Does NOT apply to /signup itself (users are
  // correctly tenantless while filling the form).
  if (
    session?.user &&
    !session.user.tenant &&
    pathname.startsWith("/dashboard")
  ) {
    return NextResponse.redirect(
      new URL("/api/auth/federated-signout", req.nextUrl.origin),
    );
  }

  // Delegate to the default Auth.js behaviour (reads session, calls the
  // `authorized` callback in auth.ts, redirects unauthenticated users to
  // `pages.signIn`).
  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Run on all paths except:
     *   - _next/static  — bundled JS / CSS chunks
     *   - _next/image   — Next.js image optimiser
     *   - favicon.ico   — browser favicon
     *   - api/auth      — Auth.js OIDC callbacks
     *   - api/health    — Kubernetes probes
     *   - api/signup/progress — polling endpoint; opaque-capability protected
     *   - login         — sign-in page (must stay public)
     *   - signup        — signup page (must stay public; authenticated-with-no-tenant
     *                      is expected here)
     *   - (root)        — landing page — excluded by `.+` requiring at least
     *                      one trailing char
     */
    "/((?!_next/static|_next/image|favicon\\.ico|api/auth|api/health|api/signup|login$|login/|signup$|signup/).+)",
  ],
};
