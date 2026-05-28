import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { getMissionHistory } from '@/src/lib/gibson-client';
import { LangfuseUnavailableError, LangfuseAuthError, LangfuseNotFoundError } from '@/src/lib/langfuse-client';
import { resolveLangfuseClient } from '@/src/lib/langfuse-tenant-service';
import { assembleTraceData } from '@/src/lib/trace-detail';

/**
 * GET /api/missions/[id]/traces
 *
 * Fetch the full LLM trace tree for a mission.
 * Uses the requesting tenant's Langfuse project credentials.
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

    // Authz enforced by daemon ext-authz on the downstream RPC.

    // Get mission history to find trace_id
    // The mission name is the missionId in this context
    let traceId: string | undefined;
    try {
      const history = await getMissionHistory(missionId, 1, 0, session?.user?.id);
      const run = history.runs?.[0];
      if (run) {
        traceId = run.traceId;
      }
    } catch {
      // If getMissionHistory fails, try using missionId directly as trace lookup
    }

    if (!traceId) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Traces not available for this mission. The mission may predate trace recording.' } },
        { status: 404 }
      );
    }

    // Resolve a tenant-scoped Langfuse client. All credential resolution
    // (per-tenant preferred, platform fallback, NOT_FOUND handling) lives in
    // LangfuseTenantService — this route owns none of it.
    const langfuse = await resolveLangfuseClient(
      session.user.tenantId,
      session?.user?.id,
    );

    if (!langfuse) {
      return NextResponse.json(
        { error: { code: 'NOT_CONFIGURED', message: 'LLM trace viewing requires observability configuration. Contact your administrator.' } },
        { status: 404 }
      );
    }

    // Assemble the canonical TraceData (shared with /api/traces/[traceId]).
    const traceData = await assembleTraceData(langfuse, traceId, missionId);
    return NextResponse.json(traceData);
  } catch (error) {
    if (error instanceof LangfuseUnavailableError) {
      return NextResponse.json(
        { error: { code: 'SERVICE_UNAVAILABLE', message: 'Trace data temporarily unavailable' } },
        { status: 503 }
      );
    }
    if (error instanceof LangfuseAuthError) {
      return NextResponse.json(
        { error: { code: 'CONFIG_ERROR', message: 'Invalid Langfuse credentials for this tenant' } },
        { status: 500 }
      );
    }
    if (error instanceof LangfuseNotFoundError) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Trace not found in Langfuse' } },
        { status: 404 }
      );
    }

    return daemonErrorResponse(error);
  }
}
