/**
 * Graph Context Retriever
 *
 * Fetches a node and its neighborhood from the daemon via
 * GraphService.GetGraphContext, for use in the chatbot's system prompt.
 *
 * Spec: dashboard-direct-neo4j-removal (Phase 3, Task 10).
 */

import 'server-only';
import { userClient } from '@/src/lib/gibson-client';
import { GraphService } from '@/src/gen/gibson/graph/v1/graph_pb';

// ============================================================================
// Types (public interface unchanged)
// ============================================================================

export interface GraphContextNode {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
}

export interface GraphContextNeighbor {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
  relationship: string;
  direction: 'incoming' | 'outgoing';
}

export interface GraphContextData {
  focusNode: GraphContextNode | null;
  neighbors: GraphContextNeighbor[];
  summary: string;
}

const EMPTY_CONTEXT: GraphContextData = {
  focusNode: null,
  neighbors: [],
  summary: '',
};

// ============================================================================
// Core function
// ============================================================================

/**
 * Retrieve graph context for a given node ID via the daemon.
 *
 * Returns the node and its neighborhood serialized for use in an LLM system prompt.
 * Returns empty data (does not throw) if the node doesn't exist or the RPC fails -
 * matches the original soft-fail contract.
 */
export async function getGraphContext(
  nodeId: string,
  opts?: { hops?: number; maxNodes?: number }
): Promise<GraphContextData> {
  const hops = opts?.hops ?? 2;
  const maxNodes = opts?.maxNodes ?? 30;

  try {
    const resp = await userClient(GraphService).getGraphContext({ nodeId, hops, maxNodes });

    // Daemon returns focusNode unset (not an error) when the node doesn't exist.
    if (!resp.focusNode) {
      return EMPTY_CONTEXT;
    }

    const focusNode: GraphContextNode = {
      id: resp.focusNode.id,
      labels: resp.focusNode.labels,
      properties: resp.focusNode.properties as Record<string, unknown>,
    };

    const neighbors: GraphContextNeighbor[] = resp.neighbors
      .filter((n) => n.node !== undefined)
      .map((n) => ({
        id: n.node!.id,
        labels: n.node!.labels,
        properties: n.node!.properties as Record<string, unknown>,
        relationship: n.relationship,
        direction: (n.direction === 'incoming' ? 'incoming' : 'outgoing') as 'incoming' | 'outgoing',
      }));

    return { focusNode, neighbors, summary: resp.summary };
  } catch (error) {
    console.warn('[GraphContext] Failed to retrieve context, proceeding without:', error);
    return EMPTY_CONTEXT;
  }
}
