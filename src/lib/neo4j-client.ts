/**
 * Neo4j Client Utility
 *
 * Server-side singleton for Neo4j database queries.
 * Implements session-per-request pattern for safe concurrent access.
 *
 * Environment variables:
 * - NEO4J_URI: Neo4j connection URI (default: bolt://localhost:7687)
 * - NEO4J_USER: Neo4j username (default: neo4j)
 * - NEO4J_PASSWORD: Neo4j password (required)
 */

import neo4j, { Driver, Session } from 'neo4j-driver';
import type { GraphNode, GraphEdge } from '@/src/types/graph';
import { serverConfig } from './config';

// Environment configuration with defaults
const NEO4J_URI = serverConfig.neo4jUri;
const NEO4J_USER = serverConfig.neo4jUser;
const NEO4J_PASSWORD = serverConfig.neo4jPassword;

// Node color mapping - will be updated with new theme colors from design spec in later tasks
const NODE_COLORS: Record<string, string> = {
  Mission: '#f59e0b',        // amber-500 - missions are the center
  MissionStep: '#d97706',    // amber-600 - darker amber for steps
  MissionNode: '#fbbf24',    // amber-400 - mission nodes
  AgentExecution: '#fb923c', // orange-400 - executions
  mission_run: '#fcd34d',    // amber-300 - bright amber for runs
  Host: '#3b82f6',           // blue-500
  Service: '#8b5cf6',        // purple-500
  Vulnerability: '#ef4444',  // red-500
  Finding: '#f97316',        // orange-500
  Credential: '#eab308',     // yellow-500
  Endpoint: '#22c55e',       // green-500
  testnode: '#06b6d4',       // cyan-500
  default: '#6b7280',        // gray-500
};

// Node icon mapping (lucide icon names)
const NODE_ICONS: Record<string, string> = {
  Mission: 'rocket',
  MissionStep: 'git-commit',
  MissionNode: 'git-branch',
  AgentExecution: 'cpu',
  mission_run: 'play-circle',
  Host: 'server',
  Service: 'box',
  Vulnerability: 'shield-alert',
  Finding: 'flag',
  Credential: 'key',
  Endpoint: 'globe',
  testnode: 'flask-conical',
  default: 'circle',
};

// Singleton driver instance
let driver: Driver | null = null;

/**
 * Get or create the Neo4j driver singleton.
 *
 * The driver manages connection pooling internally and is safe
 * to use across multiple requests.
 *
 * @returns Neo4j driver instance
 * @throws Error if connection fails or credentials are missing
 */
export function getNeo4jDriver(): Driver {
  if (!driver) {
    if (!NEO4J_PASSWORD) {
      console.warn('NEO4J_PASSWORD not set - Neo4j client may fail to connect');
    }

    try {
      driver = neo4j.driver(
        NEO4J_URI,
        neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
        {
          maxConnectionPoolSize: 50,
          connectionAcquisitionTimeout: 60000, // 60 seconds
          maxTransactionRetryTime: 30000,      // 30 seconds
        }
      );

      if (process.env.NODE_ENV === 'development') {
        console.log(`Neo4j driver initialized: ${NEO4J_URI}`);
      }
    } catch (error) {
      console.error('Failed to initialize Neo4j driver:', error);
      throw new Error(`Neo4j connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return driver;
}

/**
 * Execute a query within a managed session.
 * Automatically closes the session after query completes.
 *
 * @param queryFn - Function that receives a session and executes queries
 * @returns Result from the query function
 */
async function withSession<T>(queryFn: (session: Session) => Promise<T>): Promise<T> {
  const driver = getNeo4jDriver();
  const session = driver.session({
    database: 'neo4j', // Default database
  });

  try {
    return await queryFn(session);
  } catch (error) {
    console.error('Neo4j query error:', error);
    throw error;
  } finally {
    await session.close();
  }
}

/**
 * Get the color for a node based on its labels.
 * Uses the first recognized label or default gray.
 *
 * @param labels - Array of node labels
 * @returns Hex color string
 */
function getNodeColor(labels: string[]): string {
  for (const label of labels) {
    if (NODE_COLORS[label]) {
      return NODE_COLORS[label];
    }
  }
  return NODE_COLORS.default;
}

/**
 * Get the icon for a node based on its labels.
 * Uses the first recognized label or default circle.
 *
 * @param labels - Array of node labels
 * @returns Icon identifier string
 */
function getNodeIcon(labels: string[]): string {
  for (const label of labels) {
    if (NODE_ICONS[label]) {
      return NODE_ICONS[label];
    }
  }
  return NODE_ICONS.default;
}

/**
 * Query all nodes and edges related to a mission.
 *
 * Retrieves all nodes connected to the mission within 3 hops,
 * along with all relationships between those nodes.
 *
 * @param missionId - Mission identifier
 * @param tenantId - Tenant identifier for data isolation
 * @returns Object containing nodes and edges arrays
 * @throws Error if query fails
 */
export async function getMissionGraph(missionId: string, tenantId: string): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
}> {
  return withSession(async (session) => {
    // Query all nodes connected to mission (up to 3 hops)
    const nodesResult = await session.run(
      `
      MATCH (m:Mission {id: $missionId})-[*0..3]-(n)
      WHERE m.tenant_id = $tenantId
      RETURN DISTINCT n, labels(n) as labels
      LIMIT 500
      `,
      { missionId, tenantId }
    );

    // Transform nodes to GraphNode format
    const nodes: GraphNode[] = nodesResult.records.map((record) => {
      const node = record.get('n');
      const labels = record.get('labels') as string[];
      const properties = node.properties;

      // Convert Neo4j Integer types to JavaScript numbers
      const serializedProps: Record<string, any> = {};
      for (const [key, value] of Object.entries(properties)) {
        if (value && typeof value === 'object' && 'toNumber' in value && typeof (value as any).toNumber === 'function') {
          serializedProps[key] = (value as any).toNumber();
        } else {
          serializedProps[key] = value;
        }
      }

      return {
        id: properties.id || node.identity.toString(),
        labels,
        properties: serializedProps,
        color: getNodeColor(labels),
        icon: getNodeIcon(labels),
      };
    });

    // Get all node IDs for relationship query
    const nodeIds = nodes.map((n) => n.id);

    if (nodeIds.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Query all relationships between the nodes
    const edgesResult = await session.run(
      `
      MATCH (n1)-[r]-(n2)
      WHERE n1.id IN $nodeIds AND n2.id IN $nodeIds AND n1 <> n2
        AND n1.tenant_id = $tenantId AND n2.tenant_id = $tenantId
      RETURN DISTINCT r, type(r) as relType,
             startNode(r).id as sourceId,
             endNode(r).id as targetId,
             id(r) as relId
      `,
      { nodeIds, tenantId }
    );

    // Transform relationships to GraphEdge format
    const edges: GraphEdge[] = edgesResult.records.map((record) => {
      const rel = record.get('r');
      const relType = record.get('relType');
      const sourceId = record.get('sourceId');
      const targetId = record.get('targetId');
      const relId = record.get('relId');

      // Convert Neo4j Integer types to JavaScript numbers
      const serializedProps: Record<string, any> = {};
      if (rel.properties) {
        for (const [key, value] of Object.entries(rel.properties)) {
          if (value && typeof value === 'object' && 'toNumber' in value && typeof (value as any).toNumber === 'function') {
            serializedProps[key] = (value as any).toNumber();
          } else {
            serializedProps[key] = value;
          }
        }
      }

      return {
        id: relId.toString(),
        type: relType,
        source: sourceId,
        target: targetId,
        properties: serializedProps,
      };
    });

    console.log(`Fetched mission graph for ${missionId}: ${nodes.length} nodes, ${edges.length} edges`);

    return { nodes, edges };
  });
}

/**
 * Close the Neo4j driver and clean up all connections.
 *
 * Should be called during application shutdown.
 * After calling this, getNeo4jDriver() will create a new instance.
 */
export async function closeDriver(): Promise<void> {
  if (driver) {
    try {
      await driver.close();
      console.log('Neo4j driver closed');
    } catch (error) {
      console.error('Error closing Neo4j driver:', error);
    } finally {
      driver = null;
    }
  }
}

/**
 * Verify Neo4j connection is working.
 *
 * Useful for health checks and initialization validation.
 *
 * @returns True if connection is successful, false otherwise
 */
export async function verifyConnection(): Promise<boolean> {
  try {
    const driver = getNeo4jDriver();
    await driver.verifyConnectivity();
    console.log('Neo4j connection verified');
    return true;
  } catch (error) {
    console.error('Neo4j connection verification failed:', error);
    return false;
  }
}

/**
 * Graph filter options for full graph queries.
 */
export interface GraphFilterOptions {
  labels?: string[];
  search?: string;
  limit?: number;
}

/**
 * Graph statistics for dashboard display.
 */
export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  nodesByLabel: Record<string, number>;
  relationshipTypes: Record<string, number>;
}

/**
 * Query the full knowledge graph with optional filtering.
 *
 * @param tenantId - Tenant identifier for data isolation
 * @param options - Filter options for the query
 * @returns Object containing nodes and edges arrays
 */
export async function getFullGraph(tenantId: string, options: GraphFilterOptions = {}): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
}> {
  const { labels = [], search = '', limit = 500 } = options;

  return withSession(async (session) => {
    // Build the node query with optional filters
    // tenant_id is always the first WHERE condition to guarantee isolation
    let nodeQuery = 'MATCH (n)';
    const params: Record<string, any> = { limit: neo4j.int(limit), tenantId };

    // tenant_id filter is always applied — no exceptions
    nodeQuery += ' WHERE n.tenant_id = $tenantId';

    if (labels.length > 0) {
      // Filter by specific labels
      const labelConditions = labels.map((_, i) => `n:\`${labels[i]}\``).join(' OR ');
      nodeQuery += ` AND (${labelConditions})`;
    }

    if (search) {
      nodeQuery += ` AND (
        n.name =~ $searchPattern OR
        n.id =~ $searchPattern OR
        n.status =~ $searchPattern
      )`;
      params.searchPattern = `(?i).*${search}.*`;
    }

    nodeQuery += ' RETURN DISTINCT n, labels(n) as labels LIMIT $limit';

    const nodesResult = await session.run(nodeQuery, params);

    // Transform nodes to GraphNode format
    const nodes: GraphNode[] = nodesResult.records.map((record) => {
      const node = record.get('n');
      const nodeLabels = record.get('labels') as string[];
      const properties = node.properties;

      // Convert Neo4j Integer types to JavaScript numbers
      const serializedProps: Record<string, any> = {};
      for (const [key, value] of Object.entries(properties)) {
        if (value && typeof value === 'object' && 'toNumber' in value && typeof (value as any).toNumber === 'function') {
          serializedProps[key] = (value as any).toNumber();
        } else {
          serializedProps[key] = value;
        }
      }

      // Determine display name
      const displayName = properties.name || properties.id || node.identity.toString();

      return {
        id: properties.id || node.identity.toString(),
        labels: nodeLabels,
        properties: { ...serializedProps, displayName },
        color: getNodeColor(nodeLabels),
        icon: getNodeIcon(nodeLabels),
      };
    });

    // Get all node IDs for relationship query
    const nodeIds = nodes.map((n) => n.id);

    if (nodeIds.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Query all relationships between the nodes
    const edgesResult = await session.run(
      `
      MATCH (n1)-[r]->(n2)
      WHERE n1.id IN $nodeIds AND n2.id IN $nodeIds
        AND n1.tenant_id = $tenantId AND n2.tenant_id = $tenantId
      RETURN DISTINCT r, type(r) as relType,
             n1.id as sourceId,
             n2.id as targetId,
             id(r) as relId
      `,
      { nodeIds, tenantId }
    );

    // Transform relationships to GraphEdge format
    const edges: GraphEdge[] = edgesResult.records.map((record) => {
      const rel = record.get('r');
      const relType = record.get('relType');
      const sourceId = record.get('sourceId');
      const targetId = record.get('targetId');
      const relId = record.get('relId');

      // Convert Neo4j Integer types to JavaScript numbers
      const serializedProps: Record<string, any> = {};
      if (rel.properties) {
        for (const [key, value] of Object.entries(rel.properties)) {
          if (value && typeof value === 'object' && 'toNumber' in value && typeof (value as any).toNumber === 'function') {
            serializedProps[key] = (value as any).toNumber();
          } else {
            serializedProps[key] = value;
          }
        }
      }

      return {
        id: `${relId}`,
        type: relType,
        source: sourceId,
        target: targetId,
        properties: serializedProps,
      };
    });

    console.log(`Fetched full graph: ${nodes.length} nodes, ${edges.length} edges`);

    return { nodes, edges };
  });
}

/**
 * Get statistics about the knowledge graph.
 *
 * @param tenantId - Tenant identifier for data isolation
 * @returns Graph statistics object
 */
export async function getGraphStats(tenantId: string): Promise<GraphStats> {
  return withSession(async (session) => {
    // Count nodes by label
    const nodeCountResult = await session.run(`
      MATCH (n)
      WHERE n.tenant_id = $tenantId
      UNWIND labels(n) as label
      RETURN label, count(*) as count
      ORDER BY count DESC
    `, { tenantId });

    const nodesByLabel: Record<string, number> = {};
    let totalNodes = 0;
    nodeCountResult.records.forEach((record) => {
      const label = record.get('label');
      const count = record.get('count').toNumber ? record.get('count').toNumber() : record.get('count');
      nodesByLabel[label] = count;
      totalNodes += count;
    });

    // Count relationships by type — filter via endpoint nodes to enforce tenant isolation
    const edgeCountResult = await session.run(`
      MATCH (n1)-[r]->(n2)
      WHERE n1.tenant_id = $tenantId AND n2.tenant_id = $tenantId
      RETURN type(r) as type, count(*) as count
      ORDER BY count DESC
    `, { tenantId });

    const relationshipTypes: Record<string, number> = {};
    let totalEdges = 0;
    edgeCountResult.records.forEach((record) => {
      const type = record.get('type');
      const count = record.get('count').toNumber ? record.get('count').toNumber() : record.get('count');
      relationshipTypes[type] = count;
      totalEdges += count;
    });

    return {
      totalNodes,
      totalEdges,
      nodesByLabel,
      relationshipTypes,
    };
  });
}
