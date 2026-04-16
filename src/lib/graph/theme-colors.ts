/**
 * Theme Colors Configuration Module
 * Provides theme-specific color palettes for knowledge graph rendering
 */

// ============================================================================
// Entity and Relationship Type Definitions
// ============================================================================

/**
 * Entity types in the knowledge graph
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
 * Relationship types between entities
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
  | 'BELONGS_TO';

/**
 * Finding severity levels
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// ============================================================================
// Theme Colors Interface
// ============================================================================

/**
 * Glow color configuration for visual effects
 */
export interface GlowColors {
  primary: string;
  active: string;
  critical: string;
  success: string;
}

/**
 * Complete theme color configuration for graph visualization
 */
export interface ThemeColors {
  /** Canvas background color */
  background: string;

  /** Grid line color */
  grid: string;

  /** Glow effect colors for highlights and states */
  glowColors: GlowColors;

  /** Colors for each node entity type */
  nodeColors: Record<EntityType, string>;

  /** Colors for each edge relationship type */
  edgeColors: Record<RelationshipType, string>;

  /** Colors for finding severity levels */
  severityColors: Record<Severity, string>;
}

// ============================================================================
// Dark Theme (Amber Terminal Aesthetic)
// ============================================================================

/**
 * Dark theme color palette with hacker-green terminal aesthetic
 * - Background: zinc-950 cold black
 * - Grid: Green-tinted subtle overlay
 * - Green phosphor glow effects
 * - Node colors in green palette with blue/teal/violet accents
 */
export const DARK_THEME: ThemeColors = {
  background: '#09090b',
  grid: 'rgba(34, 197, 94, 0.06)',

  glowColors: {
    primary: 'rgba(34, 197, 94, 0.4)', // green glow
    active: 'rgba(0, 255, 65, 0.3)', // bright green hover/active
    critical: 'rgba(255, 68, 68, 0.8)', // Red for critical findings
    success: 'rgba(34, 197, 94, 0.6)', // Green for completed
  },

  severityColors: {
    critical: '#ff4444',
    high: '#ff8c00',
    medium: '#ffb000',
    low: '#6b8aab',
    info: '#6b7280',
  },

  // Node type colors (hacker-green palette with accents)
  nodeColors: {
    mission: '#22c55e',        // green-500
    mission_run: '#4ade80',    // green-400
    agent_run: '#a78bfa',      // violet-400 (AI agent)
    tool_execution: '#fbbf24', // amber-400
    llm_call: '#c084fc',       // purple-400
    domain: '#3b82f6',         // blue-500
    subdomain: '#60a5fa',      // blue-400
    host: '#10b981',           // emerald-500
    port: '#14b8a6',           // teal-500
    service: '#2dd4bf',        // teal-400
    endpoint: '#06b6d4',       // cyan-500
    technology: '#8b5cf6',     // violet-500
    certificate: '#0ea5e9',    // sky-500
    finding: '#ef4444',        // red-500
    evidence: '#6b7280',       // gray-500
    technique: '#f472b6',      // pink-400
  },

  // Edge relationship colors (green-theme grouping)
  edgeColors: {
    // Structural relationships (green tones)
    HAS_SUBDOMAIN: 'rgba(34, 197, 94, 0.25)',
    HAS_PORT: 'rgba(34, 197, 94, 0.25)',
    RUNS_SERVICE: 'rgba(34, 197, 94, 0.25)',
    HAS_ENDPOINT: 'rgba(34, 197, 94, 0.25)',
    HAS_EVIDENCE: '#6b7280',

    // Discovery relationships (blue tones)
    DISCOVERED: '#3b82f6',
    AFFECTS: '#ef4444',
    BELONGS_TO: '#60a5fa',
    RESOLVES_TO: '#10b981',

    // Execution relationships (bright green)
    USED_TOOL: 'rgba(34, 197, 94, 0.6)',
    DELEGATED_TO: '#00ff41',

    // Cross-entity relationships (violet/pink)
    USES_TECHNOLOGY: '#8b5cf6',
    SERVES_CERTIFICATE: '#0ea5e9',
    USES_TECHNIQUE: '#f472b6',
    LEADS_TO: '#c084fc',
  },
};

// ============================================================================
// Light Theme (Cream Paper Aesthetic)
// ============================================================================

/**
 * Light theme color palette with cream background and darker green values
 * - Background: Warm cream/beige
 * - Grid: Subtle green overlay
 * - Darker green glows for light background visibility
 * - Darker, more saturated green-hue colors for light background
 */
export const LIGHT_THEME: ThemeColors = {
  background: '#faf6eb',
  grid: 'rgba(22, 163, 74, 0.08)',

  glowColors: {
    primary: 'rgba(22, 163, 74, 0.4)', // dark green glow
    active: 'rgba(5, 150, 105, 0.5)', // emerald green active
    critical: 'rgba(200, 40, 40, 0.6)', // Dark red
    success: 'rgba(22, 163, 74, 0.4)',
  },

  severityColors: {
    critical: '#c82828',
    high: '#d35400',
    medium: '#b8860b',
    low: '#4a6fa5',
    info: '#6b7280',
  },

  // Darker green-hue variants for light background
  nodeColors: {
    mission: '#16a34a',        // green-600
    mission_run: '#22c55e',    // green-500
    agent_run: '#7c3aed',      // violet-600
    tool_execution: '#d97706', // amber-600
    llm_call: '#9333ea',       // purple-600
    domain: '#2563eb',         // blue-600
    subdomain: '#3b82f6',      // blue-500
    host: '#059669',           // emerald-600
    port: '#0d9488',           // teal-600
    service: '#14b8a6',        // teal-500
    endpoint: '#0891b2',       // cyan-600
    technology: '#7c3aed',     // violet-600
    certificate: '#0284c7',    // sky-600
    finding: '#dc2626',        // red-600
    evidence: '#4b5563',       // gray-600
    technique: '#db2777',      // pink-600
  },

  // Edge relationship colors (darker green-hue versions for light theme)
  edgeColors: {
    // Structural relationships (green tones)
    HAS_SUBDOMAIN: '#16a34a',
    HAS_PORT: '#16a34a',
    RUNS_SERVICE: '#16a34a',
    HAS_ENDPOINT: '#16a34a',
    HAS_EVIDENCE: '#4b5563',

    // Discovery relationships (blue tones)
    DISCOVERED: '#2563eb',
    AFFECTS: '#dc2626',
    BELONGS_TO: '#3b82f6',
    RESOLVES_TO: '#059669',

    // Execution relationships (dark green tones)
    USED_TOOL: '#15803d',
    DELEGATED_TO: '#166534',

    // Cross-entity relationships (violet/pink)
    USES_TECHNOLOGY: '#7c3aed',
    SERVES_CERTIFICATE: '#0284c7',
    USES_TECHNIQUE: '#db2777',
    LEADS_TO: '#9333ea',
  },
};

// ============================================================================
// Theme Selection Function
// ============================================================================

/**
 * Get theme colors based on current theme
 *
 * @param theme - Theme mode ('dark' or 'light')
 * @returns Complete theme color configuration
 *
 * @example
 * ```typescript
 * const colors = getThemeColors('dark');
 * ctx.fillStyle = colors.background;
 * ctx.strokeStyle = colors.nodeColors.mission;
 * ```
 */
export function getThemeColors(theme: 'dark' | 'light'): ThemeColors {
  return theme === 'dark' ? DARK_THEME : LIGHT_THEME;
}
