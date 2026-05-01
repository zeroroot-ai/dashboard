import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { hasPermission } from '@/src/lib/auth/schema';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { resumeMission } from '@/src/lib/gibson-client';

/**
 * POST /api/missions/:id/resume
 *
 * Resume a paused mission.
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

    if (!hasPermission(session, 'missions:execute')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
        { status: 403 }
      );
    }

    const { id } = await params;

    const result = await resumeMission(id, session?.user?.id);

    return NextResponse.json({
      success: true,
      message: 'Mission resumed',
      missionId: id,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to process mission request', 500);
  }
}
