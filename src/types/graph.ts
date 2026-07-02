/**
 * Graph data types for knowledge graph visualization.
 */

/**
 * Entity types in the knowledge graph taxonomy.
 * Used for rendering entity-specific icons and visual treatments.
 */
export type EntityType =
  | 'mission' | 'mission_run' | 'agent_run' | 'tool_execution' | 'llm_call'
  | 'domain' | 'subdomain' | 'host' | 'port' | 'service' | 'endpoint' | 'technology' | 'certificate'
  | 'finding' | 'evidence' | 'technique';

/**
 * Relationship types in the knowledge graph.
 * Used for rendering edges with semantic dash patterns.
 */
export type RelationshipType =
  | 'HAS_SUBDOMAIN' | 'RESOLVES_TO' | 'HAS_PORT' | 'RUNS_SERVICE' | 'HAS_ENDPOINT'
  | 'USES_TECHNOLOGY' | 'SERVES_CERTIFICATE' | 'AFFECTS' | 'HAS_EVIDENCE'
  | 'USES_TECHNIQUE' | 'LEADS_TO' | 'USED_TOOL' | 'DELEGATED_TO' | 'DISCOVERED' | 'BELONGS_TO'
  | 'PART_OF' | 'EXECUTES';

/**
 * Dash patterns for edge rendering.
 * Different patterns convey relationship semantics visually.
 */
type DashPattern = 'solid' | 'short-dash' | 'long-dash' | 'dot-dash';

/**
 * Severity levels for findings and security-related entities.
 */
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface GraphNode {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
  color?: string;
  icon?: string;
  /**
   * Optional: Parsed entity type from labels.
   * Used for icon rendering and visual treatments.
   */
  entityType?: EntityType;
}

export interface GraphEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  properties: Record<string, unknown>;
  /**
   * Optional: Typed relationship for semantic edge rendering.
   * Used for dash patterns and animation behaviors.
   */
  relationshipType?: RelationshipType;
}
