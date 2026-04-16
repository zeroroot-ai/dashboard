import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { hasPermission } from '@/src/lib/auth/schema';
import { getMissionHeatmap } from '@/src/lib/gibson-client';
import type { MissionHeatmap } from '@/src/types';

/**
 * GET /api/analytics/missions/heatmap
 *
 * Retrieve mission activity heatmap.
 * Shows mission count and success rate for each day.
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

  // Check permissions
  if (!hasPermission(session, 'findings:read')) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
      { status: 403 }
    );
  }

  const tenantId = session.user.tenantId;
  if (!tenantId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'No tenant context in session' } },
      { status: 401 }
    );
  }

  try {
    const data = await getMissionHeatmap(tenantId, session?.user?.id);
    return NextResponse.json(data);
  } catch {
    // RPC not yet available — return empty heatmap
    const today = new Date().toISOString().split('T')[0];
    const heatmap: MissionHeatmap = {
      startDate: today,
      endDate: today,
      cells: [],
    };
    return NextResponse.json(heatmap);
  }
}
