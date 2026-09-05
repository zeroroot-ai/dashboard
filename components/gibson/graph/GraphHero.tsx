'use client';

/**
 * GraphHero, Phase 6, Task 21
 *
 * Landing-route graph visualization. Renders the full tenant knowledge graph
 * in a fixed-height canvas with a header overlay showing key stats. Shares
 * the same /api/graph data path as the standalone /dashboard/graph route.
 *
 * Mounted in DashboardContent as the dominant visual area (replacing the
 * prior empty graph-nodes KPI slot). Per CLAUDE.md, unrelated dashboard chrome
 * (nav, KPI cards, component cards, etc.) is NOT touched.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { GraphCanvas } from '@/components/gibson/graph/GraphCanvas';
import { DEFAULT_DISPLAY } from '@/src/stores/graph-view-store';
import { useFullGraph } from '@/src/hooks/useGraph';
import { useTenantStore } from '@/src/stores/tenant-store';

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// A calm hero: labels + particles off so the landing view stays quiet.
const HERO_DISPLAY = { ...DEFAULT_DISPLAY, showLabels: false, particles: false };

export function GraphHero() {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantName = currentTenant?.name ?? currentTenant?.id ?? 'Tenant';

  const { data, isLoading, isError } = useFullGraph({ limit: 500 });

  const nodeCount = data?.nodes.length ?? 0;
  const edgeCount = data?.edges.length ?? 0;
  const totalNodeCount = (data as { total_node_count?: number } | undefined)?.total_node_count;
  const truncated = (data as { truncated?: boolean } | undefined)?.truncated;
  const hasData = nodeCount > 0;

  const canvasData = useMemo(
    () => ({
      nodes: data?.nodes ?? [],
      edges: data?.edges ?? [],
      display: HERO_DISPLAY,
      selectedNodeId: null,
      layoutMode: 'force' as const,
      showMinimap: false,
      pinnedNodeIds: [],
    }),
    [data?.nodes, data?.edges]
  );

  return (
    <div className="relative w-full rounded-lg overflow-hidden border border-border bg-background" style={{ height: '420px' }}>
      {/* Header overlay */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-background/90 to-transparent pointer-events-none">
        <div>
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
            Welcome &mdash; your attack surface
          </p>
          <h2 className="text-sm font-bold text-foreground mt-0.5">{tenantName}</h2>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="text-center">
            <p className="text-xl font-bold text-foreground">{formatCount(truncated && totalNodeCount ? totalNodeCount : nodeCount)}</p>
            <p className="text-muted-foreground">nodes</p>
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-foreground">{formatCount(edgeCount)}</p>
            <p className="text-muted-foreground">edges</p>
          </div>
        </div>
      </div>

      {/* Graph canvas, fills the container */}
      {hasData && <GraphCanvas data={canvasData} />}

      {/* Loading / empty / error states */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {!isLoading && !hasData && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">
            {isError ? 'Failed to load graph' : 'Run a mission to populate the knowledge graph.'}
          </p>
        </div>
      )}

      {/* Bottom overlay: deep-link to full graph page */}
      <div className="absolute bottom-3 right-3 z-10 pointer-events-auto">
        <Link
          href="/dashboard/graph"
          className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground bg-background/70 backdrop-blur-sm border border-border rounded px-2 py-1 transition-colors"
        >
          Full graph view
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
