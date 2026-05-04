/**
 * Graph Paths API Route — Phase 4, Task 15
 *
 * POST /api/graph/paths — proxies QueryPaths through daemon.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';
import { getServerSession } from '@/src/lib/auth';
import { userClient } from '@/src/lib/gibson-client';
import { GraphService } from '@/src/gen/gibson/graph/v1/graph_pb';
import type { GraphNode, GraphEdge } from '@/src/types/graph';

/** Map ConnectError codes to HTTP status codes per spec. */
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
  return { id: n.id, labels: n.labels, properties };
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
  return { id: e.id, type: e.type, source: e.sourceId, target: e.targetId, properties };
}

interface PathsRequestBody {
  from_node_id: string;
  to_node_id?: string;
  to_node_kind?: string;
  max_depth?: number;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: PathsRequestBody;
  try {
    body = await request.json() as PathsRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { from_node_id, to_node_id, to_node_kind, max_depth } = body;

  if (!from_node_id) {
    return NextResponse.json({ error: 'from_node_id is required' }, { status: 400 });
  }

  // Validate exactly one of to_node_id or to_node_kind is set.
  const hasToNodeId = !!to_node_id;
  const hasToNodeKind = !!to_node_kind;
  if (hasToNodeId === hasToNodeKind) {
    return NextResponse.json(
      { error: 'Exactly one of to_node_id or to_node_kind must be set' },
      { status: 400 }
    );
  }

  try {
    const client = userClient(GraphService);
    const resp = await client.queryPaths({
      fromNodeId: from_node_id,
      to: hasToNodeId
        ? { case: 'toNodeId', value: to_node_id! }
        : { case: 'toNodeKind', value: to_node_kind! },
      maxDepth: max_depth ?? 5,
    });

    return NextResponse.json({
      paths: resp.paths.map(p => ({ node_ids: p.nodeIds, edge_ids: p.edgeIds })),
      nodes: resp.nodes.map(toGraphNode),
      edges: resp.edges.map(toGraphEdge),
      truncated_paths: resp.truncatedPaths,
    });
  } catch (err) {
    if (err instanceof ConnectError) {
      const status = grpcStatusToHttp(err);
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error('[api/graph/paths] unexpected error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
