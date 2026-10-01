// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Prometheus counters and histograms for the auth subsystem.
 *
 * Naming follows Prometheus conventions: snake_case metric names, `_total`
 * suffix on counters, `_seconds` suffix on latency histograms. All metrics
 * register against the shared `registry` singleton (see `./registry.ts`)
 * and are exposed via `/api/metrics`.
 *
 * Label cardinality is deliberately bounded. No tenant-id, user-id, email,
 * IP address, or other per-principal identifier appears as a label, those
 * explode cardinality and degrade Prometheus query performance. Per-principal
 * detail belongs in the audit event stream (`src/lib/audit/auth.ts`), not in
 * metrics.
 *
 * Consumed by:
 *   - Server Actions in `app/actions/auth/*` (signup, signin, password reset,
 *     email verification), increment on every terminal outcome.
 *   - `src/lib/auth/hibp.ts` / `captcha.ts`, increment on check outcomes.
 */

import { getOrCreateCounter, getOrCreateHistogram } from "./helpers";

// ---------------------------------------------------------------------------
// Label type unions, enumerated so TypeScript catches typos at the call
// site. prom-client itself does not constrain label values at the type level.
// ---------------------------------------------------------------------------

/** Terminal outcome for an auth attempt. */
type AuthOutcome = "ok" | "failed" | "rate_limited" | "locked";

/** Why the HIBP breach check returned. */
type HibpOutcome = "clean" | "breached" | "unknown";

/** Which CAPTCHA provider rejected a token. */
type CaptchaProvider = "turnstile" | "hcaptcha" | "disabled";

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

/**
 * Total signup attempts, partitioned by outcome and a coarse failure reason
 * (e.g. `password_policy`, `slug_owned_by_other`, `email_already_registered`,
 * `hibp_breached`, `captcha_failed`, `internal_error`). `reason` is `""` on
 * successful attempts so the label set stays stable.
 */
export const signupAttempts = getOrCreateCounter({
  name: "dashboard_auth_signup_attempts_total",
  help: "Total signup attempts, labeled by outcome and coarse failure reason.",
  labelNames: ["outcome", "reason"] as const,
});

/**
 * Total signin attempts. `reason` mirrors signupAttempts (`invalid_credentials`,
 * `account_locked`, `email_not_verified`, `rate_limited`, `captcha_failed`,
 * `internal_error`) and is `""` on success.
 */
export const signinAttempts = getOrCreateCounter({
  name: "dashboard_auth_signin_attempts_total",
  help: "Total signin attempts, labeled by outcome and coarse failure reason.",
  labelNames: ["outcome", "reason"] as const,
});

/**
 * Total account lockout events (account-keyed rate limiter tripped the
 * threshold). Each increment corresponds to one newly-locked account.
 */
export const accountLockouts = getOrCreateCounter({
  name: "dashboard_auth_account_lockouts_total",
  help: "Total account lockout events triggered by the account-keyed rate limiter.",
  labelNames: [] as const,
});

/**
 * Total password reset terminal outcomes. `outcome` in `{ok,failed,rate_limited}`.
 * `ok` covers both "reset email sent" and "reset completed", the audit log
 * distinguishes those two; the metric captures aggregate success rate.
 */
export const passwordResets = getOrCreateCounter({
  name: "dashboard_auth_password_resets_total",
  help: "Total password reset terminal outcomes.",
  labelNames: ["outcome"] as const,
});

/**
 * Total email verification terminal outcomes. `outcome` in `{ok,failed,rate_limited}`.
 */
export const emailVerifications = getOrCreateCounter({
  name: "dashboard_auth_email_verifications_total",
  help: "Total email verification terminal outcomes.",
  labelNames: ["outcome"] as const,
});

/**
 * Total CAPTCHA verification failures, labeled by provider. A successful
 * CAPTCHA verification is implied by the parent action's `signupAttempts` /
 * `signinAttempts` success increment and is NOT counted here, this metric
 * exists specifically to alert on abuse/outage of the CAPTCHA provider.
 */
export const captchaFailures = getOrCreateCounter({
  name: "dashboard_auth_captcha_failures_total",
  help: "Total CAPTCHA verification failures, labeled by provider.",
  labelNames: ["provider"] as const,
});

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
// Histograms
// ---------------------------------------------------------------------------

/**
 * End-to-end duration of a provisioning call from the dashboard's perspective.
 * Buckets sized 100ms → 60s:
 * the floor catches happy-path idempotent replays, the ceiling catches
 * operator-initiated retries that block on external dependencies.
 *
 * Corresponding operator-side histogram lives in
 * `tenant-operator/internal/metrics/metrics.go` (declared but not yet
 * recorded, see task 17.1). Together they form the end-to-end view.
 */
export const provisioningDuration = getOrCreateHistogram({
  name: "dashboard_auth_provisioning_duration_seconds",
  help: "Duration of dashboard-side provisioning calls, in seconds.",
  labelNames: ["operation", "outcome"] as const,
  // 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s, 20s, 40s, 60s.
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 40, 60],
});

// ---------------------------------------------------------------------------
// Membership-resolution metrics (spec: tenant-membership-not-in-jwt R9)
// ---------------------------------------------------------------------------

/** Outcome of a membership-resolution attempt. */
type MembershipResolutionOutcome =
  | "single"        // exactly one membership returned
  | "multi"         // multiple memberships returned (picker shown)
  | "zero"          // user is a member of no tenants (onboarding shown)
  | "fga_error"     // daemon/FGA call failed; middleware routed to /login/error
  | "daemon_error"; // daemon unreachable

const membershipResolutionTotal = getOrCreateCounter({
  name: "dashboard_membership_resolution_total",
  help: "Membership-resolution attempts during sign-in / per-render, by outcome.",
  labelNames: ["outcome"] as const,
});

const membershipResolutionDuration = getOrCreateHistogram({
  name: "dashboard_membership_resolution_duration_seconds",
  help: "Duration of the daemon ListMyMemberships RPC seen from the dashboard.",
  labelNames: ["outcome"] as const,
  // 50ms baseline through 5s, anything past 5s is FGA-or-daemon-on-fire.
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

/** Outcome of a single active-tenant cookie validation pass. */
type ActiveTenantValidationOutcome =
  | "ok"
  | "absent"
  | "invalid"     // HMAC failed (tampered or stale AUTH_SECRET)
  | "stale"       // membership revoked while signed-in
  | "forbidden";  // attempted to set a non-member tenant

const activeTenantValidationTotal = getOrCreateCounter({
  name: "dashboard_active_tenant_validation_total",
  help: "Active-tenant cookie validation outcomes per request.",
  labelNames: ["outcome"] as const,
});

const tenantSwitchTotal = getOrCreateCounter({
  name: "dashboard_tenant_switch_total",
  help: "Number of successful in-app tenant switches.",
});

// ---------------------------------------------------------------------------
// Workload-identity transport fallback
// ---------------------------------------------------------------------------

/**
 * Increments on every outbound daemon RPC that leaves without the pod's
 * X509-SVID, so the call reaches Envoy over plain HTTPS carrying only its
 * Bearer token. Two causes: the SPIFFE Workload API socket is absent, or the
 * SVID cache was still cold.
 *
 * The chart alerts on this (`DashboardUserTokenForwardingDisabled`,
 * gibson-workloads/templates/dashboard/auth-prometheusrule.yaml), and until
 * now NOTHING incremented it, so the alert could not fire for any reason. The
 * counter was declared for the USE_USER_TOKEN_FORWARDING soak backout, that
 * flag was deleted, and charts#294 re-aimed the alert at a transport fault
 * without anything producing the series it reads.
 *
 * A cold cache increments once per pod start, which the alert's `for: 10m`
 * absorbs: one increment makes `increase(...[5m]) > 0` true for five minutes,
 * not ten. A missing socket increments on every RPC and sustains, which is the
 * condition worth paging about.
 *
 * The NAME still says user-token-forwarding and the condition no longer does.
 * Renaming it breaks the chart's alert expr and four golden files in another
 * repo, so it moves in a coordinated pair, not here.
 */
const workloadSvidFallbackTotal = getOrCreateCounter({
  name: "dashboard_user_token_forwarding_disabled_total",
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
 * Sign-in attempts by terminal outcome. error_reason is the
 * machine-readable code from LoginErrorReason; "_n/a" on success.
 */
const signinTotal = getOrCreateCounter({
  name: "dashboard_signin_total",
  help: "Dashboard sign-in attempts by terminal outcome.",
  labelNames: ["outcome", "error_reason"] as const,
});

/**
 * Sign-in latency from OIDC callback start to JWT-cookie write.
 * Buckets sized to catch happy path (<500ms) and slow paths up to 10s.
 */
const signinDuration = getOrCreateHistogram({
  name: "dashboard_signin_duration_seconds",
  help: "Sign-in latency in seconds, by outcome.",
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
 * Helper: observe a sign-in attempt's outcome + duration. Caller
 * passes "_n/a" when outcome is success.
 */
function observeSignin(
  outcome: "success" | "error",
  durationSeconds: number,
  errorReason: string = "_n/a",
): void {
  signinTotal.inc({ outcome, error_reason: errorReason });
  signinDuration.observe({ outcome }, durationSeconds);
}
