'use client';

/**
 * GraphCanvas — knowledge-graph rendering engine adapter.
 *
 * A deep module that wraps `react-force-graph-2d` behind a small, stable
 * interface so the rest of the app never touches the library directly (and the
 * library could be swapped without changing callers). It takes graph data + the
 * current view-state and emits node/edge/zoom events; camera operations are
 * driven imperatively through the `GraphCanvasHandle` ref.
 *
 * The engine touches `window` at import time, so the actual integration lives in
 * `GraphCanvasInner` and is loaded only via `next/dynamic({ ssr: false })`.
 */

import { forwardRef } from 'react';
import dynamic from 'next/dynamic';
import type { GraphNode, GraphEdge } from '@/src/types/graph';
import type { GraphDisplaySettings, GraphLayoutMode } from '@/src/stores/graph-view-store';

/** A path returned by QueryPaths — highlighted on the graph when present. */
export interface HighlightedPath {
  node_ids: string[];
  edge_ids: string[];
}

/** Resolved highlight sets passed to the engine accessors. */
export interface HighlightState {
  active: boolean;
  nodes: Set<string>;
  edges: Set<string>;
}

/** Everything the engine needs to render a frame. */
export interface GraphCanvasData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  display: GraphDisplaySettings;
  selectedNodeId: string | null;
  /** Active layout mode. Non-force modes pin nodes to computed positions. */
  layoutMode: GraphLayoutMode;
}

/** Imperative camera controls exposed to the controls panel / page. */
export interface GraphCanvasHandle {
  /** Multiply the current zoom (e.g. 1.2 in, 0.8 out). */
  zoomBy: (factor: number) => void;
  /** Frame the whole graph. */
  fit: () => void;
  /** Reset the view (re-frame on next settle). */
  resetView: () => void;
  /** Center + zoom onto a specific node. */
  centerOn: (nodeId: string) => void;
  /** Current zoom factor. */
  getZoom: () => number;
}

export interface GraphCanvasProps {
  data: GraphCanvasData;
  highlightedPaths?: HighlightedPath[];
  /** Called with the clicked node, or null when the background is clicked. */
  onNodeClick?: (node: GraphNode | null) => void;
  onNodeHover?: (node: GraphNode | null) => void;
  /** Live node/edge counts pushed from the engine. */
  onStats?: (nodeCount: number, edgeCount: number) => void;
  onZoomChange?: (zoom: number) => void;
  className?: string;
}

const GraphCanvasInner = dynamic(() => import('./GraphCanvasInner'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  function GraphCanvas(props, ref) {
    return <GraphCanvasInner {...props} handleRef={ref} />;
  }
);

export default GraphCanvas;
