/**
 * Next.js middleware for Gibson Dashboard.
 *
 * Wraps Auth.js v5's `auth` middleware with active-tenant routing:
 *
 *   - Unauthenticated → Auth.js redirects to `/login` (default behavior).
 *   - Authenticated, no `gibson_active_tenant` cookie → 302 `/select-tenant`.
 *   - Authenticated, cookie present but tampered/HMAC-invalid → 302 `/select-tenant`
 *     (no error surfaced; identical UX to "haven't picked yet").
 *   - Authenticated, cookie names a tenant the user is no longer a member of →
 *     clear cookie, 302 `/select-tenant`.
 *   - Authenticated, FGA / daemon unreachable when validating membership →
 *     302 `/login/error?reason=<machine-readable>` (deterministic error page,
 *     never federated-signout).
 *   - Authenticated with valid membership → forward to the route handler.
 *
 * The federated-signout-on-tenantless-session rule from the pre-spec
 * implementation is GONE. "No tenant" is now a product state (onboarding /
 * picker), not a broken-session sentinel.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readRawActiveTenant, ACTIVE_TENANT_COOKIE_NAME } from "@/src/lib/auth/active-tenant";
import {
  getMyMemberships,
  MembershipResolutionError,
} from "@/src/lib/auth/membership";
import { membershipReasonToLoginErrorReason } from "@/src/lib/auth/login-error-mapping";
import { decideHostSplit, loadHostSplitConfig } from "@/src/lib/host-routing";
import { CORRELATION_HEADER, generateCorrelationId } from "@/src/lib/auth/correlation";
import { popLastFiredSubsystem } from "@/src/lib/test-fixtures/fault-injection";
import { logger } from "@/src/lib/logger";

// Pin middleware to the Node.js runtime: membership.ts → gibson-client.ts
// transitively pulls in @grpc/grpc-js (via the SPIFFE Workload-API client),
// which uses Node-only modules (`dns`, `fs`, `cluster`). Edge Runtime cannot
// host those, and Next.js 16's default of Edge Runtime for middleware would
// fail the build at module-graph trace time.
export const runtime = "nodejs";

const PROTECTED_PREFIX = "/dashboard";

// Host split (deploy#630 S11). Computed once at module load — origins are
// fixed for the pod's lifetime. Null in single-origin dev (no WWW_URL).
const HOST_SPLIT = loadHostSplitConfig();

export default auth(async (req) => {
  const { pathname, search } = req.nextUrl;

  // 0. www/app host split. Runs before auth so marketing pages (www) never
  //    touch tenant resolution, and the product host (app) never serves the
  //    public landing. Cross-host requests 307 to the canonical host; app "/"
  //    goes to /dashboard. See src/lib/host-routing.ts.
  if (HOST_SPLIT) {
    const decision = decideHostSplit(
      req.headers.get("host") ?? "",
      pathname,
      search ?? "",
      HOST_SPLIT,
    );
    if (decision.kind === "redirect") {
      return NextResponse.redirect(new URL(decision.url, req.nextUrl.origin), {
        status: 307,
      });
    }
  }

  const session = req.auth;

  // Spec auth-resolution-hardening R2.5/R3.5 — every request through
  // middleware carries a correlation ID. Generate one if absent so all
  // downstream Server Components / route handlers / log lines can
  // correlate against the same request.
  let correlationId = req.headers.get(CORRELATION_HEADER);
  if (!correlationId) {
    correlationId = generateCorrelationId();
  }
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set(CORRELATION_HEADER, correlationId);

  // 1a. Auth.js error redirect — when the jwt or signIn callback throws, Auth.js
  //     redirects to pages.error (/login) with ?error=Callback or ?error=<name>.
  //     Intercept those and reroute to /login/error?reason=<machine-readable>
  //     so the user sees a deterministic error page rather than the login form
  //     with an error query param that the form doesn't surface. This covers
  //     the fault-injection paths for "token-exchange" and "jwks" faults.
  if (pathname === "/login") {
    const authError = req.nextUrl.searchParams.get("error");
    if (authError) {
      // Map Auth.js error names to our LoginErrorReason codes.
      let reason: string;
      if (authError === "Callback") {
        // jwt callback threw — could be token-exchange or jwks fault.
        // popLastFiredSubsystem() returns which fault subsystem last fired,
        // letting us pick the right reason code. Falls back to
        // oidc_token_exchange_failed for non-fixture causes.
        const lastFired = popLastFiredSubsystem();
        if (lastFired === "jwks") {
          reason = "jwks_unavailable";
        } else {
          reason = "oidc_token_exchange_failed";
        }
      } else if (authError === "OAuthCallbackError") {
        reason = "oidc_token_exchange_failed";
      } else if (authError === "JWTSessionError") {
        reason = "session_invalid";
      } else {
        reason = "oidc_token_exchange_failed";
      }
      const url = new URL("/login/error", req.nextUrl.origin);
      url.searchParams.set("reason", reason);
      if (correlationId) url.searchParams.set("correlationId", correlationId);
      return NextResponse.redirect(url);
    }
  }

  // 1. Unauthenticated requests for protected routes — let Auth.js redirect
  //    to /login via its default behavior.
  if (!session?.user) {
    return NextResponse.next({ request: { headers: reqHeaders } });
  }

  // 1b. Opaque-token detection (dashboard#357).
  //
  // Auth.js stores account.access_token at sign-in and never refreshes it.
  // Users who signed in before EnsureJWTAccessToken was applied to the
  // gibson-dashboard Zitadel OIDC app hold opaque (non-JWT) bearer tokens.
  // Envoy's jwt_authn filter rejects those with "Jwt is not in the form of
  // Header.Payload.Signature", causing every userClient RPC to fail.
  //
  // A valid JWT has exactly 3 dot-separated segments. Anything else is
  // treated as stale/opaque and the user is bounced to sign-in so Auth.js
  // mints a fresh session with a proper JWT access token.
  //
  // This check runs for ALL authenticated requests (protected and otherwise)
  // so that stale-token holders are redirected even before they reach
  // /dashboard and trigger an RPC.
  if (session.accessToken && session.accessToken.split('.').length !== 3) {
    logger.warn(
      {
        scope: "middleware.opaque_token_detected",
        correlation_id: correlationId,
        token_length: session.accessToken.length,
      },
      "auth.opaque_token_redirect",
    );
    const signInUrl = new URL("/api/auth/signin", req.nextUrl.origin);
    signInUrl.searchParams.set("callbackUrl", pathname + (search || ""));
    return NextResponse.redirect(signInUrl);
  }

  // 2. Authenticated requests outside the protected area — let through.
  if (!pathname.startsWith(PROTECTED_PREFIX)) {
    return NextResponse.next({ request: { headers: reqHeaders } });
  }

  // 3. Resolve memberships up front so we can distinguish absent-cookie
  //    from stale-cookie precisely.
  let memberships: Awaited<ReturnType<typeof getMyMemberships>>;
  try {
    memberships = await getMyMemberships();
  } catch (err) {
    if (err instanceof MembershipResolutionError) {
      const loginErrorReason = membershipReasonToLoginErrorReason(err.reason);
      // Log the underlying ConnectRPC code alongside the user-facing
      // bucket so log review can pin a misclassification (e.g. a
      // permission_denied surfacing as daemon_unavailable would
      // re-create the dashboard#45 bug).
      logger.warn(
        {
          scope: "middleware.membership_resolution",
          membership_reason: err.reason,
          login_error_reason: loginErrorReason,
          connect_code: err.connectCode,
          correlation_id: correlationId,
        },
        "auth.login_error",
      );
      const url = new URL("/login/error", req.nextUrl.origin);
      url.searchParams.set("reason", loginErrorReason);
      return NextResponse.redirect(url);
    }
    logger.warn(
      {
        scope: "middleware.membership_resolution",
        membership_reason: "unknown",
        login_error_reason: "unknown",
        correlation_id: correlationId,
      },
      "auth.login_error",
    );
    const url = new URL("/login/error", req.nextUrl.origin);
    url.searchParams.set("reason", "unknown");
    return NextResponse.redirect(url);
  }

  // 4. Zero memberships → onboarding (NOT federated-signout).
  if (memberships.length === 0) {
    return NextResponse.redirect(new URL("/onboarding", req.nextUrl.origin));
  }

  // 5. Check the active-tenant cookie state.
  const raw = await readRawActiveTenant();
  const returnTo = pathname + (search || "");

  if (raw.status === "absent" || raw.status === "invalid") {
    const url = new URL("/select-tenant", req.nextUrl.origin);
    url.searchParams.set("return_to", returnTo);
    const res = NextResponse.redirect(url);
    if (raw.status === "invalid") {
      // Tampered/stale-secret cookie — drop it so the next request is clean.
      res.cookies.delete(ACTIVE_TENANT_COOKIE_NAME);
    }
    return res;
  }

  // 6. Cookie present + signature ok → verify membership is still current.
  const isMember = memberships.some((m) => m.tenantId === raw.tenantId);
  if (!isMember) {
    const url = new URL("/select-tenant", req.nextUrl.origin);
    url.searchParams.set("return_to", returnTo);
    const res = NextResponse.redirect(url);
    res.cookies.delete(ACTIVE_TENANT_COOKIE_NAME);
    return res;
  }

  // 7. Healthy state — let the route render.
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
     *   - api/signup    — signup polling endpoint; opaque-capability protected
     *   - login/error   — deterministic error page for auth failures (public)
     *   - signup        — signup page (must stay public)
     *   - select-tenant — tenant picker (auth required, but tenant deliberately
     *                     absent here)
     *   - onboarding    — zero-membership state (auth required, no tenant)
     *
     * NOTE: /login itself is NOT excluded from the matcher. The middleware runs
     * on /login to intercept Auth.js ?error= redirects (e.g. ?error=Callback
     * from a failing jwt callback) and reroute them to /login/error. When there
     * is no ?error= param the middleware falls through immediately via step 1.
     */
    "/((?!_next/static|_next/image|favicon\\.ico|api/auth|api/health|api/signup|login/error|signup$|signup/|select-tenant$|select-tenant/|onboarding$|onboarding/).+)",
    // The pattern above ends in `.+`, which requires ≥1 char after the leading
    // slash, so it never matches the root path "/". The host split (deploy#630
    // S11) MUST run on "/" — on the product host app.<domain> the landing page
    // must redirect to /dashboard rather than render. Match it explicitly.
    "/",
  ],
};
