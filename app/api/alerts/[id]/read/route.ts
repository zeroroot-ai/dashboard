import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';

/**
 * PATCH /api/alerts/[id]/read
 *
 * In-app alerts feature is DEFERRED per admin-services-completion spec.
 * Returns a successful no-op response so any client-side optimistic update
 * does not surface an error.
 *
 * Requires authentication.
 */
export async function PATCH(
  _request: NextRequest,
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

    const { id: alertId } = await params;
    return NextResponse.json({ success: true, alertId, message: 'Alert marked as read' });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
