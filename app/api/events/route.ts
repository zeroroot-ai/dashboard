import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import type { Event, PaginatedResponse } from '@/src/types';

/**
 * GET /api/events
 *
 * Retrieve recent events from the system.
 *
 * Query parameters:
 * - type: Filter by event type (mission, agent, tool, finding, llm, system)
 * - missionId: Filter by mission ID
 * - limit: Number of results (default: 100, max: 500)
 * - offset: Pagination offset
 *
 * Requires authentication.
 *
 * Note: This is a fallback for historical events. For real-time events,
 * use the SSE endpoint at /api/events/stream.
 *
 * Event query RPC is pending implementation in the Gibson daemon.
 * Returns empty results until the RPC is available.
 */
export async function GET(request: NextRequest) {
  // Validate authentication
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    );
  }

  // Parse query parameters
  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
  const offset = parseInt(searchParams.get('offset') || '0');

  // Event query RPC pending, return empty results
  const result: PaginatedResponse<Event> = {
    data: [],
    total: 0,
    page: Math.floor(offset / limit) + 1,
    limit,
    hasMore: false,
  };

  return NextResponse.json(result);
}
