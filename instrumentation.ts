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

  const { validateEnvConfig } = await import('@/src/lib/config');
  validateEnvConfig();

  // Production-only: assert the service-subject allow-list is configured.
  // Local `pnpm dev` and `pnpm build` (no NODE_ENV=production) do not
  // require this env to be set — Auth.js user-acting flows do not depend
  // on it. The chart's resolve-sa-identity-map init container populates
  // this env var on every production pod.
  if (process.env.NODE_ENV === 'production') {
    const { assertAllowedServiceSubjectsConfigured } = await import(
      '@/src/lib/auth/zitadel-bearer-verifier'
    );
    assertAllowedServiceSubjectsConfigured();
  }
}
