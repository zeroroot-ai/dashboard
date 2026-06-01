import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { getMissionHistory, userClient } from '@/src/lib/gibson-client';
import { TracesService } from '@/src/gen/gibson/traces/v1/traces_pb';
import { ConnectError, Code } from '@connectrpc/connect';
import { assembleTraceData } from '@/src/lib/traces-client';
import { timestampToISO } from '@/src/lib/gibson-client';

/**
 * GET /api/missions/[id]/traces
 *
 * Fetch the full LLM trace tree for a mission, routed through the daemon's
 * TracesService. The daemon resolves per-tenant Langfuse credentials
 * server-side; the dashboard never sees Langfuse host/keys.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: missionId } = await params;

    // Validate authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    // Resolve active tenant (fail-closed).
    try {
      await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }

    // Authz enforced by daemon ext-authz on the downstream RPC.

    // Get mission history to find trace_id
    let traceId: string | undefined;
    try {
      const history = await getMissionHistory(missionId, 1, 0, session?.user?.id);
      const run = history.runs?.[0];
      if (run) {
        traceId = run.traceId;
      }
    } catch {
      // If getMissionHistory fails, no trace available
    }

    if (!traceId) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Traces not available for this mission. The mission may predate trace recording.' } },
        { status: 404 }
      );
    }

    const client = userClient(TracesService);

    // Fetch the trace record.
    let traceResp: Awaited<ReturnType<typeof client.getTrace>>;
    try {
      traceResp = await client.getTrace({ traceId });
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.NotFound) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Trace not found in trace store' } },
          { status: 404 }
        );
      }
      throw err;
    }

    const trace = traceResp.trace;
    if (!trace) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Trace not found in trace store' } },
        { status: 404 }
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
    const traceData = assembleTraceData(traceTimestamp, validObservations, traceId, missionId);
    return NextResponse.json(traceData);
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
