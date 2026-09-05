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
export const ENTITY_TYPES = [
  // Execution layer.
  'mission',
  'mission_run',
  'agent_run',
  'tool_execution',
  'llm_call',

  // Recon layer.
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

  // Application lifecycle (Taxonomy v2, gibson#1656). A different layer of the
  // same graph: what the tenant ships, what runs, what is wrong with it, and
  // what was done about it.
  'application',
  'repository',
  'image',
  'package',
  'deployment',
  'vulnerability',
  'merge_request',
  'pipeline',
  'control',
] as const;

/**
 * All entity types in the Gibson knowledge graph taxonomy.
 * Represents the complete set of node types that can exist in the graph.
 *
 * Derived from `ENTITY_TYPES` so the union, the parser's accept-list and
 * `getAllEntityTypes()` cannot drift apart: adding a label is one edit, not
 * three. Mirrors gibson `internal/engine/taxonomy/taxonomy.go`.
 */
export type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * All relationship types in the Gibson knowledge graph taxonomy.
 * Represents the complete set of edge types that can connect nodes.
 */
export const RELATIONSHIP_TYPES = [
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

  // Application lifecycle (Taxonomy v2, gibson#1656).
  'HAS_REPOSITORY', // Application -> Repository
  'HAS_DEPLOYMENT', // Application -> Deployment
  'BUILT_FROM',     // Image       -> Repository
  'CONTAINS',       // Image       -> Package
  'RUNS',           // Deployment  -> Image
  'EXPOSES',        // Deployment  -> Host
  'INSTANCE_OF',    // Finding     -> Vulnerability
  'FIXED_BY',       // Finding     -> MergeRequest
  'VERIFIED_BY',    // Finding     -> Pipeline
  'MERGED_INTO',    // MergeRequest-> Repository
  'TOUCHES',        // Finding     -> Control
] as const;

/**
 * All relationship types in the Gibson knowledge graph taxonomy.
 * Derived from `RELATIONSHIP_TYPES` for the same reason as `EntityType`.
 */
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

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
// Acid-concrete brand (ADR-0064): the Dracula ramp + acid frontier, kept in
// lockstep with theme-colors.ts `nodeColors` so getEntityColor and the canvas
// renderer never diverge. One palette, no violet.
const ENTITY_COLORS_DARK: Record<EntityType, string> = {
  mission: '#bd93f9',        // dracula purple (root anchor)
  mission_run: '#50fa7b',    // dracula green
  agent_run: '#ff79c6',      // dracula pink
  tool_execution: '#ffb86c', // dracula orange
  llm_call: '#f1fa8c',       // dracula yellow

  domain: '#8be9fd',         // dracula cyan
  subdomain: '#a3e635',      // acid lime (discovery frontier)

  host: '#69f0ae',           // emerald-A200
  port: '#a7ffeb',           // teal-A100
  service: '#64ffda',        // teal-A200

  endpoint: '#84ffff',       // cyan-A100
  technology: '#d0a3ff',     // light purple
  certificate: '#80d8ff',    // light cyan

  finding: '#ff5555',        // dracula red
  evidence: '#b0bec5',       // blue-grey-200
  technique: '#f48fb1',      // pink-200

  // Application lifecycle (Taxonomy v2, gibson#1656). Chosen by search, not by
  // eye: every hue clears WCAG AA (>=4.5:1) on the terminal ground and is the
  // most separable in-band candidate left once the 16 hues above are placed
  // (min OKLab dE 10.0 to any existing or sibling hue). The bright-on-near-black
  // space is full at 16, so within this family colour narrows the field and the
  // legend's ICON plus label carries identity, never colour alone.
  application: '#4f7eee',    // blue, the lifecycle anchor
  repository: '#9e75c7',     // muted purple, source
  image: '#53adea',          // light blue, built artifact
  package: '#aec775',        // sage, dependency
  deployment: '#c79675',     // warm tan, what runs
  vulnerability: '#d26a94',  // deep rose, the weakness identity
  merge_request: '#be4fee',  // violet, the proposed change
  pipeline: '#e7dac5',       // bone, the verifier
  control: '#f1bbe1',        // pale pink, compliance
};

/**
 * Severity colors for finding nodes, the Dracula ramp (acid-concrete brand,
 * ADR-0064). Kept in lockstep with theme-colors.ts `severityColors`.
 */
const SEVERITY_COLORS_DARK: Record<Severity, string> = {
  critical: '#ff5555', // dracula red
  high: '#ffb86c',     // dracula orange
  medium: '#f1fa8c',   // dracula yellow
  low: '#50fa7b',      // dracula green
  info: '#8be9fd',     // dracula cyan
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

  // Application lifecycle (Taxonomy v2, gibson#1656), classified by the same
  // four semantics as the rows above.
  HAS_REPOSITORY: 'solid',   // structural containment
  HAS_DEPLOYMENT: 'solid',
  BUILT_FROM: 'solid',
  CONTAINS: 'solid',
  RUNS: 'solid',
  EXPOSES: 'solid',
  FIXED_BY: 'long-dash',     // remediation is execution
  VERIFIED_BY: 'long-dash',
  MERGED_INTO: 'long-dash',
  INSTANCE_OF: 'dot-dash',   // identity fan-in, cross-entity
  TOUCHES: 'dot-dash',
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
 * const color = getEntityColor('mission'); // '#bd93f9'
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
 * const color = getSeverityColor('critical'); // '#ff5555'
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

  // Find first matching entity type. The accept-list IS the vocabulary, so a
  // label promoted in gibson's Taxonomy is parseable here the moment it is
  // added to ENTITY_TYPES.
  const validTypes: readonly string[] = ENTITY_TYPES;
  for (const label of normalizedLabels) {
    if (validTypes.includes(label)) {
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
  return [...ENTITY_TYPES];
}

/**
 * Get all relationship types.
 * Useful for iterating over all types or building UI controls.
 *
 * @returns Array of all RelationshipType values
 */
export function getAllRelationshipTypes(): RelationshipType[] {
  return [...RELATIONSHIP_TYPES];
}
