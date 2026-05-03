import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { getFindingsTimeSeries } from '@/src/lib/gibson-client';
import type { FindingsOverTime, TimeRange } from '@/src/types';

/**
 * GET /api/analytics/findings/time-series
 *
 * Retrieve findings over time with severity breakdown.
 *
 * Query parameters:
 * - timeRange: '24h' | '7d' | '30d' | '90d' (default: '7d')
 *
 * Requires authentication and findings:read permission.
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

  // Authz enforced by daemon ext-authz on the downstream RPC.

  const tenantId = session.user.tenantId;
  if (!tenantId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'No tenant context in session' } },
      { status: 401 }
    );
  }

  // Parse query parameters
  const searchParams = request.nextUrl.searchParams;
  const timeRange = (searchParams.get('timeRange') || '7d') as TimeRange;

  // Validate timeRange
  const validRanges: TimeRange[] = ['24h', '7d', '30d', '90d'];
  if (!validRanges.includes(timeRange)) {
    return NextResponse.json(
      { error: { code: 'INVALID_PARAMETER', message: 'Invalid timeRange parameter' } },
      { status: 400 }
    );
  }

  const daysByRange: Record<TimeRange, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

  try {
    const data = await getFindingsTimeSeries(tenantId, daysByRange[timeRange], session?.user?.id);
    return NextResponse.json(data);
  } catch {
    // RPC not yet available — return empty time series
    const timeSeriesData: FindingsOverTime = {
      timeRange,
      data: [],
    };
    return NextResponse.json(timeSeriesData);
  }
}
