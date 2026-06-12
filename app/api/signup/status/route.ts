import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, createRateLimitResponse } from '@/src/lib/rate-limiter';
import { getTenant } from '@/src/lib/k8s/tenants';
import { K8sNotFoundError } from '@/src/lib/k8s/errors';

const STATUS_RATE_LIMIT = {
  maxRequests: 60,
  windowSeconds: 60, // 60 req/min, polling every 2s = 30/min
  algorithm: 'fixed_window' as const,
  message: 'Too many status requests. Please slow down.',
};

/**
 * GET /api/signup/status?tenant={tenantId}
 *
 * Public proxy endpoint for the provisioning page polling loop. Reads the
 * Tenant CR's .status.phase and .status.conditions and projects them into
 * the legacy { status, currentStep, steps } shape consumed by the
 * provisioning page.
 *
 * The `user` parameter is no longer supported, provisioning is now keyed
 * on the Tenant CR name (slugified company name).
 */
export async function GET(request: NextRequest) {
  // Rate limit by IP
  const rateLimitResult = await checkRateLimit(request, 'signup:status', STATUS_RATE_LIMIT);
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(rateLimitResult, STATUS_RATE_LIMIT.message);
  }

  const tenantId = request.nextUrl.searchParams.get('tenant');

  if (!tenantId) {
    return NextResponse.json(
      { error: { code: 'MISSING_PARAM', message: 'tenant parameter is required' } },
      { status: 400 },
    );
  }

  try {
    const cr = await getTenant(tenantId);
    const phase = cr.status?.phase ?? 'Pending';
    const conditions = cr.status?.conditions ?? [];

    // Map CR conditions → legacy step shape.
    const steps = conditions.map((c) => ({
      name: c.type,
      displayLabel: c.message ?? c.type,
      status:
        c.status === 'True'
          ? 'completed'
          : c.status === 'False'
            ? c.reason === 'InProgress'
              ? 'running'
              : 'failed'
            : 'pending',
    }));

    const overall =
      phase === 'Ready'
        ? 'active'
        : phase === 'Failed'
          ? 'provisioning_failed'
          : 'provisioning';
    const runningStep = steps.find((s) => s.status === 'running');
    const currentStep = runningStep?.name ?? '';

    return NextResponse.json({
      status: overall,
      currentStep,
      steps,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : '';

    if (error instanceof K8sNotFoundError || errMsg.includes('not found')) {
      // CR not yet created, still initializing
      return NextResponse.json({
        status: 'provisioning',
        currentStep: '',
        steps: [],
      });
    }

    console.error(
      JSON.stringify({
        component: 'signup-status',
        op: 'getTenantCR.error',
        ts: new Date().toISOString(),
        error: errMsg,
      }),
    );

    return NextResponse.json(
      { status: 'error', message: 'Provisioning service unavailable' },
      { status: 503 },
    );
  }
}
