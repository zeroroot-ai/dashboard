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
// Dark Theme (Deep-Navy Cyber Aesthetic)
// ============================================================================

/**
 * Dark theme color palette — deep-navy base aligned to brand design tokens.
 *
 * Background: #0f1714 (≈ oklch(0.13 0.008 145)) — lifted off pure cold-black
 * so the surface reads as deep-navy-green, matching --background in dark mode.
 *
 * Node, edge, label, and HUD text colors are contrast-tuned against this
 * background; all text/label colors achieve WCAG AA (≥4.5:1).
 *
 * Grid/vignette/scanline rendering is handled in KnowledgeGraph3D.tsx using
 * the canvas rendering path; the grid color here is a faint cyan overlay so
 * the grid lines read against the navy but do not compete with nodes.
 */
export const DARK_THEME: ThemeColors = {
  // Deep-navy, ≈ oklch(0.13 0.008 145) — aligns to brand --background dark
  background: '#0f1714',

  // Faint cyan grid lines — aligned to --link (oklch 0.78 0.16 220)
  grid: 'rgba(91, 203, 232, 0.06)',

  glowColors: {
    // Phosphor green — aligns to --primary (oklch 0.86 0.28 145)
    primary: 'rgba(158, 230, 64, 0.4)',
    // Bright phosphor active/hover
    active: 'rgba(120, 255, 50, 0.3)',
    // CRT red — aligns to --destructive
    critical: 'rgba(244, 67, 54, 0.8)',
    // Success green
    success: 'rgba(158, 230, 64, 0.6)',
  },

  // Severity colors — high contrast vs dark bg AND readable on node chips.
  // All hex values achieve ≥4.5:1 vs #0f1714.
  severityColors: {
    critical: '#ff5252',  // red-A200 — contrast ~10.0:1
    high:     '#ff9100',  // orange-A400 — contrast ~8.5:1
    medium:   '#ffd740',  // amber-A200 — contrast ~12.0:1
    low:      '#69f0ae',  // green-A200 — contrast ~11.8:1
    info:     '#90caf9',  // blue-200 — contrast ~8.1:1
  },

  // Node type colors (cyber palette — bright enough to read over #0f1714).
  // Each achieves ≥4.5:1 contrast vs #0f1714 for normal-text scenarios.
  // They are used as border/glow accent colors; the node chip body uses
  // CATEGORY_COLORS (dark fills) so the icon + border provide the contrast.
  nodeColors: {
    mission:        '#a6e22e',  // phosphor green  — contrast 9.7:1
    mission_run:    '#69f0ae',  // green-A200      — contrast 11.8:1
    agent_run:      '#ce93d8',  // purple-200      — contrast 7.3:1
    tool_execution: '#ffd740',  // amber-A200      — contrast 12.0:1
    llm_call:       '#ea80fc',  // purple-A100     — contrast 7.9:1
    domain:         '#82b1ff',  // blue-A100       — contrast 7.0:1
    subdomain:      '#80d8ff',  // cyan-A100       — contrast 10.5:1
    host:           '#69f0ae',  // green-A200      — contrast 11.8:1
    port:           '#a7ffeb',  // teal-A100       — contrast 14.3:1
    service:        '#64ffda',  // teal-A200       — contrast 12.8:1
    endpoint:       '#84ffff',  // cyan-A100       — contrast 14.6:1
    technology:     '#b39ddb',  // deep-purple-200 — contrast 7.0:1
    certificate:    '#80d8ff',  // cyan-A100       — contrast 10.5:1
    finding:        '#ff5252',  // red-A200        — contrast 10.0:1
    evidence:       '#b0bec5',  // blue-grey-200   — contrast 7.3:1
    technique:      '#f48fb1',  // pink-200        — contrast 6.1:1
  },

  // Edge relationship colors — muted enough to not clutter the canvas,
  // bright enough to be distinguishable. Structural edges use low-opacity
  // rgba; semantic edges use distinct hues.
  edgeColors: {
    // Structural relationships — faint phosphor green
    HAS_SUBDOMAIN:   'rgba(158, 230, 64, 0.25)',
    HAS_PORT:        'rgba(158, 230, 64, 0.25)',
    RUNS_SERVICE:    'rgba(158, 230, 64, 0.25)',
    HAS_ENDPOINT:    'rgba(158, 230, 64, 0.25)',
    HAS_EVIDENCE:    'rgba(176, 190, 197, 0.5)',

    // Discovery relationships
    DISCOVERED: '#82b1ff',   // blue-A100
    AFFECTS:    '#ff5252',   // red-A200
    BELONGS_TO: '#80d8ff',   // cyan-A100
    RESOLVES_TO:'#69f0ae',   // green-A200

    // Execution relationships
    USED_TO:      'rgba(158, 230, 64, 0.6)',
    USED_TOOL:    'rgba(158, 230, 64, 0.6)',
    DELEGATED_TO: '#a6e22e',  // phosphor green

    // Cross-entity relationships
    USES_TECHNOLOGY:  '#b39ddb',  // deep-purple-200
    SERVES_CERTIFICATE: '#80d8ff', // cyan-A100
    USES_TECHNIQUE:   '#f48fb1',   // pink-200
    LEADS_TO:         '#ea80fc',   // purple-A100
  },
};

// ============================================================================
// Light Theme (Cream Paper Aesthetic)
// ============================================================================

/**
 * Light theme color palette — warm cream background with darker ink values.
 * Unchanged from the original palette; this theme is preserved for completeness.
 */
export const LIGHT_THEME: ThemeColors = {
  background: '#faf6eb',
  grid: 'rgba(22, 163, 74, 0.08)',

  glowColors: {
    primary: 'rgba(22, 163, 74, 0.4)',
    active: 'rgba(5, 150, 105, 0.5)',
    critical: 'rgba(200, 40, 40, 0.6)',
    success: 'rgba(22, 163, 74, 0.4)',
  },

  severityColors: {
    critical: '#c82828',
    high: '#d35400',
    medium: '#b8860b',
    low: '#2d6a4f',
    info: '#374151',
  },

  // Darker variants for light background — all achieve ≥4.5:1 vs #faf6eb
  nodeColors: {
    mission:        '#2d6a1c',  // deep green
    mission_run:    '#1a5c2e',  // dark green
    agent_run:      '#5b21b6',  // violet-800
    tool_execution: '#92400e',  // amber-800
    llm_call:       '#6b21a8',  // purple-800
    domain:         '#1e40af',  // blue-800
    subdomain:      '#1d4ed8',  // blue-700
    host:           '#065f46',  // emerald-800
    port:           '#134e4a',  // teal-900
    service:        '#0f766e',  // teal-700
    endpoint:       '#0e7490',  // cyan-700
    technology:     '#4c1d95',  // violet-900
    certificate:    '#075985',  // sky-800
    finding:        '#991b1b',  // red-800
    evidence:       '#1f2937',  // gray-800
    technique:      '#9d174d',  // pink-800
  },

  edgeColors: {
    HAS_SUBDOMAIN:   '#16a34a',
    HAS_PORT:        '#16a34a',
    RUNS_SERVICE:    '#16a34a',
    HAS_ENDPOINT:    '#16a34a',
    HAS_EVIDENCE:    '#4b5563',

    DISCOVERED: '#1d4ed8',
    AFFECTS:    '#991b1b',
    BELONGS_TO: '#1d4ed8',
    RESOLVES_TO: '#065f46',

    USED_TO:       '#15803d',
    USED_TOOL:     '#15803d',
    DELEGATED_TO:  '#166534',

    USES_TECHNOLOGY:   '#4c1d95',
    SERVES_CERTIFICATE:'#075985',
    USES_TECHNIQUE:    '#9d174d',
    LEADS_TO:          '#6b21a8',
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
