/**
 * Graph 3D Store
 *
 * Manages 3D graph visualization state including camera, selection,
 * filters, layout mode, and performance settings.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================================
// Types
// ============================================================================

export type LayoutMode = 'force' | 'dag' | 'radial' | 'timeline';

export interface CameraState {
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  zoom: number;
}

export interface Graph3DFilters {
  /** Node types to display */
  nodeTypes: string[];
  /** Relationship types to display */
  relationshipTypes: string[];
  /** Search query for nodes */
  searchQuery: string;
  /** Maximum depth from selected node */
  maxDepth: number;
  /** Minimum severity for findings */
  minSeverity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  /** Time range filter */
  timeRange?: {
    start: Date;
    end: Date;
  };
}

export interface PerformanceSettings {
  /** Enable automatic LOD adjustments */
  autoLOD: boolean;
  /** Target FPS for LOD adjustments */
  targetFPS: number;
  /** Show edge labels */
  showEdgeLabels: boolean;
  /** Enable particle effects on edges */
  particleEffects: boolean;
  /** Node size multiplier */
  nodeSizeMultiplier: number;
  /** Enable shadows */
  enableShadows: boolean;
  /** Max visible nodes before LOD kicks in */
  maxVisibleNodes: number;
}

export interface SelectedNode {
  id: string;
  label?: string;
  type?: string;
  position?: { x: number; y: number; z: number };
}

export interface HiddenNodes {
  /** Set of node IDs that are hidden */
  ids: Set<string>;
  /** Reason for hiding (for undo) */
  reasons: Map<string, 'user' | 'filter' | 'lod'>;
}

export interface PinnedNodes {
  /** Set of node IDs that are pinned (fixed position) */
  ids: Set<string>;
  /** Original positions before pinning */
  positions: Map<string, { x: number; y: number; z: number }>;
}

export interface Graph3DState {
  // Camera
  camera: CameraState;
  cameraPresets: Record<string, CameraState>;

  // Selection
  selectedNode: SelectedNode | null;
  hoveredNode: SelectedNode | null;
  multiSelectedNodes: Set<string>;

  // Layout
  layoutMode: LayoutMode;
  layoutAnimating: boolean;
  centerNodeId: string | null;

  // Filters
  filters: Graph3DFilters;

  // Node state
  hiddenNodes: HiddenNodes;
  pinnedNodes: PinnedNodes;
  highlightedNodes: Set<string>;

  // Performance
  performance: PerformanceSettings;
  currentFPS: number;
  nodeCount: number;
  edgeCount: number;

  // UI state
  showMinimap: boolean;
  showStats: boolean;
  showContextMenu: boolean;
  contextMenuPosition: { x: number; y: number } | null;
  isExportDialogOpen: boolean;
  isFiltersOpen: boolean;

  // Connection state
  sseConnected: boolean;
  lastSSEMessage: Date | null;

  // Actions - Camera
  setCamera: (camera: Partial<CameraState>) => void;
  resetCamera: () => void;
  saveCameraPreset: (name: string) => void;
  loadCameraPreset: (name: string) => void;
  focusOnNode: (nodeId: string) => void;
  fitToView: () => void;

  // Actions - Selection
  selectNode: (node: SelectedNode | null) => void;
  setHoveredNode: (node: SelectedNode | null) => void;
  toggleMultiSelect: (nodeId: string) => void;
  clearMultiSelect: () => void;

  // Actions - Layout
  setLayoutMode: (mode: LayoutMode) => void;
  setLayoutAnimating: (animating: boolean) => void;
  setCenterNode: (nodeId: string | null) => void;

  // Actions - Filters
  setFilters: (filters: Partial<Graph3DFilters>) => void;
  resetFilters: () => void;
  addNodeTypeFilter: (type: string) => void;
  removeNodeTypeFilter: (type: string) => void;
  setSearchQuery: (query: string) => void;

  // Actions - Node State
  hideNode: (nodeId: string, reason?: 'user' | 'filter' | 'lod') => void;
  showNode: (nodeId: string) => void;
  showAllNodes: () => void;
  pinNode: (nodeId: string, position?: { x: number; y: number; z: number }) => void;
  unpinNode: (nodeId: string) => void;
  unpinAllNodes: () => void;
  highlightNode: (nodeId: string) => void;
  unhighlightNode: (nodeId: string) => void;
  clearHighlights: () => void;

  // Actions - Performance
  setPerformance: (settings: Partial<PerformanceSettings>) => void;
  setCurrentFPS: (fps: number) => void;
  setNodeCount: (count: number) => void;
  setEdgeCount: (count: number) => void;

  // Actions - UI
  toggleMinimap: () => void;
  toggleStats: () => void;
  setShowContextMenu: (show: boolean, position?: { x: number; y: number }) => void;
  setExportDialogOpen: (open: boolean) => void;
  setFiltersOpen: (open: boolean) => void;

  // Actions - SSE
  setSSEConnected: (connected: boolean) => void;
  setLastSSEMessage: (date: Date) => void;
}

// ============================================================================
// Default Values
// ============================================================================

const DEFAULT_CAMERA: CameraState = {
  x: 0,
  y: 0,
  z: 500,
  rotationX: -0.3,
  rotationY: 0,
  zoom: 1,
};

const DEFAULT_FILTERS: Graph3DFilters = {
  nodeTypes: [],
  relationshipTypes: [],
  searchQuery: '',
  maxDepth: 10,
};

const DEFAULT_PERFORMANCE: PerformanceSettings = {
  autoLOD: true,
  targetFPS: 30,
  showEdgeLabels: false,
  particleEffects: true,
  nodeSizeMultiplier: 1,
  enableShadows: false,
  maxVisibleNodes: 500,
};

// ============================================================================
// Store
// ============================================================================

export const useGraph3DStore = create<Graph3DState>()(
  persist(
    (set, get) => ({
      // Initial state
      camera: DEFAULT_CAMERA,
      cameraPresets: {},

      selectedNode: null,
      hoveredNode: null,
      multiSelectedNodes: new Set(),

      layoutMode: 'force',
      layoutAnimating: false,
      centerNodeId: null,

      filters: DEFAULT_FILTERS,

      hiddenNodes: { ids: new Set(), reasons: new Map() },
      pinnedNodes: { ids: new Set(), positions: new Map() },
      highlightedNodes: new Set(),

      performance: DEFAULT_PERFORMANCE,
      currentFPS: 60,
      nodeCount: 0,
      edgeCount: 0,

      showMinimap: false,
      showStats: false,
      showContextMenu: false,
      contextMenuPosition: null,
      isExportDialogOpen: false,
      isFiltersOpen: false,

      sseConnected: false,
      lastSSEMessage: null,

      // Camera actions
      setCamera: (camera) => {
        set((state) => ({
          camera: { ...state.camera, ...camera },
        }));
      },

      resetCamera: () => {
        set({ camera: DEFAULT_CAMERA });
      },

      saveCameraPreset: (name) => {
        const camera = get().camera;
        set((state) => ({
          cameraPresets: { ...state.cameraPresets, [name]: camera },
        }));
      },

      loadCameraPreset: (name) => {
        const preset = get().cameraPresets[name];
        if (preset) {
          set({ camera: preset });
        }
      },

      focusOnNode: (nodeId) => {
        // This would be implemented to animate camera to node
        // For now, just set the center node
        set({ centerNodeId: nodeId });
      },

      fitToView: () => {
        // Reset zoom and center
        set((state) => ({
          camera: { ...state.camera, zoom: 1, x: 0, y: 0 },
        }));
      },

      // Selection actions
      selectNode: (node) => {
        set({ selectedNode: node });
      },

      setHoveredNode: (node) => {
        set({ hoveredNode: node });
      },

      toggleMultiSelect: (nodeId) => {
        set((state) => {
          const newSet = new Set(state.multiSelectedNodes);
          if (newSet.has(nodeId)) {
            newSet.delete(nodeId);
          } else {
            newSet.add(nodeId);
          }
          return { multiSelectedNodes: newSet };
        });
      },

      clearMultiSelect: () => {
        set({ multiSelectedNodes: new Set() });
      },

      // Layout actions
      setLayoutMode: (mode) => {
        set({ layoutMode: mode, layoutAnimating: true });
        // Animation complete callback would set layoutAnimating to false
      },

      setLayoutAnimating: (animating) => {
        set({ layoutAnimating: animating });
      },

      setCenterNode: (nodeId) => {
        set({ centerNodeId: nodeId });
      },

      // Filter actions
      setFilters: (filters) => {
        set((state) => ({
          filters: { ...state.filters, ...filters },
        }));
      },

      resetFilters: () => {
        set({ filters: DEFAULT_FILTERS });
      },

      addNodeTypeFilter: (type) => {
        set((state) => ({
          filters: {
            ...state.filters,
            nodeTypes: [...state.filters.nodeTypes, type],
          },
        }));
      },

      removeNodeTypeFilter: (type) => {
        set((state) => ({
          filters: {
            ...state.filters,
            nodeTypes: state.filters.nodeTypes.filter((t) => t !== type),
          },
        }));
      },

      setSearchQuery: (query) => {
        set((state) => ({
          filters: { ...state.filters, searchQuery: query },
        }));
      },

      // Node state actions
      hideNode: (nodeId, reason = 'user') => {
        set((state) => {
          const newIds = new Set(state.hiddenNodes.ids);
          const newReasons = new Map(state.hiddenNodes.reasons);
          newIds.add(nodeId);
          newReasons.set(nodeId, reason);
          return { hiddenNodes: { ids: newIds, reasons: newReasons } };
        });
      },

      showNode: (nodeId) => {
        set((state) => {
          const newIds = new Set(state.hiddenNodes.ids);
          const newReasons = new Map(state.hiddenNodes.reasons);
          newIds.delete(nodeId);
          newReasons.delete(nodeId);
          return { hiddenNodes: { ids: newIds, reasons: newReasons } };
        });
      },

      showAllNodes: () => {
        set({
          hiddenNodes: { ids: new Set(), reasons: new Map() },
        });
      },

      pinNode: (nodeId, position) => {
        set((state) => {
          const newIds = new Set(state.pinnedNodes.ids);
          const newPositions = new Map(state.pinnedNodes.positions);
          newIds.add(nodeId);
          if (position) {
            newPositions.set(nodeId, position);
          }
          return { pinnedNodes: { ids: newIds, positions: newPositions } };
        });
      },

      unpinNode: (nodeId) => {
        set((state) => {
          const newIds = new Set(state.pinnedNodes.ids);
          const newPositions = new Map(state.pinnedNodes.positions);
          newIds.delete(nodeId);
          newPositions.delete(nodeId);
          return { pinnedNodes: { ids: newIds, positions: newPositions } };
        });
      },

      unpinAllNodes: () => {
        set({
          pinnedNodes: { ids: new Set(), positions: new Map() },
        });
      },

      highlightNode: (nodeId) => {
        set((state) => {
          const newSet = new Set(state.highlightedNodes);
          newSet.add(nodeId);
          return { highlightedNodes: newSet };
        });
      },

      unhighlightNode: (nodeId) => {
        set((state) => {
          const newSet = new Set(state.highlightedNodes);
          newSet.delete(nodeId);
          return { highlightedNodes: newSet };
        });
      },

      clearHighlights: () => {
        set({ highlightedNodes: new Set() });
      },

      // Performance actions
      setPerformance: (settings) => {
        set((state) => ({
          performance: { ...state.performance, ...settings },
        }));
      },

      setCurrentFPS: (fps) => {
        set({ currentFPS: fps });
      },

      setNodeCount: (count) => {
        set({ nodeCount: count });
      },

      setEdgeCount: (count) => {
        set({ edgeCount: count });
      },

      // UI actions
      toggleMinimap: () => {
        set((state) => ({ showMinimap: !state.showMinimap }));
      },

      toggleStats: () => {
        set((state) => ({ showStats: !state.showStats }));
      },

      setShowContextMenu: (show, position) => {
        set({
          showContextMenu: show,
          contextMenuPosition: show && position ? position : null,
        });
      },

      setExportDialogOpen: (open) => {
        set({ isExportDialogOpen: open });
      },

      setFiltersOpen: (open) => {
        set({ isFiltersOpen: open });
      },

      // SSE actions
      setSSEConnected: (connected) => {
        set({ sseConnected: connected });
      },

      setLastSSEMessage: (date) => {
        set({ lastSSEMessage: date });
      },
    }),
    {
      name: 'gibson-graph3d-store',
      partialize: (state) => ({
        // Only persist user preferences
        cameraPresets: state.cameraPresets,
        layoutMode: state.layoutMode,
        performance: state.performance,
        showMinimap: state.showMinimap,
        showStats: state.showStats,
      }),
    }
  )
);

// ============================================================================
// Selector Hooks
// ============================================================================

export const useGraph3DCamera = () => {
  const camera = useGraph3DStore((state) => state.camera);
  const setCamera = useGraph3DStore((state) => state.setCamera);
  const resetCamera = useGraph3DStore((state) => state.resetCamera);
  const focusOnNode = useGraph3DStore((state) => state.focusOnNode);
  const fitToView = useGraph3DStore((state) => state.fitToView);
  return { camera, setCamera, resetCamera, focusOnNode, fitToView };
};

export const useGraph3DSelection = () => {
  const selectedNode = useGraph3DStore((state) => state.selectedNode);
  const hoveredNode = useGraph3DStore((state) => state.hoveredNode);
  const multiSelectedNodes = useGraph3DStore((state) => state.multiSelectedNodes);
  const selectNode = useGraph3DStore((state) => state.selectNode);
  const setHoveredNode = useGraph3DStore((state) => state.setHoveredNode);
  const toggleMultiSelect = useGraph3DStore((state) => state.toggleMultiSelect);
  const clearMultiSelect = useGraph3DStore((state) => state.clearMultiSelect);
  return {
    selectedNode,
    hoveredNode,
    multiSelectedNodes,
    selectNode,
    setHoveredNode,
    toggleMultiSelect,
    clearMultiSelect,
  };
};

export const useGraph3DLayout = () => {
  const layoutMode = useGraph3DStore((state) => state.layoutMode);
  const layoutAnimating = useGraph3DStore((state) => state.layoutAnimating);
  const centerNodeId = useGraph3DStore((state) => state.centerNodeId);
  const setLayoutMode = useGraph3DStore((state) => state.setLayoutMode);
  const setLayoutAnimating = useGraph3DStore((state) => state.setLayoutAnimating);
  const setCenterNode = useGraph3DStore((state) => state.setCenterNode);
  return {
    layoutMode,
    layoutAnimating,
    centerNodeId,
    setLayoutMode,
    setLayoutAnimating,
    setCenterNode,
  };
};

export const useGraph3DFilters = () => {
  const filters = useGraph3DStore((state) => state.filters);
  const setFilters = useGraph3DStore((state) => state.setFilters);
  const resetFilters = useGraph3DStore((state) => state.resetFilters);
  const addNodeTypeFilter = useGraph3DStore((state) => state.addNodeTypeFilter);
  const removeNodeTypeFilter = useGraph3DStore((state) => state.removeNodeTypeFilter);
  const setSearchQuery = useGraph3DStore((state) => state.setSearchQuery);
  return {
    filters,
    setFilters,
    resetFilters,
    addNodeTypeFilter,
    removeNodeTypeFilter,
    setSearchQuery,
  };
};

export const useGraph3DPerformance = () => {
  const performance = useGraph3DStore((state) => state.performance);
  const currentFPS = useGraph3DStore((state) => state.currentFPS);
  const nodeCount = useGraph3DStore((state) => state.nodeCount);
  const edgeCount = useGraph3DStore((state) => state.edgeCount);
  const setPerformance = useGraph3DStore((state) => state.setPerformance);
  const setCurrentFPS = useGraph3DStore((state) => state.setCurrentFPS);
  return {
    performance,
    currentFPS,
    nodeCount,
    edgeCount,
    setPerformance,
    setCurrentFPS,
  };
};

export default useGraph3DStore;
