import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, createRateLimitResponse } from '@/src/lib/rate-limiter';
import { getTenantProvisioningStatus } from '@/src/lib/gibson-client/provisioning';

const STATUS_RATE_LIMIT = {
  maxRequests: 60,
  windowSeconds: 60, // 60 req/min, polling every 2s = 30/min
  algorithm: 'fixed_window' as const,
  message: 'Too many status requests. Please slow down.',
};

type StepStatus = 'completed' | 'running' | 'failed' | 'pending';

/**
 * Map an operator-reported per-store state string ("", "provisioning",
 * "ready", "failed") into the legacy step status the provisioning page renders.
 */
function storeStepStatus(state: string, phaseFailed: boolean): StepStatus {
  const s = state.toLowerCase();
  if (s === 'ready') return 'completed';
  if (s === 'failed') return 'failed';
  if (s === 'provisioning') return 'running';
  // Empty / unknown: failed phase ⇒ this step never started under a failure;
  // otherwise it's simply pending.
  return phaseFailed ? 'failed' : 'pending';
}

/**
 * GET /api/signup/status?tenant={tenantId}
 *
 * Public proxy endpoint for the provisioning page polling loop. Reads the
 * operator-reported provisioning snapshot from the daemon's
 * TenantProvisioningService (dashboard#813 — the dashboard no longer reads the
 * Tenant CR directly) and projects it into the legacy
 * { status, currentStep, steps } shape the provisioning page consumes.
 *
 * The snapshot carries `phase` + `dataPlaneReady` + per-store states but NOT
 * the Tenant CR's full status.conditions, so the step view is reconstructed
 * from the coarse data-plane store states (postgres/redis/neo4j).
 *
 * The `user` parameter is no longer supported, provisioning is keyed on the
 * Tenant CR name (slugified company name).
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
    const snapshot = await getTenantProvisioningStatus(tenantId);

    if (!snapshot.found) {
      // No provisioning record yet — operator hasn't created the CR off the
      // pending-provisioning queue. Treat as still initializing.
      return NextResponse.json({
        status: 'provisioning',
        currentStep: '',
        steps: [],
      });
    }

    const phase = snapshot.phase || 'Pending';
    const phaseFailed = phase === 'Failed';

    // Reconstruct a coarse step view from the per-store provisioning states.
    const steps = [
      {
        name: 'postgres',
        displayLabel: 'Provisioning database',
        status: storeStepStatus(snapshot.stores.postgres, phaseFailed),
      },
      {
        name: 'redis',
        displayLabel: 'Provisioning cache',
        status: storeStepStatus(snapshot.stores.redis, phaseFailed),
      },
      {
        name: 'graph',
        displayLabel: 'Provisioning knowledge graph',
        status: storeStepStatus(snapshot.stores.neo4j, phaseFailed),
      },
    ];

    const overall =
      phase === 'Ready' || snapshot.dataPlaneReady
        ? 'active'
        : phaseFailed
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

    console.error(
      JSON.stringify({
        component: 'signup-status',
        op: 'getTenantProvisioningStatus.error',
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
