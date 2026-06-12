import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client';
import { TracesService } from '@/src/gen/gibson/traces/v1/traces_pb';
import { ConnectError, Code } from '@connectrpc/connect';
import { assembleObservationDetail } from '@/src/lib/traces-client';

/**
 * GET /api/traces/observations/[obsId]
 *
 * Fetch a single observation's detail (conversation content) for on-demand
 * loading when a trace row is expanded. Tenant-scoped via the daemon's
 * TracesService; the observation id alone identifies the record, so this is
 * mission-agnostic and shared by both the mission Traces tab and the
 * standalone trace detail page, one observation-fetch codepath.
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

    try {
      await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }

    let obs: import('@/src/gen/gibson/traces/v1/traces_pb').ObservationRecord | undefined;
    try {
      const obsResp = await userClient(TracesService).getObservation({ observationId: obsId });
      obs = obsResp.observation;
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.NotFound) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Observation not found' } },
          { status: 404 },
        );
      }
      throw err;
    }


    if (!obs) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Observation not found' } },
        { status: 404 },
      );
    }

    const observation = assembleObservationDetail(obs);
    return NextResponse.json({ observation });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
