import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import {
  LangfuseUnavailableError,
  LangfuseNotFoundError,
} from '@/src/lib/langfuse-client';
import { resolveLangfuseClient } from '@/src/lib/langfuse-tenant-service';
import { assembleObservationDetail } from '@/src/lib/trace-detail';

/**
 * GET /api/traces/observations/[obsId]
 *
 * Fetch a single observation's detail (conversation content) for on-demand
 * loading when a trace row is expanded. Tenant-scoped via the caller's
 * credentials; the observation id alone identifies the record, so this is
 * mission-agnostic and shared by both the mission Traces tab and the
 * standalone trace detail page — one observation-fetch codepath.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ obsId: string }> },
) {
  try {
    const { obsId } = await params;

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
        { error: { code: 'NOT_CONFIGURED', message: 'Observability not configured' } },
        { status: 404 },
      );
    }

    const observation = await assembleObservationDetail(langfuse, obsId);
    return NextResponse.json({ observation });
  } catch (error) {
    if (error instanceof LangfuseUnavailableError) {
      return NextResponse.json(
        { error: { code: 'SERVICE_UNAVAILABLE', message: 'Trace data temporarily unavailable' } },
        { status: 503 },
      );
    }
    if (error instanceof LangfuseNotFoundError) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Observation not found' } },
        { status: 404 },
      );
    }
    return daemonErrorResponse(error);
  }
}
