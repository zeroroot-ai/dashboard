/**
 * Findings Counts API Route
 *
 * GET /api/findings/counts — returns { critical, high, medium, low, info }
 * counts via GraphService.GetFindingCounts (SEVERITY grouping).
 *
 * Spec: dashboard-direct-neo4j-removal (Phase 3, Task 11).
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';
import { getServerSession } from '@/src/lib/auth';
import { userClient } from '@/src/lib/gibson-client';
import {
  GraphService,
  FindingCountGroupBy,
} from '@/src/gen/gibson/graph/v1/graph_pb';

/** Map ConnectError codes to HTTP status codes. */
function grpcStatusToHttp(err: ConnectError): number {
  switch (err.code) {
    case Code.PermissionDenied:
    case Code.Unauthenticated:
      return 403;
    case Code.FailedPrecondition:
      return 412;
    case Code.DeadlineExceeded:
      return 504;
    case Code.Unavailable:
      return 503;
    default:
      return 500;
  }
}

export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = session.user.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
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
    if (err instanceof ConnectError) {
      const status = grpcStatusToHttp(err);
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error('[api/findings/counts] unexpected error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
