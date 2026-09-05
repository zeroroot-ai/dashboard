import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { getMissionHeatmap } from '@/src/lib/gibson-client';
import { logger } from '@/src/lib/logger';

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

  // Authz enforced by daemon ext-authz on the downstream RPC.

  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  try {
    const data = await getMissionHeatmap(tenantId, session?.user?.id);
    return NextResponse.json(data);
  } catch (err) {
    logger.error(
      { err, route: 'analytics/missions/heatmap' },
      'analytics RPC failed',
    );
    return NextResponse.json(
      {
        error: {
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'Data temporarily unavailable.',
        },
      },
      { status: 503 },
    );
  }
}
