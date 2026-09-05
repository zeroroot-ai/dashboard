/**
 * Graph Statistics API Route
 *
 * GET /api/graph/stats, Fetch knowledge graph statistics via
 * GraphService.GetGraphStats.
 *
 * Spec: dashboard-direct-neo4j-removal (Phase 3, Task 11).
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { GraphService } from '@/src/gen/gibson/graph/v1/graph_pb';

export async function GET(request: NextRequest) {
  // Validate authentication
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fail closed: require an active tenant before querying graph stats.
  // The daemon resolves tenant context from SPIFFE mTLS; tenantId is
  // not passed to the RPC but guards against unauthenticated queries.
  try {
    await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  try {
    const resp = await userClient(GraphService).getGraphStats({});

    // Build nodesByLabel map from the repeated NodeCountByLabel message.
    const nodesByLabel: Record<string, number> = {};
    for (const entry of resp.byLabel) {
      nodesByLabel[entry.label] = Number(entry.count);
    }

    // Preserve the existing JSON shape:
    //   { totalNodes, totalEdges, nodesByLabel, relationshipTypes, nodesByType }
    // relationshipTypes is not returned by GetGraphStats (proto omits it);
    // return an empty object so callers that read it gracefully get no entries.
    return NextResponse.json({
      totalNodes: Number(resp.totalNodes),
      totalEdges: Number(resp.totalEdges),
      nodesByLabel,
      nodesByType: nodesByLabel,   // alias, useGraph.ts GraphStats interface uses nodesByType
      relationshipTypes: {} as Record<string, number>,
      lastWriteAt: resp.lastWriteAt
        ? new Date(Number(resp.lastWriteAt.seconds) * 1000).toISOString()
        : null,
    });
  } catch (err) {
    return daemonErrorResponse(err, {
      headers: request.headers,
      route: 'api/graph/stats',
    });
  }
}
