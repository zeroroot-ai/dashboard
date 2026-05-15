'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { SlidersHorizontal, Settings2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { KnowledgeGraph3D } from '@/components/gibson/graph/KnowledgeGraph3D';
import { GraphFilters, type GraphFilters as GraphFiltersType } from '@/components/gibson/graph/GraphFilters';
import { Graph3DControls } from '@/components/gibson/graph/Graph3DControls';
import { MissionSelector } from '@/components/gibson/graph/MissionSelector';
import { NodeDetailPanel } from '@/components/gibson/graph/NodeDetailPanel';
import { PathQueryPanel } from '@/components/gibson/graph/PathQueryPanel';
import { useGraph } from '@/src/hooks/useGraph';
import { useGraphStream } from '@/components/gibson/graph/useGraphStream';
import type { GraphNode, GraphEdge } from '@/src/types/graph';
import { cn } from '@/lib/utils';

const ALL_NODE_TYPES = [
  'Mission', 'Agent', 'Host', 'Service', 'Vulnerability',
  'Finding', 'Endpoint', 'User', 'Credential',
] as const;

const DEFAULT_FILTERS: GraphFiltersType = {
  nodeTypes: [...ALL_NODE_TYPES],
  relationshipTypes: [],
  layout: 'force',
  depth: 3,
  search: '',
};

/** Serialize a plain path result for highlight props. */
interface PathResult {
  node_ids: string[];
  edge_ids: string[];
}

export default function GraphPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const missionId = searchParams.get('mission') ?? undefined;

  const [filters, setFilters] = useState<GraphFiltersType>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [pathSourceNode, setPathSourceNode] = useState<GraphNode | null>(null);
  const [highlightedPaths, setHighlightedPaths] = useState<PathResult[]>([]);

  // TanStack Query — mission graph or full tenant graph
  const {
    data: queryData,
    isLoading,
    isError,
    error,
    refetch,
    dataUpdatedAt,
  } = useGraph(missionId, {
    limit: 1000,
    nodeTypes: filters.nodeTypes?.length ? filters.nodeTypes : undefined,
  });

  // Local state for incremental stream merges
  const [extraNodes, setExtraNodes] = useState<GraphNode[]>([]);
  const [extraEdges, setExtraEdges] = useState<GraphEdge[]>([]);

  // Reset extra nodes/edges when base data changes (mission switch, full refetch)
  useEffect(() => {
    setExtraNodes([]);
    setExtraEdges([]);
  }, [missionId, dataUpdatedAt]);

  // Truncation detection — the daemon route returns total_node_count
  const truncated = (queryData as { truncated?: boolean } | undefined)?.truncated ?? false;
  const totalNodeCount = (queryData as { total_node_count?: number } | undefined)?.total_node_count;

  // Merge base graph with stream additions
  const mergedData = useMemo(() => {
    const baseNodes = queryData?.nodes ?? [];
    const baseEdges = queryData?.edges ?? [];
    const baseNodeIds = new Set(baseNodes.map(n => n.id));
    const baseEdgeIds = new Set(baseEdges.map(e => e.id));

    const newNodes = extraNodes.filter(n => !baseNodeIds.has(n.id));
    const newEdges = extraEdges.filter(e => !baseEdgeIds.has(e.id));

    return {
      nodes: [...baseNodes, ...newNodes],
      edges: [...baseEdges, ...newEdges],
    };
  }, [queryData, extraNodes, extraEdges]);

  // Live stream hook
  const [liveEnabled, setLiveEnabled] = useState(false);
  const handleStreamUpdate = useCallback((update: {
    kind: number;
    node?: GraphNode;
    edge?: GraphEdge;
  }) => {
    if (update.node) {
      setExtraNodes(prev => {
        const idx = prev.findIndex(n => n.id === update.node!.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = update.node!;
          return next;
        }
        return [...prev, update.node!];
      });
    }
    if (update.edge) {
      setExtraEdges(prev => {
        if (prev.some(e => e.id === update.edge!.id)) return prev;
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

  // Wire polling fallback via refetchInterval via useGraph — we re-fetch
  // by calling refetch directly when stale; TanStack Query v5 doesn't accept
  // dynamic refetchInterval post-call, so we imperatively refetch.
  useEffect(() => {
    if (!streamStale) return;
    const interval = setInterval(() => { void refetch(); }, 30_000);
    return () => clearInterval(interval);
  }, [streamStale, refetch]);

  const handleFiltersChange = useCallback((updated: GraphFiltersType) => {
    setFilters(updated);
  }, []);

  const handleToggleFilters = useCallback(() => {
    setFiltersOpen((prev) => !prev);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
  }, []);

  const handleFindPathsFromNode = useCallback((node: GraphNode) => {
    setPathSourceNode(node);
    setSelectedNode(null);
  }, []);

  const handleMissionChange = useCallback((id: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id) {
      params.set('mission', id);
    } else {
      params.delete('mission');
    }
    router.push(`/dashboard/graph?${params.toString()}`);
  }, [searchParams, router]);

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
      {/* Truncation banner */}
      {truncated && totalNodeCount && (
        <div className="absolute top-0 left-0 right-0 z-30 bg-alt/10 border-b border-alt/40/30 px-4 py-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-alt flex-shrink-0" />
          <p className="text-xs text-alt">
            Showing {mergedData.nodes.length.toLocaleString()} of {totalNodeCount.toLocaleString()} nodes.
            Use filters to narrow the scope.
          </p>
        </div>
      )}

      {/* Empty state — only shown when not loading and no data */}
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
                <a href="/dashboard/missions">Go to Missions</a>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 3D Graph Canvas — fills the container */}
      <KnowledgeGraph3D
        data={mergedData}
        loading={isLoading}
        onNodeClick={handleNodeClick}
        highlightedPaths={highlightedPaths}
      />

      {/* Mission selector + Live toggle — top-center overlay */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
        <MissionSelector
          selectedMissionId={missionId ?? null}
          onSelect={handleMissionChange}
        />
        <button
          onClick={() => setLiveEnabled(e => !e)}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-background/80 backdrop-blur-sm border border-border",
            liveEnabled ? "text-highlight border-highlight/40" : "text-muted-foreground"
          )}
          title={liveEnabled ? 'Live updates enabled' : 'Enable live updates'}
          aria-pressed={liveEnabled}
        >
          <span className={cn(
            "w-2 h-2 rounded-full",
            liveEnabled && streamHealthy ? "bg-highlight animate-pulse" : "bg-muted-foreground"
          )} />
          Live
        </button>
      </div>

      {/* Overlay controls — positioned inside the relative container */}
      <Graph3DControls
        position="top-right"
        compact
        filtersOpen={filtersOpen}
        onToggleFilters={handleToggleFilters}
        onOpenSettings={handleOpenSettings}
      />

      {/* Filters trigger — bottom-left floating button (mobile-friendly) */}
      <div className="absolute bottom-4 left-4 z-20 md:hidden">
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="bg-background/80 backdrop-blur-sm">
              <SlidersHorizontal className="w-4 h-4 mr-2" />
              Filters
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 p-0">
            <SheetHeader className="px-4 py-3 border-b border-border">
              <SheetTitle>Graph Filters</SheetTitle>
            </SheetHeader>
            <div className="overflow-y-auto h-full pb-8">
              <GraphFilters filters={filters} onFiltersChange={handleFiltersChange} />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Filters Sheet — desktop slide-in from left */}
      <div className="absolute top-4 left-4 z-20 hidden md:block">
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
              <GraphFilters filters={filters} onFiltersChange={handleFiltersChange} />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Settings Sheet — slides in from right */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-80">
          <SheetHeader className="border-b border-border pb-3">
            <SheetTitle className="flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              Graph Settings
            </SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 py-4">
            <p className="text-sm text-muted-foreground">
              Performance and display settings for the 3D knowledge graph.
            </p>
          </div>
        </SheetContent>
      </Sheet>

      {/* Path Query Panel */}
      <PathQueryPanel
        nodes={mergedData.nodes}
        initialSourceNode={pathSourceNode}
        onPathsFound={setHighlightedPaths}
      />

      {/* Node Detail Panel */}
      <NodeDetailPanel
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
        onFindPaths={handleFindPathsFromNode}
      />
    </div>
  );
}
