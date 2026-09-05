'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { SlidersHorizontal, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { GraphCanvas, type GraphCanvasHandle } from '@/components/gibson/graph/GraphCanvas';
import { GraphControls } from '@/components/gibson/graph/GraphControls';
import { GraphSettings } from '@/components/gibson/graph/GraphSettings';
import { GraphLegend } from '@/components/gibson/graph/GraphLegend';
import { GraphSearch } from '@/components/gibson/graph/GraphSearch';
import { GraphTimeline } from '@/components/gibson/graph/GraphTimeline';
import { GraphFilters } from '@/components/gibson/graph/GraphFilters';
import { MissionSelector } from '@/components/gibson/graph/MissionSelector';
import { NodeDetailPanel } from '@/components/gibson/graph/NodeDetailPanel';
import { PathQueryPanel } from '@/components/gibson/graph/PathQueryPanel';
import { useGraph } from '@/src/hooks/useGraph';
import { useGraphStream } from '@/components/gibson/graph/useGraphStream';
import { useGraphViewStore } from '@/src/stores/graph-view-store';
import {
  applyGraphFilters,
  availableNodeTypes as deriveNodeTypes,
  availableRelationshipTypes as deriveRelationshipTypes,
  DEFAULT_GRAPH_FILTERS,
  type GraphFilterState,
} from '@/src/lib/graph/filters';
import { applyNodeOps } from '@/src/lib/graph/node-ops';
import { attackPathSets } from '@/src/lib/graph/attack-path';
import { isScrubbing } from '@/src/lib/graph/fold-scrubber';
import { usePlayback } from '@/components/gibson/brain/playback';
import {
  worldToGraph,
  type WorldGraphMission,
  type WorldGraphHost,
  type WorldGraphFinding,
} from '@/components/gibson/brain/WorldGraph';
import { toGraphExportJSON } from '@/src/lib/graph/export';
import type { GraphNode, GraphEdge } from '@/src/types/graph';
import { cn } from '@/lib/utils';

/** Serialize a plain path result for highlight props. */
interface PathResult {
  node_ids: string[];
  edge_ids: string[];
}

export default function GraphPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const missionId = searchParams.get('mission') ?? undefined;

  const [filters, setFilters] = useState<GraphFilterState>(DEFAULT_GRAPH_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [pathSourceNode, setPathSourceNode] = useState<GraphNode | null>(null);
  const [highlightedPaths, setHighlightedPaths] = useState<PathResult[]>([]);

  const canvasRef = useRef<GraphCanvasHandle>(null);

  // Consolidated view-state, single source of truth for display + stats.
  const display = useGraphViewStore((s) => s.display);
  const setStats = useGraphViewStore((s) => s.setStats);
  const layoutMode = useGraphViewStore((s) => s.layoutMode);
  const showLegend = useGraphViewStore((s) => s.showLegend);
  const showMinimap = useGraphViewStore((s) => s.showMinimap);
  const pinnedNodeIds = useGraphViewStore((s) => s.pinnedNodeIds);
  const hiddenNodeIds = useGraphViewStore((s) => s.hiddenNodeIds);
  const focusNodeId = useGraphViewStore((s) => s.focusNodeId);
  const focusDepth = useGraphViewStore((s) => s.focusDepth);
  const togglePin = useGraphViewStore((s) => s.togglePin);
  const hideNode = useGraphViewStore((s) => s.hideNode);
  const isolateNode = useGraphViewStore((s) => s.isolateNode);
  const expandFocus = useGraphViewStore((s) => s.expandFocus);
  const clearFocus = useGraphViewStore((s) => s.clearFocus);
  const showAllNodes = useGraphViewStore((s) => s.showAllNodes);
  const timelineActive = useGraphViewStore((s) => s.timelineActive);
  const openTimeline = useGraphViewStore((s) => s.openTimeline);
  const closeTimeline = useGraphViewStore((s) => s.closeTimeline);

  // TanStack Query, mission graph or full tenant graph
  const {
    data: queryData,
    isLoading,
    isError,
    error,
    refetch,
    dataUpdatedAt,
  } = useGraph(missionId, { limit: 1000 });

  // Local state for incremental stream merges
  const [extraNodes, setExtraNodes] = useState<GraphNode[]>([]);
  const [extraEdges, setExtraEdges] = useState<GraphEdge[]>([]);

  // Reset extra nodes/edges when base data changes (mission switch, full refetch)
  useEffect(() => {
    setExtraNodes([]);
    setExtraEdges([]);
  }, [missionId, dataUpdatedAt]);

  // Truncation detection, the daemon route returns total_node_count
  const truncated = (queryData as { truncated?: boolean } | undefined)?.truncated ?? false;
  const totalNodeCount = (queryData as { total_node_count?: number } | undefined)?.total_node_count;

  // Merge base graph with stream additions
  const mergedData = useMemo(() => {
    const baseNodes = queryData?.nodes ?? [];
    const baseEdges = queryData?.edges ?? [];
    const baseNodeIds = new Set(baseNodes.map((n) => n.id));
    const baseEdgeIds = new Set(baseEdges.map((e) => e.id));

    const newNodes = extraNodes.filter((n) => !baseNodeIds.has(n.id));
    const newEdges = extraEdges.filter((e) => !baseEdgeIds.has(e.id));

    return {
      nodes: [...baseNodes, ...newNodes],
      edges: [...baseEdges, ...newEdges],
    };
  }, [queryData, extraNodes, extraEdges]);

  // Toggle targets derived from the data actually present.
  const availNodeTypes = useMemo(() => deriveNodeTypes(mergedData.nodes), [mergedData.nodes]);
  const availRelTypes = useMemo(() => deriveRelationshipTypes(mergedData.edges), [mergedData.edges]);

  // The visible subset after applying the filter contract (client-side; the
  // graph endpoint only supports a row limit).
  const filteredData = useMemo(
    () => applyGraphFilters(mergedData.nodes, mergedData.edges, filters),
    [mergedData.nodes, mergedData.edges, filters]
  );

  // Node manipulation (hide / isolate-expand) applied on top of filters.
  const opsData = useMemo(
    () => applyNodeOps(filteredData.nodes, filteredData.edges, { hiddenNodeIds, focusNodeId, focusDepth }),
    [filteredData, hiddenNodeIds, focusNodeId, focusDepth]
  );

  // ── Fold scrubber (gibson#1105) ─────────────────────────────────────────
  // A seq-indexed scrubber over the scope's World Timeline. At the live tail we
  // render the full enriched graph (opsData); scrubbed off the tail we render a
  // server-side fold of the log (GetFrameAt) mapped to the World subset, so the
  // graph rewinds in step with the World Scroller (ADR-0001: World ==
  // fold(Timeline)). This replaces the old client-side wall-clock reveal.
  const [timeline, setTimeline] = useState<{ seq: number }[]>([]);
  const total = timeline.length;
  const playback = usePlayback(total);
  const seq = playback.position;

  // Load the scope's Timeline (tenant-wide, or the selected mission) so the
  // scrubber knows the run length; refreshed slowly for live growth.
  useEffect(() => {
    let active = true;
    const url = missionId
      ? `/api/world?mission=${encodeURIComponent(missionId)}`
      : '/api/world';
    const load = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const json = (await res.json()) as { timeline?: { seq: number }[] };
        if (active) setTimeline(json.timeline ?? []);
      } catch {
        /* transient */
      }
    };
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [missionId]);

  // Off the live tail, fetch the folded frame and map it to graph shape (the
  // same projection WorldGraph uses). Debounced + abortable so dragging the
  // scrubber does not fire a request per tick.
  const [frameGraph, setFrameGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const scrubbing = isScrubbing(timelineActive, total, seq);
  useEffect(() => {
    if (!scrubbing) {
      setFrameGraph(null);
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({ seq: String(seq) });
          if (missionId) params.set('mission', missionId);
          const res = await fetch(`/api/world/frame?${params.toString()}`, {
            signal: controller.signal,
          });
          if (!res.ok) return;
          const frame = (await res.json()) as {
            missions?: WorldGraphMission[];
            hosts?: WorldGraphHost[];
            findings?: WorldGraphFinding[];
          };
          setFrameGraph(
            worldToGraph(frame.missions ?? [], frame.hosts ?? [], frame.findings ?? []),
          );
        } catch {
          /* aborted or transient — keep the last frame */
        }
      })();
    }, 120);
    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [scrubbing, seq, missionId]);

  // The graph the rest of the page renders: the folded frame while scrubbed off
  // the tail, the live enriched graph otherwise.
  const viewData = scrubbing && frameGraph ? frameGraph : opsData;

  // Highlight precedence: an explicit path query wins; otherwise attack-path
  // emphasis derives a highlight set from the visible attack-relationship edges.
  const effectiveHighlight = useMemo(() => {
    if (highlightedPaths.length > 0) return highlightedPaths;
    if (display.attackPathEmphasis) {
      const sets = attackPathSets(viewData.edges);
      return sets.edge_ids.length > 0 ? [sets] : [];
    }
    return [];
  }, [highlightedPaths, display.attackPathEmphasis, viewData.edges]);

  // Live stream hook
  const [liveEnabled, setLiveEnabled] = useState(false);
  const handleStreamUpdate = useCallback((update: {
    kind: number;
    node?: GraphNode;
    edge?: GraphEdge;
  }) => {
    if (update.node) {
      setExtraNodes((prev) => {
        const idx = prev.findIndex((n) => n.id === update.node!.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = update.node!;
          return next;
        }
        return [...prev, update.node!];
      });
    }
    if (update.edge) {
      setExtraEdges((prev) => {
        if (prev.some((e) => e.id === update.edge!.id)) return prev;
        return [...prev, update.edge!];
      });
    }
  }, []);

  const { healthy: streamHealthy, lastEventAt } = useGraphStream(liveEnabled, handleStreamUpdate);

  // Polling fallback: when stream has been unhealthy for >60s, use 30s refetch
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(interval);
  }, []);
  const streamStale = liveEnabled && !streamHealthy && now - lastEventAt > 60_000;

  useEffect(() => {
    if (!streamStale) return;
    const interval = setInterval(() => { void refetch(); }, 30_000);
    return () => clearInterval(interval);
  }, [streamStale, refetch]);

  const handleFiltersChange = useCallback((updated: GraphFilterState) => {
    setFilters(updated);
  }, []);

  const handleNodeClick = useCallback((node: GraphNode | null) => {
    setSelectedNode(node);
  }, []);

  const handleFindPathsFromNode = useCallback((node: GraphNode) => {
    setPathSourceNode(node);
    setSelectedNode(null);
  }, []);

  // Search-to-focus: select + center the chosen node.
  const handleFocusNode = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    canvasRef.current?.centerOn(node.id);
  }, []);

  // Fit-to-selection: frame the node plus its direct neighbors.
  const handleFrameNode = useCallback((node: GraphNode) => {
    const ids = new Set<string>([node.id]);
    for (const e of viewData.edges) {
      if (e.source === node.id) ids.add(e.target);
      if (e.target === node.id) ids.add(e.source);
    }
    canvasRef.current?.fitToNodes([...ids]);
  }, [viewData.edges]);

  // Node-manipulation handlers
  const handleTogglePin = useCallback((node: GraphNode) => togglePin(node.id), [togglePin]);
  const handleHide = useCallback((node: GraphNode) => hideNode(node.id), [hideNode]);
  const handleIsolate = useCallback((node: GraphNode) => {
    isolateNode(node.id);
    setSelectedNode(null);
  }, [isolateNode]);

  const handleMissionChange = useCallback((id: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) {
      params.set('mission', id);
    } else {
      params.delete('mission');
    }
    router.push(`/dashboard/graph?${params.toString()}`);
  }, [searchParams, router]);

  // Export the current (visible) view.
  const handleExportJson = useCallback(() => {
    const payload = toGraphExportJSON(viewData.nodes, viewData.edges);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gibson-graph-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [viewData]);

  const handleExportPng = useCallback(() => {
    const url = canvasRef.current?.exportPNG();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `gibson-graph-${Date.now()}.png`;
    a.click();
  }, []);

  // Camera actions delegated to the engine handle
  const handleZoomIn = useCallback(() => canvasRef.current?.zoomBy(1.2), []);
  const handleZoomOut = useCallback(() => canvasRef.current?.zoomBy(1 / 1.2), []);
  const handleFit = useCallback(() => canvasRef.current?.fit(), []);
  const handleReset = useCallback(() => canvasRef.current?.resetView(), []);

  const canvasData = useMemo(
    () => ({
      nodes: viewData.nodes,
      edges: viewData.edges,
      display,
      selectedNodeId: selectedNode?.id ?? null,
      layoutMode,
      showMinimap,
      pinnedNodeIds,
    }),
    [viewData, display, selectedNode, layoutMode, showMinimap, pinnedNodeIds]
  );

  // Open/close the scrubber. Opening re-pins to the live tail so it starts at
  // the current World; the usePlayback controller owns play/pause/step/jump.
  const handleToggleTimeline = useCallback(() => {
    if (timelineActive) {
      closeTimeline();
    } else {
      playback.controls.followTail();
      openTimeline();
    }
  }, [timelineActive, closeTimeline, openTimeline, playback.controls]);

  // ─── Render states ──────────────────────────────────────────────────────────

  if (isError) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to load graph';
    return (
      <div className="relative w-full rounded-lg overflow-hidden border border-border bg-background flex items-center justify-center"
        style={{ height: 'var(--content-full-height)' }}>
        <div className="flex flex-col items-center gap-4 max-w-md text-center p-8">
          <AlertTriangle className="w-12 h-12 text-destructive" />
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Failed to load graph</h3>
            <p className="text-sm text-muted-foreground mb-4">{errorMessage}</p>
          </div>
          <Button onClick={() => void refetch()} variant="outline">Retry</Button>
        </div>
      </div>
    );
  }

  const hasData = mergedData.nodes.length > 0;

  return (
    <div
      className="relative w-full rounded-lg overflow-hidden border border-border bg-background"
      style={{ height: 'var(--content-full-height)' }}
    >
      {/* Replay banner: while scrubbed off the tail the graph is a fold of the
          World (missions, hosts, findings); the enriched nodes/edges return at
          Live. Takes precedence over the truncation banner. */}
      {scrubbing ? (
        <div className="absolute top-0 left-0 right-0 z-30 bg-highlight/10 border-b border-highlight/40 px-4 py-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-highlight flex-shrink-0" />
          <p className="text-xs text-highlight">
            Replay · folded to event {seq} of {total}. This is the World at that tick;
            return to Live for the full enriched graph.
          </p>
        </div>
      ) : (
        truncated && totalNodeCount && (
          <div className="absolute top-0 left-0 right-0 z-30 bg-alt/10 border-b border-alt/40/30 px-4 py-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-alt flex-shrink-0" />
            <p className="text-xs text-alt">
              Showing {viewData.nodes.length.toLocaleString()} of {totalNodeCount.toLocaleString()} nodes.
              Use filters to narrow the scope.
            </p>
          </div>
        )
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">Loading graph...</p>
          </div>
        </div>
      )}

      {/* Empty state, only shown when not loading and no data */}
      {!isLoading && !hasData && (
        <div className="w-full h-full flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 max-w-md text-center p-8">
            <div className="w-12 h-12 text-muted-foreground">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {missionId ? 'No graph data for this mission' : 'This tenant has no graph data yet'}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {missionId
                  ? 'This mission has not generated any graph nodes yet.'
                  : 'Run a mission to populate the knowledge graph.'}
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/missions">Go to Missions</Link>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Graph canvas, fills the container */}
      {hasData && (
        <GraphCanvas
          ref={canvasRef}
          data={canvasData}
          highlightedPaths={effectiveHighlight}
          onNodeClick={handleNodeClick}
          onStats={setStats}
        />
      )}

      {/* Mission selector + Live toggle, top-center overlay */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
        <MissionSelector
          selectedMissionId={missionId ?? null}
          onSelect={handleMissionChange}
        />
        <button
          onClick={() => setLiveEnabled((e) => !e)}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-background/80 backdrop-blur-sm border border-border',
            liveEnabled ? 'text-highlight border-highlight/40' : 'text-muted-foreground'
          )}
          title={liveEnabled ? 'Live updates enabled' : 'Enable live updates'}
          aria-pressed={liveEnabled}
        >
          <span className={cn(
            'w-2 h-2 rounded-full',
            liveEnabled && streamHealthy ? 'bg-highlight animate-pulse' : 'bg-muted-foreground'
          )} />
          Live
        </button>
      </div>

      {/* Focus / hidden status bar */}
      {hasData && (focusNodeId || hiddenNodeIds.length > 0) && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background/90 backdrop-blur-sm border border-border text-xs">
          {focusNodeId && (
            <>
              <span className="text-foreground">
                Isolated <span className="text-muted-foreground">· depth {focusDepth}</span>
              </span>
              <Button variant="outline" size="sm" className="h-6 px-2" onClick={expandFocus}>
                Expand
              </Button>
              <Button variant="outline" size="sm" className="h-6 px-2" onClick={clearFocus}>
                Exit focus
              </Button>
            </>
          )}
          {hiddenNodeIds.length > 0 && (
            <>
              <span className="text-muted-foreground">{hiddenNodeIds.length} hidden</span>
              <Button variant="outline" size="sm" className="h-6 px-2" onClick={showAllNodes}>
                Show all
              </Button>
            </>
          )}
        </div>
      )}

      {/* Camera + view controls, top-right overlay */}
      {hasData && (
        <GraphControls
          position="top-right"
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onFit={handleFit}
          onReset={handleReset}
          onOpenSettings={() => setSettingsOpen(true)}
          onExportPng={handleExportPng}
          onExportJson={handleExportJson}
          onToggleTimeline={total > 0 ? handleToggleTimeline : undefined}
          timelineActive={timelineActive}
        />
      )}

      {/* Timeline scrubber (seq-indexed fold; gibson#1105) */}
      {hasData && timelineActive && total > 0 && (
        <GraphTimeline
          min={0}
          max={total}
          value={seq}
          playing={playback.playing}
          onChange={(v) => playback.controls.jump(v)}
          onTogglePlay={playback.controls.toggle}
          onClose={closeTimeline}
        />
      )}

      {/* Settings panel */}
      <GraphSettings open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* Legend overlay */}
      {hasData && showLegend && (
        <GraphLegend
          nodeTypes={availNodeTypes}
          relationshipTypes={availRelTypes}
          showSeverityScale={display.severityHeatmap}
        />
      )}

      {/* Top-left: filters + search */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="bg-background/80 backdrop-blur-sm"
              aria-label="Toggle filter panel"
            >
              <SlidersHorizontal className="w-4 h-4 mr-2" />
              Filters
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 p-0">
            <SheetHeader className="px-4 py-3 border-b border-border">
              <SheetTitle>Graph Filters</SheetTitle>
            </SheetHeader>
            <div className="overflow-y-auto h-full pb-8">
              <GraphFilters
                filters={filters}
                onFiltersChange={handleFiltersChange}
                availableNodeTypes={availNodeTypes}
                availableRelationshipTypes={availRelTypes}
              />
            </div>
          </SheetContent>
        </Sheet>
        {hasData && <GraphSearch nodes={viewData.nodes} onFocusNode={handleFocusNode} />}
      </div>

      {/* Path Query Panel */}
      <PathQueryPanel
        nodes={viewData.nodes}
        initialSourceNode={pathSourceNode}
        onPathsFound={setHighlightedPaths}
      />

      {/* Node Detail Panel */}
      <NodeDetailPanel
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
        onFindPaths={handleFindPathsFromNode}
        onFrame={handleFrameNode}
        onIsolate={handleIsolate}
        onTogglePin={handleTogglePin}
        isPinned={selectedNode ? pinnedNodeIds.includes(selectedNode.id) : false}
        onHide={handleHide}
      />
    </div>
  );
}
