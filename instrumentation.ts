/**
 * Next.js instrumentation hook — runs once per Node server boot.
 *
 * Performs server-side startup self-checks. Any throw here causes the
 * Next.js process to exit non-zero (kubelet sees CrashLoopBackOff in
 * production), which is the desired fail-fast behaviour for misconfigured
 * pods.
 *
 * Spec: zero-trust-hardening Req 11.3 — `ALLOWED_SERVICE_SUBJECTS` must
 * be non-empty before any inbound service-acting traffic can succeed.
 * Spec: security-hardening R9 — `DASHBOARD_AUTHZ_PERMISSIVE_DEV=1` must
 * never be honoured in a production build; defence-in-depth on top of
 * the existing `NODE_ENV` gate at `assert-authorized.ts`.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  // -------------------------------------------------------------------------
  // R9 fail-fast: permissive-dev authz is a developer ergonomics knob and
  // MUST NOT be observable on a production pod. The existing `NODE_ENV !==
  // 'production'` guard inside `assertAuthorized` is the primary defence;
  // this startup assertion is the second layer — if a chart values mistake
  // ever ships the env var into prod, the pod fails to start instead of
  // silently authorising every unknown RPC.
  // -------------------------------------------------------------------------
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.DASHBOARD_AUTHZ_PERMISSIVE_DEV === '1'
  ) {
    const { logger } = await import('@/src/lib/logger');
    logger.error(
      {
        spec: 'security-hardening',
        requirement: 'R9',
        envVar: 'DASHBOARD_AUTHZ_PERMISSIVE_DEV',
      },
      'DASHBOARD_AUTHZ_PERMISSIVE_DEV=1 is set with NODE_ENV=production — refusing to start. ' +
        'This env var disables the authz registry fail-closed default and is a development-only knob. ' +
        'Remove the env var from the chart values / pod spec and redeploy.',
    );
    // Throwing inside instrumentation.register() causes Next.js to crash the
    // Node server — kubelet then reports CrashLoopBackOff, which is the
    // desired fail-fast signal for ops.
    throw new Error(
      'security-hardening R9: DASHBOARD_AUTHZ_PERMISSIVE_DEV=1 forbidden in NODE_ENV=production',
    );
  }

  // -------------------------------------------------------------------------
  // one-code-path/206 — single required-env validator.
  //
  // Enumerates every dashboard-required env var, throws EnvValidationError
  // listing every missing/malformed key at once. Replaces the per-module
  // inline `process.env.X ?? "..."` fallbacks throughout the codebase.
  // -------------------------------------------------------------------------
  const { validateEnv, EnvValidationError } = await import(
    '@/src/lib/env-validator'
  );
  try {
    validateEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      const { logger } = await import('@/src/lib/logger');
      logger.error(
        {
          spec: 'one-code-path',
          slice: 'deploy#206',
          missing: err.missing.map((s) => s.name),
          malformed: err.malformed.map((m) => ({
            name: m.spec.name,
            reason: m.reason,
          })),
        },
        err.message,
      );
    }
    throw err;
  }

  // Legacy validator kept for the warn-on-missing-NEO4J_PASSWORD path and
  // for any callsite that still imports `validateEnvConfig`. Now a thin
  // shim over env-validator semantics.
  const { validateEnvConfig } = await import('@/src/lib/config');
  validateEnvConfig();

  // Billing configuration validation: throws if DASHBOARD_BILLING_PAID_TIERS_ENABLED=true
  // and the Stripe key mode doesn't match the environment (test key in prod, live key in dev).
  // See spec stripe-billing-integration R8.1, R8.2.
  const { validateBillingConfig } = await import('@/src/lib/billing/stripe');
  validateBillingConfig();
}
