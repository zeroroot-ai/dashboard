import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';
import { ConnectError, Code } from '@connectrpc/connect';
import { adaptCallDetail } from '@/src/lib/world-traces';

/**
 * GET /api/traces/calls/[callId]
 *
 * One LLM call's full detail incl. its prompt transcript + completion
 * (gibson#755), loaded on demand when the user expands a call. Backed by
 * WorldService.GetLlmCall; the daemon scopes to the caller's tenant and returns
 * NotFound for an unknown call id.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ callId: string }> },
) {
  try {
    const { callId } = await params;

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

    let resp: Awaited<ReturnType<ReturnType<typeof userClient<typeof WorldService>>['getLlmCall']>>;
    try {
      resp = await userClient(WorldService).getLlmCall({ callId });
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.NotFound) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Call not found' } },
          { status: 404 },
        );
      }
      throw err;
    }

    if (!resp.call) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Call not found' } },
        { status: 404 },
      );
    }

    return NextResponse.json(adaptCallDetail(resp.call));
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
