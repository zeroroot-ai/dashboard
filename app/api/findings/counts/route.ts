/**
 * Findings Counts API Route
 *
 * GET /api/findings/counts, returns { critical, high, medium, low, info }
 * counts via GraphService.GetFindingCounts (SEVERITY grouping).
 *
 * Spec: dashboard-direct-neo4j-removal (Phase 3, Task 11).
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import {
  GraphService,
  FindingCountGroupBy,
} from '@/src/gen/gibson/graph/v1/graph_pb';

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  try {
    const resp = await userClient(GraphService).getFindingCounts({
      groupBy: FindingCountGroupBy.SEVERITY,
    });

    // Preserve existing JSON shape: { critical, high, medium, low, info }
    const counts: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };

    for (const bucket of resp.buckets) {
      const key = bucket.label.toLowerCase();
      if (key in counts) {
        counts[key] = Number(bucket.count);
      }
    }

    return NextResponse.json(counts);
  } catch (err) {
    return daemonErrorResponse(err, {
      headers: request.headers,
      route: 'api/findings/counts',
    });
  }
}
