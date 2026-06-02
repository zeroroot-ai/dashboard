/**
 * Theme Colors Configuration Module
 * Provides theme-specific color palettes for knowledge graph rendering.
 *
 * Design notes
 * ------------
 * All canvas-rendered literal colors live here. This file lives under
 * `src/lib/` (not `app/` or `components/`), so it is intentionally
 * outside the `check-no-hardcoded-colors` guard scope — canvas rendering
 * cannot consume CSS custom properties.
 *
 * Colors are aligned to the brand design tokens in `app/globals.css`:
 *   dark mode:
 *     --background  oklch(0.13 0.008 145)  → #0f1714  (deep-navy, lifted off pure black)
 *     --foreground  oklch(0.97 0.01  145)  → #f0f5ef  (near-white)
 *     --primary     oklch(0.86 0.28  145)  → #9ee640  (phosphor green)
 *     --link        oklch(0.78 0.16  220)  → #5bcbe8  (cyan)
 *     --alt         oklch(0.82 0.18   80)  → #e8c535  (amber)
 *     --destructive oklch(0.68 0.24   18)  → #f44336  (crt red)
 *
 * WCAG AA (≥4.5:1 normal text, ≥3:1 large/UI) is satisfied for every
 * text/label/HUD color versus the dark background. See the companion
 * unit tests in `__tests__/theme-colors.test.ts`.
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
  | 'USED_TO'
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
// Dark Theme (single locked dark brand — violet-led)
// ============================================================================

/**
 * The single locked dark brand (#652), violet-led on a near-black blue-violet
 * base, aligned to the globals.css design tokens. There is no light theme.
 *
 * Background: #14121c (≈ oklch(0.17 0.012 280)) — near-black with a faint
 * blue-violet tint, matching --background. Canvas rendering can't read CSS
 * custom properties, so the brand is mirrored here as literals.
 *
 * Node, edge, label, and HUD text colors are contrast-tuned against this
 * background; all text/label colors achieve WCAG AA (≥4.5:1), verified by
 * the companion unit test.
 *
 * Grid/vignette/scanline rendering is handled in KnowledgeGraph3D.tsx; the
 * grid color here is a faint violet overlay so the grid reads against the
 * base without competing with nodes.
 */
export const DARK_THEME: ThemeColors = {
  // Near-black blue-violet, ≈ oklch(0.17 0.012 280) — aligns to --background
  background: '#14121c',

  // Faint violet grid lines — aligned to --primary (oklch 0.58 0.225 295)
  grid: 'rgba(139, 92, 246, 0.07)',

  glowColors: {
    // Electric violet — aligns to --primary / --highlight
    primary: 'rgba(139, 92, 246, 0.45)',
    // Brighter violet active/hover
    active: 'rgba(167, 139, 250, 0.40)',
    // Alert red — aligns to --destructive
    critical: 'rgba(244, 67, 54, 0.8)',
    // Emerald success — aligns to --alt
    success: 'rgba(105, 240, 174, 0.55)',
  },

  // Severity colors — high contrast vs the dark base AND readable on node
  // chips. All hex values achieve ≥4.5:1 vs #14121c.
  severityColors: {
    critical: '#ff5252',  // red-A200
    high:     '#ff9100',  // orange-A400
    medium:   '#ffd740',  // amber-A200
    low:      '#69f0ae',  // emerald-A200
    info:     '#90caf9',  // blue-200
  },

  // Node type colors — bright enough to read over #14121c (≥4.5:1), biased
  // to the violet/blue/emerald/cyan brand family. Used as border/glow accent
  // colors; the node chip body uses dark fills so the icon + border carry the
  // contrast.
  nodeColors: {
    mission:        '#b39dff',  // brand violet (root)
    mission_run:    '#69f0ae',  // emerald-A200
    agent_run:      '#ce93d8',  // purple-200
    tool_execution: '#ffd740',  // amber-A200
    llm_call:       '#ea80fc',  // purple-A100
    domain:         '#82b1ff',  // blue-A100
    subdomain:      '#80d8ff',  // cyan-A100
    host:           '#69f0ae',  // emerald-A200
    port:           '#a7ffeb',  // teal-A100
    service:        '#64ffda',  // teal-A200
    endpoint:       '#84ffff',  // cyan-A100
    technology:     '#b39ddb',  // deep-purple-200
    certificate:    '#80d8ff',  // cyan-A100
    finding:        '#ff5252',  // red-A200
    evidence:       '#b0bec5',  // blue-grey-200
    technique:      '#f48fb1',  // pink-200
  },

  // Edge relationship colors — muted enough to not clutter the canvas, bright
  // enough to be distinguishable. Structural edges use faint violet; execution
  // edges use emerald; semantic edges use distinct hues.
  edgeColors: {
    // Structural relationships — faint brand violet
    HAS_SUBDOMAIN:   'rgba(139, 92, 246, 0.25)',
    HAS_PORT:        'rgba(139, 92, 246, 0.25)',
    RUNS_SERVICE:    'rgba(139, 92, 246, 0.25)',
    HAS_ENDPOINT:    'rgba(139, 92, 246, 0.25)',
    HAS_EVIDENCE:    'rgba(176, 190, 197, 0.5)',

    // Discovery relationships
    DISCOVERED: '#82b1ff',   // blue-A100
    AFFECTS:    '#ff5252',   // red-A200
    BELONGS_TO: '#80d8ff',   // cyan-A100
    RESOLVES_TO:'#69f0ae',   // emerald-A200

    // Execution relationships — emerald
    USED_TO:      'rgba(105, 240, 174, 0.55)',
    USED_TOOL:    'rgba(105, 240, 174, 0.55)',
    DELEGATED_TO: '#b39dff',  // brand violet

    // Cross-entity relationships
    USES_TECHNOLOGY:  '#b39ddb',  // deep-purple-200
    SERVES_CERTIFICATE: '#80d8ff', // cyan-A100
    USES_TECHNIQUE:   '#f48fb1',   // pink-200
    LEADS_TO:         '#ea80fc',   // purple-A100
  },
};

// ============================================================================
// Theme Selection Function
// ============================================================================

/**
 * Return the graph color palette. There is one locked dark brand (#652), so
 * this always returns DARK_THEME — kept as a function for call-site clarity
 * and so the canvas renderer has a single accessor.
 *
 * @example
 * ```typescript
 * const colors = getThemeColors();
 * ctx.fillStyle = colors.background;
 * ctx.strokeStyle = colors.nodeColors.mission;
 * ```
 */
export function getThemeColors(): ThemeColors {
  return DARK_THEME;
}
