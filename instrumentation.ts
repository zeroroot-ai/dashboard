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
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
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
