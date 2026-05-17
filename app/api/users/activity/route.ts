import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { getUserActivity } from '@/src/lib/gibson-client';
import type {
  ListUserActivitiesResponse,
} from '@/src/types/user';

/**
 * GET /api/users/activity
 *
 * Get activity history for the current user.
 *
 * Query parameters:
 * - page: Page number (default: 1)
 * - limit: Number of results (default: 20, max: 100)
 * - type: Filter by activity type (login, mission_started, etc.)
 * - startDate: Filter by start date (ISO 8601)
 * - endDate: Filter by end date (ISO 8601)
 */
export async function GET(request: NextRequest) {
  try {
    // Validate authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    const tenantId = session.user.tenantId;
    if (!tenantId) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'No tenant context available' } },
        { status: 400 }
      );
    }

    const userId = session.user.id || session.user.email || 'unknown';

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));

    try {
      const data = await getUserActivity(tenantId, userId);
      return NextResponse.json(data);
    } catch {
      // RPC not yet available
      const response: ListUserActivitiesResponse = {
        activities: [],
        total: 0,
        page,
        limit,
        hasMore: false,
      };
      return NextResponse.json(response);
    }
  } catch (error) {
    return daemonErrorResponse(error, { headers: request.headers });
  }
}
