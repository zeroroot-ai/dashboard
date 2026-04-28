import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';

/**
 * PATCH /api/alerts/mark-all-read
 *
 * In-app alerts feature is DEFERRED per admin-services-completion spec.
 * Returns a successful no-op response so any client-side optimistic update
 * does not surface an error.
 *
 * Requires authentication.
 */
export async function PATCH(_request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    return NextResponse.json({ success: true, count: 0, message: 'All alerts marked as read' });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to mark all alerts as read', 500);
  }
}
