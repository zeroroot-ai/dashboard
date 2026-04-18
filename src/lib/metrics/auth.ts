/**
 * Prometheus counters and histograms for the auth subsystem.
 *
 * Naming follows Prometheus conventions: snake_case metric names, `_total`
 * suffix on counters, `_seconds` suffix on latency histograms. All metrics
 * register against the shared `registry` singleton (see `./registry.ts`)
 * and are exposed via `/api/metrics`.
 *
 * Label cardinality is deliberately bounded. No tenant-id, user-id, email,
 * IP address, or other per-principal identifier appears as a label — those
 * explode cardinality and degrade Prometheus query performance. Per-principal
 * detail belongs in the audit event stream (`src/lib/audit/auth.ts`), not in
 * metrics.
 *
 * Consumed by:
 *   - Server Actions in `app/actions/auth/*` (signup, signin, password reset,
 *     email verification) — increment on every terminal outcome.
 *   - `src/lib/auth/hibp.ts` / `captcha.ts` — increment on check outcomes.
 *   - `src/lib/admin-provisioning.ts` — observe `provisioningDuration`.
 */

import { getOrCreateCounter, getOrCreateHistogram } from "./helpers";

// ---------------------------------------------------------------------------
// Label type unions — enumerated so TypeScript catches typos at the call
// site. prom-client itself does not constrain label values at the type level.
// ---------------------------------------------------------------------------

/** Terminal outcome for an auth attempt. */
export type AuthOutcome = "ok" | "failed" | "rate_limited" | "locked";

/** Why the HIBP breach check returned. */
export type HibpOutcome = "clean" | "breached" | "unknown";

/** Which CAPTCHA provider rejected a token. */
export type CaptchaProvider = "turnstile" | "hcaptcha" | "disabled";

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
  help: "Total signup attempts, labelled by outcome and coarse failure reason.",
  labelNames: ["outcome", "reason"] as const,
});

/**
 * Total signin attempts. `reason` mirrors signupAttempts (`invalid_credentials`,
 * `account_locked`, `email_not_verified`, `rate_limited`, `captcha_failed`,
 * `internal_error`) and is `""` on success.
 */
export const signinAttempts = getOrCreateCounter({
  name: "dashboard_auth_signin_attempts_total",
  help: "Total signin attempts, labelled by outcome and coarse failure reason.",
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
 * `ok` covers both "reset email sent" and "reset completed" — the audit log
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
 * Total CAPTCHA verification failures, labelled by provider. A successful
 * CAPTCHA verification is implied by the parent action's `signupAttempts` /
 * `signinAttempts` success increment and is NOT counted here — this metric
 * exists specifically to alert on abuse/outage of the CAPTCHA provider.
 */
export const captchaFailures = getOrCreateCounter({
  name: "dashboard_auth_captcha_failures_total",
  help: "Total CAPTCHA verification failures, labelled by provider.",
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
 * End-to-end duration of a provisioning call from the dashboard's perspective
 * (e.g. `handleCreate` in admin-provisioning). Buckets sized 100ms → 60s:
 * the floor catches happy-path idempotent replays, the ceiling catches
 * operator-initiated retries that block on external dependencies.
 *
 * Corresponding operator-side histogram lives in
 * `tenant-operator/internal/metrics/metrics.go` (declared but not yet
 * recorded — see task 17.1). Together they form the end-to-end view.
 */
export const provisioningDuration = getOrCreateHistogram({
  name: "dashboard_auth_provisioning_duration_seconds",
  help: "Duration of dashboard-side provisioning calls, in seconds.",
  labelNames: ["operation", "outcome"] as const,
  // 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s, 20s, 40s, 60s.
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 40, 60],
});
