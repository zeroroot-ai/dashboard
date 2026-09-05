import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { daemonErrorResponse } from '@/src/lib/api-errors';
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
    // CSRF, zero-trust-hardening Req 11.5
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

    const result = await resumeMission(id, session?.user?.id);

    return NextResponse.json({
      success: true,
      message: 'Mission resumed',
      missionId: id,
    });
  } catch (error) {
    return daemonErrorResponse(error, { headers: request.headers });
  }
}
