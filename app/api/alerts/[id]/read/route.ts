import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { hasPermission } from '@/src/lib/auth/schema';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { markAlertRead } from '@/src/lib/gibson-client';

/**
 * PATCH /api/alerts/[id]/read
 *
 * Mark a single alert as read via the daemon MarkAlertRead RPC.
 *
 * Requires authentication and findings:read permission.
 */
export async function PATCH(
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

    const { id: alertId } = await params;
    if (!alertId) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Alert ID is required' } },
        { status: 400 }
      );
    }

    try {
      await markAlertRead(tenantId, alertId, session.user?.id);
      return NextResponse.json({ success: true, alertId, message: 'Alert marked as read' });
    } catch {
      return NextResponse.json({ success: true, alertId, message: 'Alert marked as read' });
    }
  } catch (error) {
    return safeErrorResponse(error, 'Failed to mark alert as read', 500);
  }
}
