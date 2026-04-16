/**
 * Graph Context Retriever
 *
 * Queries Neo4j for a node and its neighborhood to provide
 * contextual information to the chatbot's system prompt.
 */

import { getNeo4jDriver } from '@/src/lib/neo4j-client';
import type { Session } from 'neo4j-driver';

// Key properties to include in the LLM summary (keeps token count manageable)
const SUMMARY_PROPERTIES = [
  'name', 'id', 'status', 'severity', 'ip', 'port', 'url',
  'protocol', 'version', 'description', 'cvss', 'cve', 'hostname',
  'domain', 'service', 'product', 'os', 'state',
];

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

/**
 * Retrieve graph context for a given node ID.
 *
 * Returns the node and its neighborhood serialized for use in an LLM system prompt.
 * Returns empty data (does not throw) if the node doesn't exist or Neo4j is unavailable.
 */
export async function getGraphContext(
  nodeId: string,
  opts?: { hops?: number; maxNodes?: number }
): Promise<GraphContextData> {
  const hops = opts?.hops ?? 2;
  const maxNodes = opts?.maxNodes ?? 30;

  let session: Session | null = null;

  try {
    const driver = getNeo4jDriver();
    session = driver.session({ database: 'neo4j' });

    const result = await session.run(
      `
      MATCH (n) WHERE n.id = $nodeId
      OPTIONAL MATCH (n)-[r]-(m)
      WITH n, labels(n) AS focusLabels,
           collect(DISTINCT {
             node: m,
             labels: labels(m),
             rel: type(r),
             dir: CASE WHEN startNode(r) = n THEN 'outgoing' ELSE 'incoming' END
           }) AS allNeighbors
      RETURN n, focusLabels, allNeighbors[0..$maxNodes] AS neighbors,
             size(allNeighbors) AS totalNeighbors
      `,
      { nodeId, maxNodes }
    );

    if (result.records.length === 0) {
      return EMPTY_CONTEXT;
    }

    const record = result.records[0];
    const focusNeo4j = record.get('n');
    const focusLabels = record.get('focusLabels') as string[];
    const neighborsRaw = record.get('neighbors') as Array<{
      node: { properties: Record<string, unknown> };
      labels: string[];
      rel: string;
      dir: string;
    }>;
    const totalNeighbors = toNumber(record.get('totalNeighbors'));

    if (!focusNeo4j) {
      return EMPTY_CONTEXT;
    }

    const focusNode: GraphContextNode = {
      id: nodeId,
      labels: focusLabels,
      properties: serializeProps(focusNeo4j.properties),
    };

    const neighbors: GraphContextNeighbor[] = neighborsRaw
      .filter((n) => n.node)
      .map((n) => ({
        id: (n.node.properties.id as string) || 'unknown',
        labels: n.labels,
        properties: serializeProps(n.node.properties),
        relationship: n.rel,
        direction: n.dir as 'incoming' | 'outgoing',
      }));

    const summary = buildSummary(focusNode, neighbors, totalNeighbors, maxNodes);

    return { focusNode, neighbors, summary };
  } catch (error) {
    console.warn('[GraphContext] Failed to retrieve context, proceeding without:', error);
    return EMPTY_CONTEXT;
  } finally {
    if (session) {
      await session.close();
    }
  }
}

/**
 * Serialize Neo4j properties, converting Integer types to JS numbers
 * and filtering to key properties only.
 */
function serializeProps(properties: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value && typeof value === 'object' && 'toNumber' in value && typeof (value as { toNumber: () => number }).toNumber === 'function') {
      result[key] = (value as { toNumber: () => number }).toNumber();
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Pick only the key properties for the LLM summary to keep token count down.
 */
function pickSummaryProps(properties: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of SUMMARY_PROPERTIES) {
    if (properties[key] !== undefined && properties[key] !== null && properties[key] !== '') {
      picked[key] = properties[key];
    }
  }
  return picked;
}

/**
 * Convert a Neo4j Integer to a JS number.
 */
function toNumber(value: unknown): number {
  if (value && typeof value === 'object' && 'toNumber' in value && typeof (value as { toNumber: () => number }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }
  return typeof value === 'number' ? value : 0;
}

/**
 * Build a text summary of the graph context suitable for an LLM system prompt.
 */
function buildSummary(
  focusNode: GraphContextNode,
  neighbors: GraphContextNeighbor[],
  totalNeighbors: number,
  maxNodes: number
): string {
  const lines: string[] = [];

  // Focus node
  const focusType = focusNode.labels.join(', ');
  const focusProps = pickSummaryProps(focusNode.properties);
  const focusName = (focusProps.name || focusProps.id || focusNode.id) as string;

  lines.push(`## Current Focus: ${focusName} (${focusType})`);

  if (Object.keys(focusProps).length > 0) {
    lines.push('Properties:');
    for (const [key, value] of Object.entries(focusProps)) {
      lines.push(`  - ${key}: ${value}`);
    }
  }

  // Group neighbors by relationship type
  if (neighbors.length > 0) {
    const grouped = new Map<string, GraphContextNeighbor[]>();
    for (const neighbor of neighbors) {
      const key = `${neighbor.direction === 'outgoing' ? '' : '<-'}[${neighbor.relationship}]${neighbor.direction === 'outgoing' ? '->' : ''}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(neighbor);
    }

    lines.push('');
    lines.push('## Connected Nodes');

    for (const [relKey, relNeighbors] of grouped) {
      lines.push(`\n${relKey} (${relNeighbors.length}):`);
      for (const neighbor of relNeighbors) {
        const nType = neighbor.labels.join(', ');
        const nProps = pickSummaryProps(neighbor.properties);
        const nName = (nProps.name || nProps.id || neighbor.id) as string;
        const propsStr = Object.entries(nProps)
          .filter(([k]) => k !== 'name' && k !== 'id')
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        lines.push(`  - ${nName} (${nType})${propsStr ? ` [${propsStr}]` : ''}`);
      }
    }

    if (totalNeighbors > maxNodes) {
      lines.push(`\n... and ${totalNeighbors - maxNodes} more connected nodes`);
    }
  }

  return lines.join('\n');
}
