/**
 * Entity Taxonomy Module
 *
 * Single source of truth for Gibson taxonomy visual mappings.
 * Defines all entity types, relationship types, and their visual properties
 * (colors, dash patterns, severity colors) for both dark and light themes.
 */

// ============================================================================
// Entity and Relationship Type Definitions
// ============================================================================

/**
 * All entity types in the Gibson knowledge graph taxonomy.
 * Represents the complete set of node types that can exist in the graph.
 */
export type EntityType =
  | 'mission'
  | 'mission_run'
  | 'agent_run'
  | 'tool_execution'
  | 'llm_call'
  | 'domain'
  | 'subdomain'
  | 'host'
  | 'port'
  | 'service'
  | 'endpoint'
  | 'technology'
  | 'certificate'
  | 'finding'
  | 'evidence'
  | 'technique';

/**
 * All relationship types in the Gibson knowledge graph taxonomy.
 * Represents the complete set of edge types that can connect nodes.
 */
export type RelationshipType =
  | 'HAS_SUBDOMAIN'
  | 'RESOLVES_TO'
  | 'HAS_PORT'
  | 'RUNS_SERVICE'
  | 'HAS_ENDPOINT'
  | 'USES_TECHNOLOGY'
  | 'SERVES_CERTIFICATE'
  | 'AFFECTS'
  | 'HAS_EVIDENCE'
  | 'USES_TECHNIQUE'
  | 'LEADS_TO'
  | 'USED_TOOL'
  | 'DELEGATED_TO'
  | 'DISCOVERED'
  | 'BELONGS_TO'
  | 'PART_OF'
  | 'EXECUTES';

/**
 * Severity levels for findings and vulnerabilities.
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Dash pattern types for edge rendering.
 * Each pattern represents a different category of relationship semantics.
 */
export type DashPattern = 'solid' | 'short-dash' | 'long-dash' | 'dot-dash';

// ============================================================================
// Theme Color Mappings
// ============================================================================

/**
 * Entity type colors for dark theme (hacker-green terminal aesthetic).
 * Uses green shades for execution layer, blue for DNS, emerald/teal for infrastructure,
 * cyan for technical layer, and red/pink for security findings.
 */
const ENTITY_COLORS_DARK: Record<EntityType, string> = {
  // Execution layer, green shades
  mission: '#22c55e',        // green-500
  mission_run: '#4ade80',    // green-400
  agent_run: '#a78bfa',      // violet-400 (AI agent)
  tool_execution: '#fbbf24', // amber-400
  llm_call: '#c084fc',       // purple-400

  // DNS/domain layer, blue
  domain: '#3b82f6',         // blue-500
  subdomain: '#60a5fa',      // blue-400

  // Infrastructure layer, emerald/teal
  host: '#10b981',           // emerald-500
  port: '#14b8a6',           // teal-500
  service: '#2dd4bf',        // teal-400

  // Technical layer, cyan
  endpoint: '#06b6d4',       // cyan-500
  technology: '#8b5cf6',     // violet-500
  certificate: '#0ea5e9',    // sky-500

  // Security layer, red/pink
  finding: '#ef4444',        // red-500
  evidence: '#6b7280',       // gray-500
  technique: '#f472b6',      // pink-400
};

/**
 * Severity colors for finding nodes, tuned for the single dark brand.
 */
const SEVERITY_COLORS_DARK: Record<Severity, string> = {
  critical: '#ff4444',          // Intense red
  high: '#ff8c00',              // Orange
  medium: '#ffb000',            // Amber
  low: '#6b8aab',               // Muted blue-gray
  info: '#6b7280',              // Gray
};

// ============================================================================
// Dash Pattern Mappings
// ============================================================================

/**
 * Canvas lineDash array values for each pattern type.
 *
 * - solid: No dashes (structural relationships)
 * - short-dash: 4px dash, 4px gap (discovery relationships)
 * - long-dash: 12px dash, 6px gap (execution relationships)
 * - dot-dash: 2px dot, 4px gap, 8px dash, 4px gap (cross-entity relationships)
 */
export const DASH_PATTERN_VALUES: Record<DashPattern, number[]> = {
  solid: [],
  'short-dash': [4, 4],
  'long-dash': [12, 6],
  'dot-dash': [2, 4, 8, 4],
};

/**
 * Relationship type to dash pattern mapping.
 * Organized by semantic categories:
 *
 * - Structural (solid): Hierarchical containment relationships
 * - Discovery (short-dash): Reconnaissance and discovery relationships
 * - Execution (long-dash): Tool and delegation relationships
 * - Cross-entity (dot-dash): Technology, technique, and cross-cutting relationships
 */
const RELATIONSHIP_DASH_PATTERNS: Record<RelationshipType, DashPattern> = {
  // Structural relationships (solid)
  HAS_SUBDOMAIN: 'solid',
  HAS_PORT: 'solid',
  RUNS_SERVICE: 'solid',
  HAS_ENDPOINT: 'solid',
  HAS_EVIDENCE: 'solid',

  // Discovery relationships (short-dash)
  DISCOVERED: 'short-dash',
  AFFECTS: 'short-dash',
  BELONGS_TO: 'short-dash',
  RESOLVES_TO: 'short-dash',

  // Execution relationships (long-dash)
  USED_TOOL: 'long-dash',
  DELEGATED_TO: 'long-dash',

  // Cross-entity relationships (dot-dash)
  USES_TECHNOLOGY: 'dot-dash',
  SERVES_CERTIFICATE: 'dot-dash',
  USES_TECHNIQUE: 'dot-dash',
  LEADS_TO: 'dot-dash',
  PART_OF: 'dot-dash',
  EXECUTES: 'dot-dash',
};

// ============================================================================
// Public API Functions
// ============================================================================

/**
 * Get the brand color for an entity type. There is one locked dark brand.
 *
 * @param entityType - The entity type to get color for
 * @returns Hex color string
 *
 * @example
 * ```ts
 * const color = getEntityColor('mission'); // '#22c55e'
 * ```
 */
export function getEntityColor(entityType: EntityType): string {
  return ENTITY_COLORS_DARK[entityType];
}

/**
 * Get the dash pattern for a relationship type.
 *
 * Returns both the pattern type and the canvas lineDash array values.
 *
 * @param relationshipType - The relationship type to get pattern for
 * @returns Object containing pattern type and lineDash array
 *
 * @example
 * ```ts
 * const pattern = getRelationshipDashPattern('DISCOVERED');
 * ctx.setLineDash(pattern.dashArray); // [4, 4]
 * ```
 */
export function getRelationshipDashPattern(relationshipType: RelationshipType | string): {
  pattern: DashPattern;
  dashArray: number[];
} {
  const pattern = RELATIONSHIP_DASH_PATTERNS[relationshipType as RelationshipType] ?? 'solid';
  return {
    pattern,
    dashArray: DASH_PATTERN_VALUES[pattern],
  };
}

/**
 * Get the brand color for a severity level. There is one locked dark brand.
 *
 * Used primarily for finding nodes to indicate risk level.
 *
 * @param severity - The severity level
 * @returns Hex color string
 *
 * @example
 * ```ts
 * const color = getSeverityColor('critical'); // '#ff4444'
 * ```
 */
export function getSeverityColor(severity: Severity): string {
  return SEVERITY_COLORS_DARK[severity];
}

/**
 * Parse entity type from node labels array.
 *
 * Attempts to match known entity types from the labels array.
 * Returns the first matching entity type, or a default if none found.
 *
 * @param labels - Array of label strings from a graph node
 * @returns Matched EntityType or 'host' as default
 *
 * @example
 * ```ts
 * const entityType = parseEntityType(['Mission', 'Active']); // 'mission'
 * const entityType = parseEntityType(['Domain']); // 'domain'
 * ```
 */
export function parseEntityType(labels: string[]): EntityType {
  // Normalize labels to lowercase for case-insensitive matching
  const normalizedLabels = labels.map((l) => l.toLowerCase().replace(/\s+/g, '_'));

  // Define all valid entity types for checking
  const validTypes: EntityType[] = [
    'mission',
    'mission_run',
    'agent_run',
    'tool_execution',
    'llm_call',
    'domain',
    'subdomain',
    'host',
    'port',
    'service',
    'endpoint',
    'technology',
    'certificate',
    'finding',
    'evidence',
    'technique',
  ];

  // Find first matching entity type
  for (const label of normalizedLabels) {
    if (validTypes.includes(label as EntityType)) {
      return label as EntityType;
    }
  }

  // Fallback to 'host' as a reasonable default
  return 'host';
}

/**
 * Get all entity types.
 * Useful for iterating over all types or building UI controls.
 *
 * @returns Array of all EntityType values
 */
export function getAllEntityTypes(): EntityType[] {
  return [
    'mission',
    'mission_run',
    'agent_run',
    'tool_execution',
    'llm_call',
    'domain',
    'subdomain',
    'host',
    'port',
    'service',
    'endpoint',
    'technology',
    'certificate',
    'finding',
    'evidence',
    'technique',
  ];
}

/**
 * Get all relationship types.
 * Useful for iterating over all types or building UI controls.
 *
 * @returns Array of all RelationshipType values
 */
export function getAllRelationshipTypes(): RelationshipType[] {
  return [
    'HAS_SUBDOMAIN',
    'RESOLVES_TO',
    'HAS_PORT',
    'RUNS_SERVICE',
    'HAS_ENDPOINT',
    'USES_TECHNOLOGY',
    'SERVES_CERTIFICATE',
    'AFFECTS',
    'HAS_EVIDENCE',
    'USES_TECHNIQUE',
    'LEADS_TO',
    'USED_TOOL',
    'DELEGATED_TO',
    'DISCOVERED',
    'BELONGS_TO',
    'PART_OF',
    'EXECUTES',
  ];
}
