import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';
import { adaptCallView, groupCallsIntoRuns, aggregateCalls } from '@/src/lib/world-traces';
import type { RunDetailResponse } from '@/src/types/trace';

/**
 * GET /api/traces/runs/[runId]
 *
 * One run's detail: the LLM calls sharing this run id plus a by-model token /
 * spend summary (gibson#755). The empty-string run id ("ungrouped") is encoded
 * by the caller as the literal segment "_". WorldService.ListLlmCalls is the
 * single read path; the daemon scopes to the caller's tenant.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId: rawRunId } = await params;
    // "_" is the URL-safe encoding of the empty (ungrouped) run id.
    const runId = rawRunId === '_' ? '' : decodeURIComponent(rawRunId);

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
    const calls = resp.llmCalls.map(adaptCallView).filter((c) => (c.runId || '') === runId);

    if (calls.length === 0) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Run not found' } },
        { status: 404 },
      );
    }

    const run = groupCallsIntoRuns(calls)[0];
    const tokenSummary = aggregateCalls(calls);

    const body: RunDetailResponse = { run, tokenSummary };
    return NextResponse.json(body);
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
