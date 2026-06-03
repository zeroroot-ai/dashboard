'use client';

/**
 * GraphCanvasInner
 *
 * The actual `react-force-graph-2d` integration. This module imports the engine
 * directly (which touches `window` at module-eval time), so it must ONLY be
 * loaded through `next/dynamic({ ssr: false })` from `GraphCanvas` — never on
 * the server.
 *
 * All brand colors come from `src/lib/graph` (canvas can't read CSS variables),
 * keeping `components/**` free of hardcoded color literals.
 */

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type NodeObject, type LinkObject } from 'react-force-graph-2d';
import type { GraphNode, GraphEdge } from '@/src/types/graph';
import { parseEntityType } from '@/src/lib/graph/entity-taxonomy';
import { getThemeColors } from '@/src/lib/graph/theme-colors';
import { NODE_SIZES } from '@/src/lib/graph/node-renderer';
import { computeLayout } from '@/src/lib/graph/layout-engine';
import {
  CANVAS_TEXT,
  CANVAS_TEXT_HALO,
  EDGE_FALLBACK,
  EDGE_DIM,
  NODE_RING,
  DIM_ALPHA,
  UNCONNECTED_ALPHA,
  LABEL_ZOOM_THRESHOLD,
  MINIMAP_BG,
  MINIMAP_VIEWPORT,
} from '@/src/lib/graph/canvas-style';
import type {
  GraphCanvasHandle,
  GraphCanvasProps,
  HighlightState,
} from './GraphCanvas';

// Extra props we attach on top of what react-force-graph manages. The library
// wraps these as NodeObject<…> / LinkObject<…> (adding id/x/y and resolving
// source/target to node refs), so the engine-facing types are the wrapped forms.
const MINIMAP_W = 150;
const MINIMAP_H = 104;

type GNodeExtra = { __g: GraphNode };
type GLinkExtra = { id: string; __g: GraphEdge };
type RFNode = NodeObject<GNodeExtra>;
type RFLink = LinkObject<GNodeExtra, GLinkExtra>;

interface GraphCanvasInnerProps extends GraphCanvasProps {
  handleRef: React.Ref<GraphCanvasHandle>;
}

/** Stable signature of the graph topology — only rebuild engine data on change. */
function topologySignature(nodes: GraphNode[], edges: GraphEdge[]): string {
  return `${nodes.length}:${edges.length}:${nodes.map((n) => n.id).join(',')}|${edges
    .map((e) => e.id)
    .join(',')}`;
}

export default function GraphCanvasInner({
  data,
  onNodeClick,
  onNodeHover,
  onStats,
  onZoomChange,
  highlightedPaths,
  handleRef,
}: GraphCanvasInnerProps) {
  const fgRef = useRef<ForceGraphMethods<GNodeExtra, GLinkExtra> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const theme = useMemo(() => getThemeColors(), []);

  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const fittedRef = useRef(false);

  // ── Engine data (rebuilt only when topology changes, to preserve layout) ──
  const signature = useMemo(
    () => topologySignature(data.nodes, data.edges),
    [data.nodes, data.edges]
  );

  const graphData = useMemo(() => {
    const nodes: RFNode[] = data.nodes.map((n) => ({ id: n.id, __g: n }));
    const links: RFLink[] = data.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      __g: e,
    }));
    return { nodes, links };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]) as { nodes: RFNode[]; links: RFLink[] };

  // Adjacency for selection-focus dimming (neighbor node ids per node).
  const neighborRef = useRef<Map<string, Set<string>>>(new Map());
  useEffect(() => {
    const m = new Map<string, Set<string>>();
    for (const e of data.edges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    neighborRef.current = m;
  }, [data.edges]);

  // Refresh stats + refit when topology changes.
  useEffect(() => {
    onStats?.(data.nodes.length, data.edges.length);
    fittedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Apply the active layout. Non-force modes pin nodes to deterministic
  // positions (fx/fy); force mode unpins them so the simulation runs. Recomputed
  // when the layout mode or the topology changes.
  useEffect(() => {
    const positions = computeLayout(data.nodes, data.edges, data.layoutMode);
    for (const n of graphData.nodes) {
      const p = positions?.get(n.__g.id);
      if (p) {
        n.fx = p.x;
        n.fy = p.y;
        n.x = p.x;
        n.y = p.y;
      } else {
        n.fx = undefined;
        n.fy = undefined;
      }
    }
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3ReheatSimulation();
    fittedRef.current = false;
    // Fully-pinned layouts settle instantly and may not emit onEngineStop,
    // so frame the result on a short delay.
    const t = setTimeout(() => {
      fg.zoomToFit(400, 60);
      fittedRef.current = true;
    }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.layoutMode, signature]);

  // Apply force-layout physics (repulsion + link distance) from settings.
  // Only meaningful in force mode, but safe to set on the d3 forces regardless.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force('charge') as { strength?: (s: number) => void } | undefined;
    charge?.strength?.(data.display.charge);
    const link = fg.d3Force('link') as { distance?: (d: number) => void } | undefined;
    link?.distance?.(data.display.linkDistance);
    if (data.layoutMode === 'force') fg.d3ReheatSimulation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.display.charge, data.display.linkDistance, data.layoutMode, signature]);

  // ── Live interaction state via refs (so accessors see latest w/o rebuild) ──
  const selectedRef = useRef<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const highlightRef = useRef<HighlightState>({ active: false, nodes: new Set(), edges: new Set() });
  const displayRef = useRef(data.display);
  displayRef.current = data.display;

  selectedRef.current = data.selectedNodeId ?? null;

  useEffect(() => {
    const nodes = new Set<string>();
    const edges = new Set<string>();
    for (const p of highlightedPaths ?? []) {
      for (const n of p.node_ids) nodes.add(n);
      for (const e of p.edge_ids) edges.add(e);
    }
    highlightRef.current = { active: nodes.size > 0 || edges.size > 0, nodes, edges };
  }, [highlightedPaths]);

  // ── Imperative handle ─────────────────────────────────────────────────────
  useImperativeHandle(
    handleRef,
    (): GraphCanvasHandle => ({
      zoomBy: (factor) => {
        const fg = fgRef.current;
        if (!fg) return;
        const next = Math.max(0.05, Math.min(20, fg.zoom() * factor));
        fg.zoom(next, 300);
      },
      fit: () => fgRef.current?.zoomToFit(400, 60),
      resetView: () => {
        fittedRef.current = false;
        fgRef.current?.zoomToFit(400, 60);
      },
      centerOn: (nodeId) => {
        const fg = fgRef.current;
        if (!fg) return;
        const node = graphData.nodes.find((n) => n.id === nodeId);
        if (node && typeof node.x === 'number' && typeof node.y === 'number') {
          fg.centerAt(node.x, node.y, 600);
          fg.zoom(Math.max(fg.zoom(), 3), 600);
        }
      },
      fitToNodes: (nodeIds) => {
        const fg = fgRef.current;
        if (!fg || nodeIds.length === 0) return;
        const set = new Set(nodeIds);
        fg.zoomToFit(500, 90, (n) => set.has(String(n.id)));
      },
      getZoom: () => fgRef.current?.zoom() ?? 1,
    }),
    [graphData]
  );

  // ── Container sizing ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Minimap ───────────────────────────────────────────────────────────────
  // Overview of node positions + the current viewport, redrawn on a light
  // interval (the engine runs its own loop; per-frame redraw is unnecessary).
  const minimapTransformRef = useRef<{ ox: number; oy: number; scale: number } | null>(null);
  useEffect(() => {
    if (!data.showMinimap) {
      minimapTransformRef.current = null;
      return;
    }
    const draw = () => {
      const cvs = minimapRef.current;
      const fg = fgRef.current;
      if (!cvs || !fg) return;
      const ctx = cvs.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      if (cvs.width !== MINIMAP_W * dpr) {
        cvs.width = MINIMAP_W * dpr;
        cvs.height = MINIMAP_H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
      ctx.fillStyle = MINIMAP_BG;
      ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

      const nodes = graphData.nodes.filter(
        (n) => typeof n.x === 'number' && typeof n.y === 'number'
      );
      if (nodes.length === 0) {
        minimapTransformRef.current = null;
        return;
      }
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, n.x!); maxX = Math.max(maxX, n.x!);
        minY = Math.min(minY, n.y!); maxY = Math.max(maxY, n.y!);
      }
      const pad = 8;
      const bw = Math.max(1, maxX - minX);
      const bh = Math.max(1, maxY - minY);
      const scale = Math.min((MINIMAP_W - 2 * pad) / bw, (MINIMAP_H - 2 * pad) / bh);
      const ox = pad + ((MINIMAP_W - 2 * pad) - bw * scale) / 2 - minX * scale;
      const oy = pad + ((MINIMAP_H - 2 * pad) - bh * scale) / 2 - minY * scale;
      minimapTransformRef.current = { ox, oy, scale };

      for (const n of nodes) {
        const g = n.__g;
        ctx.fillStyle = g.color || theme.nodeColors[parseEntityType(g.labels)] || theme.nodeColors.host;
        ctx.fillRect(ox + n.x! * scale - 0.75, oy + n.y! * scale - 0.75, 1.5, 1.5);
      }

      // Current viewport rectangle.
      try {
        const tl = fg.screen2GraphCoords(0, 0);
        const br = fg.screen2GraphCoords(size.w, size.h);
        const rx = ox + Math.min(tl.x, br.x) * scale;
        const ry = oy + Math.min(tl.y, br.y) * scale;
        const rw = Math.abs(br.x - tl.x) * scale;
        const rh = Math.abs(br.y - tl.y) * scale;
        ctx.strokeStyle = MINIMAP_VIEWPORT;
        ctx.lineWidth = 1;
        ctx.strokeRect(rx, ry, rw, rh);
      } catch {
        /* coords unavailable before first paint */
      }
    };
    draw();
    const id = setInterval(draw, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.showMinimap, signature, size.w, size.h]);

  const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const fg = fgRef.current;
    const t = minimapTransformRef.current;
    const cvs = minimapRef.current;
    if (!fg || !t || !cvs) return;
    const rect = cvs.getBoundingClientRect();
    const gx = (e.clientX - rect.left - t.ox) / t.scale;
    const gy = (e.clientY - rect.top - t.oy) / t.scale;
    fg.centerAt(gx, gy, 400);
  }, []);

  // ── Accessors ─────────────────────────────────────────────────────────────
  const nodeAlpha = useCallback((id: string): number => {
    const hp = highlightRef.current;
    if (hp.active) return hp.nodes.has(id) ? 1 : DIM_ALPHA;
    const sel = selectedRef.current;
    if (sel) {
      if (id === sel) return 1;
      return neighborRef.current.get(sel)?.has(id) ? 1 : UNCONNECTED_ALPHA;
    }
    return 1;
  }, []);

  const drawNode = useCallback(
    (node: RFNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const g = node.__g;
      const et = parseEntityType(g.labels);
      const radius = Math.max(2, ((NODE_SIZES[et] ?? 32) / 10) * displayRef.current.nodeSize);
      const color = g.color || theme.nodeColors[et] || theme.nodeColors.host;
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      const isSelected = selectedRef.current === g.id;
      const isHovered = hoveredRef.current === g.id;
      const alpha = nodeAlpha(g.id);
      const d = displayRef.current;

      ctx.save();
      ctx.globalAlpha = alpha;

      // Glow on focused nodes, scaled by the Glow setting; off in performance mode.
      const glowOn = !d.performanceMode && d.glow > 0 && (isSelected || isHovered);
      if (glowOn) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 18 * d.glow;
      }

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      if (isSelected || isHovered) {
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2 / globalScale;
        ctx.strokeStyle = NODE_RING;
        ctx.stroke();
      }

      // Labels — only when zoomed in enough to stay legible, or when focused.
      // Label density shifts the zoom threshold at which labels appear.
      const showLabels = d.showLabels;
      const labelThreshold =
        d.labelDensity === 'dense'
          ? LABEL_ZOOM_THRESHOLD * 0.45
          : d.labelDensity === 'sparse'
          ? LABEL_ZOOM_THRESHOLD * 1.8
          : LABEL_ZOOM_THRESHOLD;
      if ((showLabels && globalScale >= labelThreshold) || isSelected || isHovered) {
        const label = (g.properties?.name as string) || g.id;
        const fontSize = Math.max(2.5, 11 / globalScale);
        ctx.font = `${fontSize}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const ly = y + radius + 2 / globalScale;
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3 / globalScale;
        ctx.strokeStyle = CANVAS_TEXT_HALO;
        ctx.strokeText(label, x, ly);
        ctx.fillStyle = CANVAS_TEXT;
        ctx.fillText(label, x, ly);
      }

      ctx.restore();
    },
    [theme, nodeAlpha]
  );

  const drawNodePointerArea = useCallback(
    (node: RFNode, color: string, ctx: CanvasRenderingContext2D) => {
      const g = node.__g;
      const et = parseEntityType(g.labels);
      const radius = Math.max(3, ((NODE_SIZES[et] ?? 32) / 10) * displayRef.current.nodeSize) + 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, Math.PI * 2);
      ctx.fill();
    },
    []
  );

  const linkColor = useCallback(
    (link: RFLink): string => {
      const e = link.__g;
      const base = theme.edgeColors[e.type as keyof typeof theme.edgeColors] || EDGE_FALLBACK;
      const hp = highlightRef.current;
      if (hp.active) return hp.edges.has(e.id) ? base : EDGE_DIM;
      const sel = selectedRef.current;
      if (sel) {
        return e.source === sel || e.target === sel ? base : EDGE_DIM;
      }
      return base;
    },
    [theme]
  );

  const linkWidth = useCallback((link: RFLink): number => {
    const e = link.__g;
    const w = displayRef.current.linkWidth;
    const hp = highlightRef.current;
    if (hp.active && hp.edges.has(e.id)) return 2.5 * w;
    const sel = selectedRef.current;
    if (sel && (e.source === sel || e.target === sel)) return 2 * w;
    return 1 * w;
  }, []);

  const linkParticles = useCallback((link: RFLink): number => {
    if (!displayRef.current.particles || displayRef.current.performanceMode) return 0;
    const e = link.__g;
    const hp = highlightRef.current;
    if (hp.active) return hp.edges.has(e.id) ? 3 : 0;
    const sel = selectedRef.current;
    if (sel && (e.source === sel || e.target === sel)) return 2;
    return 0;
  }, []);

  const nodeTooltip = useCallback((node: RFNode): string => {
    const g = node.__g;
    const name = (g.properties?.name as string) || g.id;
    const type = g.labels?.[0] ?? '';
    const esc = (s: string) => s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));
    return `<div style="font:12px ui-monospace,monospace;padding:2px 4px"><strong>${esc(
      name
    )}</strong>${type ? `<br/><span style="opacity:.7">${esc(type)}</span>` : ''}</div>`;
  }, []);

  // ── Events ────────────────────────────────────────────────────────────────
  const handleNodeClick = useCallback(
    (node: RFNode) => {
      onNodeClick?.(node.__g);
    },
    [onNodeClick]
  );

  const handleNodeHover = useCallback(
    (node: RFNode | null) => {
      hoveredRef.current = node?.id != null ? String(node.id) : null;
      onNodeHover?.(node?.__g ?? null);
    },
    [onNodeHover]
  );

  const handleBackgroundClick = useCallback(() => {
    onNodeClick?.(null); // page clears selection on background click
  }, [onNodeClick]);

  const handleEngineStop = useCallback(() => {
    if (!fittedRef.current) {
      fgRef.current?.zoomToFit(400, 60);
      fittedRef.current = true;
    }
  }, []);

  const handleZoomEnd = useCallback(
    (t: { k: number }) => {
      onZoomChange?.(t.k);
    },
    [onZoomChange]
  );

  return (
    <div ref={containerRef} className="absolute inset-0">
      {size.w > 0 && size.h > 0 && (
        <ForceGraph2D<GNodeExtra, GLinkExtra>
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={graphData}
          backgroundColor={theme.background}
          nodeRelSize={4}
          nodeId="id"
          nodeLabel={nodeTooltip}
          nodeCanvasObject={drawNode}
          nodeCanvasObjectMode={() => 'replace'}
          nodePointerAreaPaint={drawNodePointerArea}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkDirectionalParticles={linkParticles}
          linkDirectionalParticleWidth={2}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onBackgroundClick={handleBackgroundClick}
          onEngineStop={handleEngineStop}
          onZoomEnd={handleZoomEnd}
          cooldownTicks={120}
          warmupTicks={20}
        />
      )}
      {data.showMinimap && (
        <canvas
          ref={minimapRef}
          onClick={handleMinimapClick}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 rounded-md border border-border cursor-pointer"
          style={{ width: MINIMAP_W, height: MINIMAP_H }}
          aria-label="Graph minimap — click to recenter"
        />
      )}
    </div>
  );
}
