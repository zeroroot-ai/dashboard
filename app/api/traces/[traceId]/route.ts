import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client';
import { TracesService } from '@/src/gen/gibson/traces/v1/traces_pb';
import { ConnectError, Code } from '@connectrpc/connect';
import { assembleTraceData } from '@/src/lib/traces-client';
import { timestampToISO } from '@/src/lib/gibson-client';

/**
 * GET /api/traces/[traceId]
 *
 * Direct trace lookup by id (no mission correlation required) — the
 * click-through target from the tenant-wide trace list. Returns the same
 * canonical TraceData shape as /api/missions/[id]/traces via the shared
 * assembleTraceData helper.
 *
 * Calls TracesService.GetTrace + fetches observations by ID from the trace
 * record's observation_ids list.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ traceId: string }> },
) {
  try {
    const { traceId } = await params;

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

    const client = userClient(TracesService);

    let traceResp: Awaited<ReturnType<typeof client.getTrace>>;
    try {
      traceResp = await client.getTrace({ traceId });
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.NotFound) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Trace not found' } },
          { status: 404 },
        );
      }
      throw err;
    }

    const trace = traceResp.trace;
    if (!trace) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Trace not found' } },
        { status: 404 },
      );
    }

    // Fetch all observations for the trace in parallel.
    const observationIds = trace.observationIds ?? [];
    const observations = await Promise.all(
      observationIds.map((obsId) =>
        client.getObservation({ observationId: obsId }).then((r) => r.observation),
      ),
    );
    const validObservations = observations.filter(Boolean) as NonNullable<
      (typeof observations)[number]
    >[];

    const traceTimestamp = timestampToISO(trace.timestamp) ?? new Date().toISOString();
    const traceData = assembleTraceData(traceTimestamp, validObservations, traceId);
    return NextResponse.json(traceData);
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
