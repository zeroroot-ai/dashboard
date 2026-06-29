'use client';

import { useMemo } from 'react';
import { GraphCanvas } from '@/components/gibson/graph/GraphCanvas';
import { DEFAULT_DISPLAY } from '@/src/stores/graph-view-store';
import type { GraphNode, GraphEdge } from '@/src/types/graph';

interface WorldGraphMission {
  id: string;
  goal: string;
  status: string;
  reason: string;
}
export interface WorldGraphHost {
  scopeId: string;
  address: string;
  openPorts: number[];
  juicy: number;
  attention: number;
  surprise: string;
}
export interface WorldGraphFinding {
  id: string;
  title: string;
  scopeId: string;
  address: string;
  severity: string;
}

interface WorldGraphProps {
  missions: WorldGraphMission[];
  hosts: WorldGraphHost[];
  findings: WorldGraphFinding[];
  /** Node ids to highlight (the entities introduced/changed at the selected tick). */
  highlightNodeIds?: string[];
  /** Edge ids to highlight (the relationships introduced at the selected tick). */
  highlightEdgeIds?: string[];
}

const hostId = (scopeId: string, address: string) => `host:${scopeId}/${address}`;

/**
 * worldToGraph projects a World frame (missions/hosts/findings) into the
 * {nodes, edges} the GraphCanvas renderer consumes. Pure + deterministic so the
 * AFFECTS-edge matching is unit-testable. A finding links to a host only when
 * that host has been observed in the same frame (same scope + address).
 */
export function worldToGraph(
  missions: WorldGraphMission[],
  hosts: WorldGraphHost[],
  findings: WorldGraphFinding[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const m of missions) {
    nodes.push({
      id: `mission:${m.id}`,
      labels: ['Mission'],
      entityType: 'mission',
      properties: { goal: m.goal, status: m.status, reason: m.reason },
    });
  }

  const hostIds = new Set<string>();
  for (const h of hosts) {
    const id = hostId(h.scopeId, h.address);
    hostIds.add(id);
    nodes.push({
      id,
      labels: ['Host'],
      entityType: 'host',
      properties: {
        address: h.address,
        scopeId: h.scopeId,
        openPorts: h.openPorts,
        juicy: h.juicy,
        attention: h.attention,
        surprise: h.surprise,
      },
    });
  }

  for (const f of findings) {
    const fid = `finding:${f.id}`;
    nodes.push({
      id: fid,
      labels: ['Finding'],
      entityType: 'finding',
      properties: { title: f.title, severity: f.severity, address: f.address },
    });
    const target = hostId(f.scopeId, f.address);
    if (hostIds.has(target)) {
      edges.push({
        id: `affects:${f.id}`,
        type: 'AFFECTS',
        source: fid,
        target,
        properties: {},
      });
    }
  }

  return { nodes, edges };
}

/**
 * WorldGraph renders the ECS brain's World (epic ecs-brain, gibson#752) as a
 * force-directed graph: missions, discovered hosts, and findings as nodes, with
 * findings linked to the host they affect (matched by scope + address). It
 * reuses the app's `GraphCanvas` renderer (react-force-graph-2d) so node theming,
 * labels, and layout match the knowledge-graph view. The node/edge set is a pure
 * projection of whatever frame the Scroller is showing — live World or a folded
 * replay frame — so scrubbing re-renders the graph at that point in time.
 */
export function WorldGraph({
  missions,
  hosts,
  findings,
  highlightNodeIds,
  highlightEdgeIds,
}: WorldGraphProps) {
  const { nodes, edges } = useMemo(
    () => worldToGraph(missions, hosts, findings),
    [missions, hosts, findings],
  );

  // Highlight the delta introduced at the selected tick (gibson#1059). The
  // GraphCanvas dims everything outside the highlight set, so an empty set must
  // mean "no highlight" rather than "dim everything" — pass undefined then.
  const highlightedPaths = useMemo(() => {
    const node_ids = highlightNodeIds ?? [];
    const edge_ids = highlightEdgeIds ?? [];
    if (node_ids.length === 0 && edge_ids.length === 0) return undefined;
    return [{ node_ids, edge_ids }];
  }, [highlightNodeIds, highlightEdgeIds]);

  if (nodes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nothing in the World yet.</p>
    );
  }

  return (
    <div className="relative h-[480px] w-full overflow-hidden rounded-md border border-border">
      <GraphCanvas
        highlightedPaths={highlightedPaths}
        data={{
          nodes,
          edges,
          display: DEFAULT_DISPLAY,
          selectedNodeId: null,
          layoutMode: 'force',
          showMinimap: false,
          pinnedNodeIds: [],
        }}
      />
    </div>
  );
}
