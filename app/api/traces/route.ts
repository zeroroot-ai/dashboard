import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';
import { adaptCallView, groupCallsIntoRuns } from '@/src/lib/world-traces';
import type { RunListResponse } from '@/src/types/trace';

/**
 * GET /api/traces
 *
 * Tenant-wide Gibson Traces: the LLM-call log folded into the brain World,
 * grouped into runs (gibson#755). The daemon's WorldService resolves the
 * caller's tenant server-side and returns only that tenant's calls; the
 * dashboard reads through Envoy + ext-authz, never touching the World directly.
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }

    try {
      await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }

    const resp = await userClient(WorldService).listLlmCalls({});
    const calls = resp.llmCalls.map(adaptCallView);
    const runs = groupCallsIntoRuns(calls);

    const body: RunListResponse = { runs };
    return NextResponse.json(body);
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
