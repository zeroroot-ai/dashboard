/**
 * Graph View Store
 *
 * The single consolidated source of truth for the knowledge-graph explorer
 * (`/dashboard/graph`). Replaces the old dual system where a self-contained
 * canvas renderer held its own camera/layout while a separate Zustand store
 * (`graph3d-store`) was mutated by the controls but ignored by the renderer.
 *
 * This store owns layout mode, selection/hover, display settings, and the live
 * node/edge counts. The camera itself is owned imperatively by the rendering
 * engine adapter (`GraphCanvas`) and driven through its handle — there is no
 * duplicate camera state here, and crucially no "layoutAnimating" flag that can
 * wedge the layout controls into a permanently-disabled state (dashboard#664).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================================
// Types
// ============================================================================

/**
 * Available graph layout modes. The pure layout engine that implements
 * `hierarchy`/`radial`/`timeline` lands in dashboard#665; the store carries the
 * full set so the contract is stable across slices.
 */
export type GraphLayoutMode = 'force' | 'hierarchy' | 'radial' | 'timeline';

/** Display/appearance settings. Extended with full controls in dashboard#666. */
export interface GraphDisplaySettings {
  /** Draw node labels (subject to a zoom legibility threshold in the canvas). */
  showLabels: boolean;
  /** Animate directional particles along links. */
  particles: boolean;
  /** Node size multiplier (1 = default). */
  nodeSize: number;
  /** Link width multiplier (1 = default). */
  linkWidth: number;
}

export interface GraphViewState {
  // Layout
  layoutMode: GraphLayoutMode;

  // Selection / hover (by node id; the page resolves to the full node object)
  selectedNodeId: string | null;
  hoveredNodeId: string | null;

  // Appearance
  display: GraphDisplaySettings;

  // Live counts, pushed from the rendering engine
  nodeCount: number;
  edgeCount: number;

  // Actions — Layout
  setLayoutMode: (mode: GraphLayoutMode) => void;

  // Actions — Selection
  selectNode: (id: string | null) => void;
  setHoveredNode: (id: string | null) => void;

  // Actions — Display
  setDisplay: (settings: Partial<GraphDisplaySettings>) => void;
  toggleLabels: () => void;
  toggleParticles: () => void;
  resetDisplay: () => void;

  // Actions — Stats
  setStats: (nodeCount: number, edgeCount: number) => void;
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_DISPLAY: GraphDisplaySettings = {
  showLabels: true,
  particles: true,
  nodeSize: 1,
  linkWidth: 1,
};

// ============================================================================
// Store
// ============================================================================

export const useGraphViewStore = create<GraphViewState>()(
  persist(
    (set) => ({
      layoutMode: 'force',
      selectedNodeId: null,
      hoveredNodeId: null,
      display: DEFAULT_DISPLAY,
      nodeCount: 0,
      edgeCount: 0,

      // Layout — a plain assignment. No animating/disabled side effect, so the
      // layout controls can be clicked any number of times without locking up.
      setLayoutMode: (mode) => set({ layoutMode: mode }),

      // Selection
      selectNode: (id) => set({ selectedNodeId: id }),
      setHoveredNode: (id) => set({ hoveredNodeId: id }),

      // Display
      setDisplay: (settings) =>
        set((state) => ({ display: { ...state.display, ...settings } })),
      toggleLabels: () =>
        set((state) => ({ display: { ...state.display, showLabels: !state.display.showLabels } })),
      toggleParticles: () =>
        set((state) => ({ display: { ...state.display, particles: !state.display.particles } })),
      resetDisplay: () => set({ display: DEFAULT_DISPLAY }),

      // Stats
      setStats: (nodeCount, edgeCount) => set({ nodeCount, edgeCount }),
    }),
    {
      name: 'gibson-graph-view-store',
      // Persist only durable user preferences — not selection or live counts.
      partialize: (state) => ({
        layoutMode: state.layoutMode,
        display: state.display,
      }),
    }
  )
);

export default useGraphViewStore;
