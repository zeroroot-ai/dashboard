import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { listMissions, resumeMission, runMission } from '@/src/lib/gibson-client';

/**
 * POST /api/missions/:id/start
 *
 * Start a mission. The daemon has no single "start an existing mission" RPC,
 * so this route inspects the mission's current status and dispatches the
 * right RPC:
 *
 *   paused  -> ResumeMission(missionId)               (same id stays)
 *   pending -> RunMission(missionDefinitionId, targetId)
 *              (creates a new mission run; daemon has no execute-by-id path —
 *               the original `pending` record is registered intent, the run
 *               is a separate record)
 *
 * Both RPCs are streaming. The route reads the first event to confirm
 * dispatch, returns 200, and lets the mission detail page's existing
 * /api/missions/[id]/events SSE relay carry the rest of the lifecycle frames.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // CSRF — zero-trust-hardening Req 11.5
    try {
      await requireCsrf(request);
    } catch (err) {
      if (err instanceof CsrfError) return csrfErrorResponse(err);
      throw err;
    }

    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    // Authz enforced by daemon ext-authz on the downstream RPC.

    const { id } = await params;

    // Look up the mission so we can branch on status and (for pending
    // missions) read mission_definition_id + target_id to feed RunMission.
    const missionList = await listMissions(false, 1000, session?.user?.id);
    const mission = missionList.missions.find((m) => m.id === id);

    if (!mission) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Mission not found' } },
        { status: 404 }
      );
    }

    const status = (mission.status?.toLowerCase().replace('mission_status_', '') || '').trim();

    if (status === 'paused') {
      const result = await resumeMission(id, session?.user?.id);
      return NextResponse.json({
        success: true,
        message: 'Mission resumed',
        missionId: id,
        event: result.event,
      });
    }

    if (status === 'pending') {
      if (!mission.missionDefinitionId || !mission.targetId) {
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_STATE',
              message: 'Mission is missing mission_definition_id or target_id; cannot dispatch',
            },
          },
          { status: 422 }
        );
      }

      const result = await runMission(
        mission.missionDefinitionId,
        mission.targetId,
        {},
        'isolated',
        session?.user?.id
      );

      return NextResponse.json({
        success: true,
        message: 'Mission started',
        // The dispatched run is a NEW mission record; the original `pending`
        // mission stays as the registered intent. Surface the new id so the
        // UI can navigate to / observe the actual execution.
        missionId: result.missionId || id,
        event: result.event,
      });
    }

    return NextResponse.json(
      {
        error: {
          code: 'CONFLICT',
          message: `Mission is in '${status}' state; only 'pending' or 'paused' missions can be started`,
        },
      },
      { status: 409 }
    );
  } catch (error) {
    return daemonErrorResponse(error, { headers: request.headers });
  }
}
