/**
 * Mission Graph API Route, Phase 4, Task 14
 *
 * GET /api/graph/mission/:id, proxies GetMissionGraph through daemon.
 * Does NOT import direct Neo4j driver.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { GraphService } from '@/src/gen/gibson/graph/v1/graph_pb';
import type { GraphNode, GraphEdge } from '@/src/types/graph';

/** Map proto Node to dashboard GraphNode shape. */
function toGraphNode(n: { id: string; labels: string[]; properties: Record<string, string>; severity: string }): GraphNode {
  const properties: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(n.properties)) {
    try {
      properties[k] = JSON.parse(v);
    } catch {
      properties[k] = v;
    }
  }
  if (n.severity) {
    properties.severity = n.severity;
  }
  return {
    id: n.id,
    labels: n.labels,
    properties,
  };
}

/** Map proto Edge to dashboard GraphEdge shape. */
function toGraphEdge(e: { id: string; sourceId: string; targetId: string; type: string; properties: Record<string, string> }): GraphEdge {
  const properties: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e.properties)) {
    try {
      properties[k] = JSON.parse(v);
    } catch {
      properties[k] = v;
    }
  }
  return {
    id: e.id,
    type: e.type,
    source: e.sourceId,
    target: e.targetId,
    properties,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: missionId } = await params;
  if (!missionId) {
    return NextResponse.json({ error: 'Mission ID is required' }, { status: 400 });
  }

  try {
    const client = userClient(GraphService);
    const resp = await client.getMissionGraph({ missionId });

    return NextResponse.json({
      nodes: resp.nodes.map(toGraphNode),
      edges: resp.edges.map(toGraphEdge),
    });
  } catch (err) {
    return daemonErrorResponse(err, {
      headers: request.headers,
      route: 'api/graph/mission/[id]',
    });
  }
}
