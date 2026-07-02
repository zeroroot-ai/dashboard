/**
 * Canvas style constants for the knowledge-graph explorer.
 *
 * Lives under `src/lib/` (outside the `check-no-hardcoded-colors` guard scope)
 * because canvas rendering cannot consume CSS custom properties. Values mirror
 * the locked dark brand tokens in `app/globals.css`; see `theme-colors.ts` for
 * the node/edge/severity palettes.
 */

/** Near-white label text (≈ --foreground #f0f5ef). */
export const CANVAS_TEXT = '#f0f5ef';

/** Dark halo stroked under label text so it reads on any node/background. */
export const CANVAS_TEXT_HALO = 'rgba(0, 0, 0, 0.85)';

/** Fallback link color for relationship types not in the theme edge palette. */
export const EDGE_FALLBACK = 'rgba(139, 92, 246, 0.30)';

/** Color for links dimmed by selection focus or path highlight. */
export const EDGE_DIM = 'rgba(176, 190, 197, 0.10)';

/** Stroke color for the selected/hovered node ring (phosphor white). */
export const NODE_RING = '#f0f5ef';

/** Alpha applied to nodes outside the active highlight set. */
export const DIM_ALPHA = 0.12;

/** Alpha applied to nodes not connected to the current selection. */
export const UNCONNECTED_ALPHA = 0.3;

/** Min on-screen scale before node labels are drawn. */
export const LABEL_ZOOM_THRESHOLD = 1.2;

/** Minimap panel background (translucent near-black blue-violet). */
export const MINIMAP_BG = 'rgba(20, 18, 28, 0.65)';

/** Minimap current-viewport rectangle stroke. */
export const MINIMAP_VIEWPORT = 'rgba(240, 245, 239, 0.7)';
