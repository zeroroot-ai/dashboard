/**
 * Theme Colors Configuration Module
 * Provides the canvas color palette for knowledge-graph and World-globe rendering.
 *
 * Design notes
 * ------------
 * All canvas-rendered literal colors live here. This file lives under
 * `src/lib/` (not `app/` or `components/`), so it is intentionally outside the
 * `check-no-hardcoded-colors` guard scope: canvas rendering cannot consume CSS
 * custom properties, so the brand tokens are mirrored here as literals.
 *
 * Palette: the "acid concrete" brand (ADR-0064). Terminal and canvas panels
 * stay DARK on the light app ground, drawn on the brand terminal background
 * with the Dracula ramp for entity/severity hues and acid green (`--primary`)
 * as the glow/emphasis accent. Acid is a FILL/GLOW, never label text (it fails
 * contrast at text sizes), which is why node LABELS use `CANVAS_TEXT`
 * (`canvas-style.ts`), not a node color.
 *
 * Aligned to the brand tokens in `@zeroroot-ai/brand`:
 *   --terminal-bg  oklch(0.130 0.010 100) -> #17150f  (warm near-black)
 *   --primary      oklch(0.860 0.215 128) -> rgb(163,230,53)  (acid lime, a FILL)
 *   --dracula-*    the Dracula ramp, mirrored verbatim from the brand tokens
 *
 * WCAG AA (>=4.5:1) is satisfied for every node/severity color versus the
 * terminal background. See the companion unit tests in
 * `__tests__/theme-colors.test.ts`.
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
  | 'technique'
  // Application lifecycle (Taxonomy v2, gibson#1656). Kept in lockstep with
  // entity-taxonomy.ts `ENTITY_TYPES`.
  | 'application'
  | 'repository'
  | 'image'
  | 'package'
  | 'deployment'
  | 'vulnerability'
  | 'merge_request'
  | 'pipeline'
  | 'control';

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
  | 'BELONGS_TO'
  // Application lifecycle (Taxonomy v2, gibson#1656).
  | 'HAS_REPOSITORY'
  | 'HAS_DEPLOYMENT'
  | 'BUILT_FROM'
  | 'CONTAINS'
  | 'RUNS'
  | 'EXPOSES'
  | 'INSTANCE_OF'
  | 'FIXED_BY'
  | 'VERIFIED_BY'
  | 'MERGED_INTO'
  | 'TOUCHES';

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
// Terminal Theme (acid concrete, ADR-0064) — one locked palette, dark canvas
// ============================================================================

/**
 * The one canvas palette. Terminal/canvas panels stay dark on the light app
 * ground (ADR-0064), drawn on the brand terminal background with the Dracula
 * ramp and acid-green accent. There is no second palette and no theme picker;
 * canvas rendering cannot read CSS custom properties, so the brand is mirrored
 * here as literals.
 *
 * Background: #17150f (~ oklch(0.130 0.010 100)), the brand `--terminal-bg`,
 * a warm near-black. Node, edge, label, and severity colors are contrast-tuned
 * against it; all achieve WCAG AA (>=4.5:1), verified by the companion test.
 *
 * Grid/vignette/scanline rendering is handled in the canvas renderer; the grid
 * color here is a faint acid overlay so the grid reads without competing with
 * nodes.
 */
export const DARK_THEME: ThemeColors = {
  // Warm near-black, ~ oklch(0.130 0.010 100), aligns to --terminal-bg.
  background: '#17150f',

  // Faint acid grid lines, aligned to --primary (acid lime).
  grid: 'rgba(163, 230, 53, 0.07)',

  glowColors: {
    // Acid lime, aligns to --primary. The brand glow/emphasis accent.
    primary: 'rgba(163, 230, 53, 0.45)',
    // Brighter acid for active/hover.
    active: 'rgba(190, 242, 100, 0.45)',
    // Dracula red, aligns to --destructive / --refused.
    critical: 'rgba(255, 85, 85, 0.8)',
    // Dracula green, aligns to --granted.
    success: 'rgba(80, 250, 123, 0.55)',
  },

  // Severity colors, the Dracula ramp. All achieve >=4.5:1 vs #17150f.
  severityColors: {
    critical: '#ff5555', // dracula red
    high: '#ffb86c', // dracula orange
    medium: '#f1fa8c', // dracula yellow
    low: '#50fa7b', // dracula green
    info: '#8be9fd', // dracula cyan
  },

  // Node type colors, biased to the Dracula ramp (+ acid for the discovery
  // frontier), each >=4.5:1 vs #17150f and mutually distinguishable.
  nodeColors: {
    mission: '#bd93f9', // dracula purple (root anchor)
    mission_run: '#50fa7b', // dracula green
    agent_run: '#ff79c6', // dracula pink
    tool_execution: '#ffb86c', // dracula orange
    llm_call: '#f1fa8c', // dracula yellow
    domain: '#8be9fd', // dracula cyan
    subdomain: '#a3e635', // acid lime (discovery frontier)
    host: '#69f0ae', // emerald-A200
    port: '#a7ffeb', // teal-A100
    service: '#64ffda', // teal-A200
    endpoint: '#84ffff', // cyan-A100
    technology: '#d0a3ff', // light purple
    certificate: '#80d8ff', // light cyan
    finding: '#ff5555', // dracula red
    evidence: '#b0bec5', // blue-grey-200
    technique: '#f48fb1', // pink-200

    // Application lifecycle (Taxonomy v2, gibson#1656). Mirrors
    // entity-taxonomy.ts ENTITY_COLORS_DARK; see the rationale there. Every
    // hue clears WCAG AA on this background, asserted in the companion test.
    application: '#4f7eee', // blue, the lifecycle anchor
    repository: '#9e75c7', // muted purple, source
    image: '#53adea', // light blue, built artifact
    package: '#aec775', // sage, dependency
    deployment: '#c79675', // warm tan, what runs
    vulnerability: '#d26a94', // deep rose, the weakness identity
    merge_request: '#be4fee', // violet, the proposed change
    pipeline: '#e7dac5', // bone, the verifier
    control: '#f1bbe1', // pale pink, compliance
  },

  // Edge relationship colors. Structural edges use a faint acid; discovery and
  // semantic edges take distinct Dracula hues; the AFFECTS edge is red.
  edgeColors: {
    // Structural relationships, faint acid.
    HAS_SUBDOMAIN: 'rgba(163, 230, 53, 0.22)',
    HAS_PORT: 'rgba(163, 230, 53, 0.22)',
    RUNS_SERVICE: 'rgba(163, 230, 53, 0.22)',
    HAS_ENDPOINT: 'rgba(163, 230, 53, 0.22)',
    HAS_EVIDENCE: 'rgba(176, 190, 197, 0.5)',

    // Discovery relationships.
    DISCOVERED: '#8be9fd', // dracula cyan
    AFFECTS: '#ff5555', // dracula red
    BELONGS_TO: '#80d8ff', // light cyan
    RESOLVES_TO: '#50fa7b', // dracula green

    // Execution relationships, green.
    USED_TO: 'rgba(80, 250, 123, 0.55)',
    USED_TOOL: 'rgba(80, 250, 123, 0.55)',
    DELEGATED_TO: '#bd93f9', // dracula purple

    // Cross-entity relationships.
    USES_TECHNOLOGY: '#d0a3ff', // light purple
    SERVES_CERTIFICATE: '#80d8ff', // light cyan
    USES_TECHNIQUE: '#f48fb1', // pink-200
    LEADS_TO: '#ff79c6', // dracula pink

    // Application lifecycle (Taxonomy v2, gibson#1656). Structural edges take
    // the same faint acid as the recon structure; remediation edges take their
    // target's hue so a fix path reads as one colour from Finding to Pipeline.
    HAS_REPOSITORY: 'rgba(163, 230, 53, 0.22)',
    HAS_DEPLOYMENT: 'rgba(163, 230, 53, 0.22)',
    BUILT_FROM: 'rgba(163, 230, 53, 0.22)',
    CONTAINS: 'rgba(163, 230, 53, 0.22)',
    RUNS: 'rgba(163, 230, 53, 0.22)',
    EXPOSES: 'rgba(163, 230, 53, 0.22)',
    INSTANCE_OF: '#d26a94', // the shared-Vulnerability fan-in
    FIXED_BY: '#be4fee',
    VERIFIED_BY: '#e7dac5',
    MERGED_INTO: 'rgba(190, 79, 238, 0.55)',
    TOUCHES: '#f1bbe1',
  },
};

// ============================================================================
// Theme Selection Function
// ============================================================================

// ============================================================================
// xterm palette (acid concrete, ADR-0064), dashboard#1144
// ============================================================================

/** The xterm.js theme shape the console uses. Every value is a hex color. */
interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/**
 * The one xterm palette for the Coding Agent Console and the mission
 * terminal. xterm paints on a canvas and cannot read CSS custom properties,
 * so the brand is mirrored here as hex literals, the same way DARK_THEME
 * mirrors it for the graph canvas. The Dracula ramp carries the ANSI colors.
 * Bright green is the acid accent, so `\x1b[92m` is the brand highlight.
 * The companion test checks that every value parses and contrasts.
 */
export const TERMINAL_THEME: TerminalTheme = {
  // Warm near-black, the brand --terminal-bg.
  background: '#17150f',
  // Dracula foreground.
  foreground: '#f8f8f2',
  // Acid lime cursor on the dark ground.
  cursor: '#a3e635',
  cursorAccent: '#17150f',
  // Acid at 25% alpha, so selected text stays readable.
  selectionBackground: '#a3e63540',
  black: '#21222c',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#bd93f9',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#f8f8f2',
  // Warm grey for secondary lines (system, thinking). Not the Dracula
  // comment blue, which fails contrast on the warm ground.
  brightBlack: '#8b877b',
  brightRed: '#ff6e6e',
  brightGreen: '#a3e635',
  brightYellow: '#ffffa5',
  brightBlue: '#d6acff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
};

/**
 * Return the graph color palette. There is one locked canvas palette (acid
 * concrete, ADR-0064), so this always returns DARK_THEME, kept as a function
 * for call-site clarity and so the canvas renderer has a single accessor.
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
