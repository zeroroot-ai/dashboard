import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import {
  LangfuseUnavailableError,
  LangfuseAuthError,
  LangfuseNotFoundError,
} from '@/src/lib/langfuse-client';
import { resolveLangfuseClient } from '@/src/lib/langfuse-tenant-service';
import { assembleTraceData } from '@/src/lib/trace-detail';

/**
 * GET /api/traces/[traceId]
 *
 * Direct trace lookup by id (no mission correlation required) — the
 * click-through target from the tenant-wide trace list. Returns the same
 * canonical TraceData shape as /api/missions/[id]/traces via the shared
 * assembleTraceData helper.
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

    const langfuse = await resolveLangfuseClient(
      session.user.tenantId,
      session?.user?.id,
    );
    if (!langfuse) {
      return NextResponse.json(
        {
          error: {
            code: 'NOT_CONFIGURED',
            message:
              'LLM trace viewing requires observability configuration. Contact your administrator.',
          },
        },
        { status: 404 },
      );
    }

    const traceData = await assembleTraceData(langfuse, traceId);
    return NextResponse.json(traceData);
  } catch (error) {
    if (error instanceof LangfuseUnavailableError) {
      return NextResponse.json(
        { error: { code: 'SERVICE_UNAVAILABLE', message: 'Trace data temporarily unavailable' } },
        { status: 503 },
      );
    }
    if (error instanceof LangfuseAuthError) {
      return NextResponse.json(
        { error: { code: 'CONFIG_ERROR', message: 'Invalid trace credentials for this tenant' } },
        { status: 500 },
      );
    }
    if (error instanceof LangfuseNotFoundError) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Trace not found' } },
        { status: 404 },
      );
    }
    return daemonErrorResponse(error);
  }
}
