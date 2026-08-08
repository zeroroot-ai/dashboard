/**
 * Graph Paths API Route, Phase 4, Task 15
 *
 * POST /api/graph/paths, proxies QueryPaths through daemon.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import {
  EMBEDDING_GATE_REASON,
  isEmbeddingGateMessage,
} from '@/src/lib/embedding-gate';
import { userClient } from '@/src/lib/gibson-client';
import { GraphService } from '@/src/gen/gibson/graph/v1/graph_pb';
import type { GraphNode, GraphEdge } from '@/src/types/graph';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';

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
  // CSRF, src/lib/auth/csrf.ts: the session cookie is sameSite=lax, so a
  // mutating handler must check the double-submit token itself.
  try {
    await requireCsrf(request);
  } catch (err) {
    if (err instanceof CsrfError) return csrfErrorResponse(err);
    throw err;
  }

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
    // Path queries traverse embeddings, so the commonest non-bug failure here
    // is the daemon's "no embedding provider configured" gate. The panel
    // renders a dedicated prompt for it rather than an error, and it used to
    // recognise it by substring-matching the daemon's message on the wire.
    // That message no longer crosses the boundary, so classify it HERE, where
    // the raw text is still in hand, and hand the client a stable sub-code.
    const raw = err instanceof ConnectError ? err.rawMessage : undefined;
    const reason = isEmbeddingGateMessage(raw) ? EMBEDDING_GATE_REASON : undefined;
    return daemonErrorResponse(err, {
      headers: request.headers,
      route: 'api/graph/paths',
      reason,
    });
  }
}
