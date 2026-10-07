// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Prometheus counters and histograms for the auth subsystem.
 *
 * Naming follows Prometheus conventions: snake_case metric names, `_total`
 * suffix on counters, `_seconds` suffix on latency histograms. All metrics
 * register against the shared `registry` singleton (see `./registry.ts`)
 * and are exposed on the metrics-only port (`src/lib/metrics/server.ts`).
 *
 * Label cardinality is deliberately bounded. No tenant-id, user-id, email,
 * IP address, or other per-principal identifier appears as a label, those
 * explode cardinality and degrade Prometheus query performance. Per-principal
 * detail belongs in the audit event stream (`src/lib/audit/auth.ts`), not in
 * metrics.
 *
 * Every metric declared here has a producer, and
 * `scripts/check-metrics-have-producers.mjs` fails the build when one does
 * not (dashboard#173). The producers:
 *   - `app/actions/signup.ts` records every signup terminal outcome.
 *   - `auth.ts` observes every sign-in callback.
 *   - `src/lib/auth/membership.ts` records every ListMyMemberships resolution.
 *   - `src/lib/auth/active-tenant.ts` records every active-tenant check.
 *   - `src/lib/auth/breached-password-gate.ts` records every HIBP check.
 *   - `src/lib/gibson-client/transport.ts` records SVID-less daemon RPCs.
 *   - `app/(public)/login/error/page.tsx` records every login-error render.
 *
 * Zitadel owns sign-in credentials, password reset, email verification and
 * lockout (ADR-0093), and the signup form has no CAPTCHA by decision. The
 * dashboard never sees those events, so it declares no series for them.
 */

import { getOrCreateCounter, getOrCreateHistogram } from "./helpers";

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

/** Terminal outcome of a signup action. */
type SignupOutcome = "ok" | "failed" | "rate_limited";

/**
 * Total signup terminal outcomes, partitioned by outcome and the
 * `SignupFailureCode` the action returned. `reason` is `""` on success so
 * the label set stays stable.
 */
const signupAttempts = getOrCreateCounter({
  name: "dashboard_auth_signup_attempts_total",
  help: "Total signup terminal outcomes, labeled by outcome and failure code.",
  labelNames: ["outcome", "reason"] as const,
});

/**
 * Record one signup terminal outcome. Called from the signup action's
 * audit helper, which every exit path runs through.
 */
export function recordSignup(outcome: SignupOutcome, reason: string = ""): void {
  signupAttempts.inc({ outcome, reason });
}

// ---------------------------------------------------------------------------
// Breached-password gate
// ---------------------------------------------------------------------------

/**
 * Total HIBP breach-check outcomes. `outcome` distinguishes `clean` (not
 * breached), `breached`, and `unknown` (timeout / non-200 / disabled).
 * The `unknown` rate is used to alert on HIBP API degradation.
 */
export const hibpChecks = getOrCreateCounter({
  name: "dashboard_auth_hibp_checks_total",
  help: "Total HIBP breach check outcomes.",
  labelNames: ["outcome"] as const,
});

// ---------------------------------------------------------------------------
// Membership resolution (spec: tenant-membership-not-in-jwt R9)
// ---------------------------------------------------------------------------

/**
 * Outcome of one ListMyMemberships resolution. `ok` is a parsed response.
 * The rest mirror `MembershipResolutionReason` in `src/lib/auth/membership.ts`.
 */
export type MembershipResolutionOutcome =
  | "ok"
  | "unauthenticated"
  | "permission_denied"
  | "daemon_unavailable"
  | "fga_unavailable"
  | "malformed_response"
  | "unknown";

const membershipResolutionTotal = getOrCreateCounter({
  name: "dashboard_membership_resolution_total",
  help: "ListMyMemberships resolutions from the dashboard, by outcome.",
  labelNames: ["outcome"] as const,
});

const membershipResolutionDuration = getOrCreateHistogram({
  name: "dashboard_membership_resolution_duration_seconds",
  help: "Duration of the daemon ListMyMemberships RPC seen from the dashboard.",
  labelNames: ["outcome"] as const,
  // 50ms baseline through 5s, anything past 5s is FGA-or-daemon-on-fire.
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

/** Record one ListMyMemberships resolution and how long the RPC took. */
export function recordMembershipResolution(
  outcome: MembershipResolutionOutcome,
  durationSeconds: number,
): void {
  membershipResolutionTotal.inc({ outcome });
  membershipResolutionDuration.observe({ outcome }, durationSeconds);
}

// ---------------------------------------------------------------------------
// Active tenant
// ---------------------------------------------------------------------------

/**
 * Outcome of one `requireActiveTenant` check.
 *   - `ok`: the session names a tenant and a current membership confirms it.
 *   - `absent`: the session names no tenant.
 *   - `stale`: the session names a tenant the person is no longer a member
 *     of. A sustained non-zero rate means revocations are landing on
 *     signed-in sessions, which is the signal worth watching.
 */
type ActiveTenantOutcome = "ok" | "absent" | "stale";

const activeTenantValidationTotal = getOrCreateCounter({
  name: "dashboard_active_tenant_validation_total",
  help: "requireActiveTenant outcomes per request.",
  labelNames: ["outcome"] as const,
});

/** Record one `requireActiveTenant` outcome. */
export function recordActiveTenantValidation(outcome: ActiveTenantOutcome): void {
  activeTenantValidationTotal.inc({ outcome });
}

// ---------------------------------------------------------------------------
// Workload-identity transport fallback
// ---------------------------------------------------------------------------

/**
 * Increments on every outbound daemon RPC that leaves without the pod's
 * X509-SVID, so the call reaches Envoy over plain HTTPS carrying only its
 * Bearer token. Two causes: the SPIFFE Workload API socket is absent, or the
 * SVID cache was still cold.
 *
 * The chart alerts on this (`DashboardWorkloadSvidFallback`,
 * gibson-workloads/templates/dashboard/auth-prometheusrule.yaml) reading
 * `increase(dashboard_workload_svid_fallback_total[5m]) > 0`.
 *
 * A cold cache increments once per pod start, which the alert's `for: 10m`
 * absorbs: one increment makes `increase(...[5m]) > 0` true for five minutes,
 * not ten. A missing socket increments on every RPC and sustains, which is the
 * condition worth paging about.
 *
 * Do not rename this counter without moving the chart alert in the same
 * ordered pair (producer at a pinned tag first, alert second). An alert whose
 * series has no producer reads as coverage and is not.
 */
const workloadSvidFallbackTotal = getOrCreateCounter({
  name: "dashboard_workload_svid_fallback_total",
  help: "Outbound dashboard daemon RPCs that left without the pod's X509-SVID, over plain HTTPS. Sustained non-zero means the SPIFFE Workload API is unreachable.",
});

/**
 * Helper: record one outbound RPC that went without the workload SVID.
 * Called from the transport's fallback branches, which run in the Node.js
 * runtime only.
 */
export function recordWorkloadSvidFallback(): void {
  workloadSvidFallbackTotal.inc();
}

// ---------------------------------------------------------------------------
// Sign-in + login-error metrics (spec: auth-resolution-hardening R3)
// ---------------------------------------------------------------------------

/**
 * Sign-in callbacks by terminal outcome. error_reason is the
 * machine-readable reason the callback threw with; "_n/a" on success.
 */
const signinTotal = getOrCreateCounter({
  name: "dashboard_signin_total",
  help: "Dashboard sign-in callbacks by terminal outcome.",
  labelNames: ["outcome", "error_reason"] as const,
});

/**
 * Sign-in callback latency: from the OIDC callback entering the jwt
 * callback with an `account` to the tenant being stamped on the token.
 * Buckets sized to catch the happy path (<500ms) and slow paths up to 10s.
 */
const signinDuration = getOrCreateHistogram({
  name: "dashboard_signin_duration_seconds",
  help: "Sign-in callback latency in seconds, by outcome.",
  labelNames: ["outcome"] as const,
  buckets: [0.1, 0.25, 0.5, 1, 1.5, 2, 3, 5, 10],
});

/**
 * /login/error page renders, by reason. Cardinality bounded to the
 * LoginErrorReason union (8 values).
 */
const loginErrorTotal = getOrCreateCounter({
  name: "dashboard_login_error_total",
  help: "Dashboard /login/error page renders, by reason.",
  labelNames: ["reason"] as const,
});

/**
 * Helper: increment loginErrorTotal for a given reason. Safe to call
 * from a Server Component renderer.
 */
export function incrementLoginError(reason: string): void {
  loginErrorTotal.inc({ reason });
}

/**
 * Helper: observe a sign-in callback's outcome and duration. Called from
 * the `jwt` callback in `auth.ts` on the initial sign-in only.
 */
export function observeSignin(
  outcome: "success" | "error",
  durationSeconds: number,
  errorReason: string = "_n/a",
): void {
  signinTotal.inc({ outcome, error_reason: errorReason });
  signinDuration.observe({ outcome }, durationSeconds);
}
