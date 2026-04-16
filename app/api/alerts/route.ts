import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { hasPermission } from '@/src/lib/auth/schema';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { listAlerts } from '@/src/lib/gibson-client';

/**
 * GET /api/alerts
 *
 * Fetch alerts for the current user via the daemon ListAlerts RPC.
 * Query parameters:
 * - limit: number (default: 50, max: 100)
 * - unreadOnly: boolean (default: false)
 *
 * Requires authentication and findings:read permission.
 */
export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)));
    const unreadOnly = searchParams.get('unreadOnly') === 'true';

    try {
      const alerts = await listAlerts(tenantId, session.user.id ?? '', { unreadOnly, limit }, session.user?.id);
      return NextResponse.json({ alerts, total: alerts.length });
    } catch {
      return NextResponse.json({ alerts: [], total: 0 });
    }
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch alerts', 500);
  }
}
