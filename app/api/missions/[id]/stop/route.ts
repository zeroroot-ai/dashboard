import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { hasPermission } from '@/src/lib/auth/schema';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { stopMission } from '@/src/lib/gibson-client';

/**
 * POST /api/missions/:id/stop
 *
 * Stop a running or paused mission.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    if (!hasPermission(session, 'missions:execute')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
        { status: 403 }
      );
    }

    const { id } = await params;

    // Check if force stop is requested
    const body = await request.json().catch(() => ({}));
    const force = body.force === true;

    await stopMission(id, force, session?.user?.id);

    return NextResponse.json({
      success: true,
      message: 'Mission stopped',
      missionId: id,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to process mission request', 500);
  }
}
