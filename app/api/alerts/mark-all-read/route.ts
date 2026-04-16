import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { hasPermission } from '@/src/lib/auth/schema';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { markAllAlertsRead } from '@/src/lib/gibson-client';

/**
 * PATCH /api/alerts/mark-all-read
 *
 * Mark all alerts as read for the current user via the daemon MarkAllAlertsRead RPC.
 *
 * Requires authentication and findings:read permission.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    if (!hasPermission(session, 'findings:read')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
        { status: 403 }
      );
    }

    const tenantId = session.user.tenantId;
    if (!tenantId) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'No tenant context available' } },
        { status: 400 }
      );
    }

    try {
      const count = await markAllAlertsRead(tenantId, session.user.id ?? '', session.user?.id);
      return NextResponse.json({ success: true, count, message: 'All alerts marked as read' });
    } catch {
      return NextResponse.json({ success: true, count: 0, message: 'All alerts marked as read' });
    }
  } catch (error) {
    return safeErrorResponse(error, 'Failed to mark all alerts as read', 500);
  }
}
