"use client";

/**
 * MissionFlow, renders a daemon-projected MissionGraph as a flow-chart of
 * boxes and data-flow lines (React Flow). The dashboard is a pure client: all
 * topology + auto-layout comes from GetMissionGraph; this component only draws,
 * overlays run state, and (when permitted) lets the author drag boxes and Save
 * the layout via SaveMissionLayout.
 *
 * Spec: MissionGraph epic, dashboard#655 (render), #657 (run overlay),
 * #658 (drag + save).
 */

import * as React from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Panel,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Button } from "@/components/ui/button";
import {
  saveMissionLayoutAction,
  type MissionGraphData,
  type MissionGraphNodeData,
  type MissionGraphEdgeData,
} from "@/app/actions/missions/mission-graph";
import {
  deriveOverlay,
  edgeKey,
  type RunSignals,
  type NodeRunState,
  type EdgeRunState,
} from "./overlay";
import { MissionNodeBox, type MissionNodeBoxData } from "./MissionNodeBox";

const nodeTypes = { mission: MissionNodeBox };

interface MissionFlowProps {
  graph: MissionGraphData;
  missionDefinitionId: string;
  /** Opaque version token from GetMissionLayout; echoed on save. */
  initialLayoutVersion?: string;
  /** Run signals to overlay; omit for the static authoring view. */
  runSignals?: RunSignals;
  /** When true, dragging + Save are enabled (authz-gated by the caller). */
  canSave?: boolean;
  onSelectNode?: (nodeId: string) => void;
  onSelectEdge?: (from: string, to: string) => void;
}

function toFlowNodes(
  graph: MissionGraphData,
  nodeStates: Record<string, NodeRunState>,
): Node<MissionNodeBoxData>[] {
  return graph.nodes.map((n: MissionGraphNodeData) => ({
    id: n.id,
    type: "mission",
    position: { x: n.x, y: n.y },
    data: {
      label: n.name || n.id,
      kind: n.kind,
      summary: n.summary,
      isEntry: n.isEntry,
      isExit: n.isExit,
      runState: nodeStates[n.id] ?? "pending",
    },
  }));
}

// Token-based edge stroke colors (CSS variable references, no raw color
// literals, so the no-hardcoded-colors guard passes).
const EDGE_COLOR: Record<EdgeRunState, string> = {
  traversed: "var(--primary)",
  "routed-around": "var(--muted-foreground)",
  "not-reached": "var(--border)",
};
const EDGE_COLOR_STATIC = "var(--border)";

function toFlowEdges(
  graph: MissionGraphData,
  edgeStates: Record<string, EdgeRunState>,
  hasRun: boolean,
): Edge[] {
  return graph.edges.map((e: MissionGraphEdgeData) => {
    const state = edgeStates[edgeKey(e.from, e.to)] ?? "not-reached";
    const traversed = state === "traversed";
    const routedAround = state === "routed-around";
    const label =
      e.role === "true" ? "true" : e.role === "false" ? "false" : undefined;
    return {
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      label,
      animated: hasRun && traversed,
      style: {
        stroke: hasRun ? EDGE_COLOR[state] : EDGE_COLOR_STATIC,
        strokeWidth: traversed ? 2.5 : 1.5,
        strokeDasharray: routedAround ? "4 4" : undefined,
        opacity: hasRun && state === "not-reached" ? 0.5 : 1,
      },
      markerEnd: { type: MarkerType.ArrowClosed },
    };
  });
}

export function MissionFlow({
  graph,
  missionDefinitionId,
  initialLayoutVersion = "",
  runSignals,
  canSave = false,
  onSelectNode,
  onSelectEdge,
}: MissionFlowProps) {
  const hasRun = runSignals !== undefined;
  const overlay = React.useMemo(
    () =>
      deriveOverlay(graph, runSignals ?? { completedNodeIds: [] }),
    [graph, runSignals],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(
    toFlowNodes(graph, overlay.nodeStates),
  );
  const [edges, setEdges] = useEdgesState(
    toFlowEdges(graph, overlay.edgeStates, hasRun),
  );

  // Re-sync when the graph or overlay changes (e.g. live run updates), while
  // preserving in-progress drag positions for unchanged nodes.
  React.useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      return toFlowNodes(graph, overlay.nodeStates).map((n) => {
        const existing = byId.get(n.id);
        return existing ? { ...n, position: existing.position } : n;
      });
    });
    setEdges(toFlowEdges(graph, overlay.edgeStates, hasRun));
  }, [graph, overlay, hasRun, setNodes, setEdges]);

  const [version, setVersion] = React.useState(initialLayoutVersion);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);

  const handleNodesChange = React.useCallback<typeof onNodesChange>(
    (changes) => {
      onNodesChange(changes);
      if (changes.some((c) => c.type === "position")) setDirty(true);
    },
    [onNodesChange],
  );

  const handleNodeClick = React.useCallback<NodeMouseHandler>(
    (_e, node) => onSelectNode?.(node.id),
    [onSelectNode],
  );
  const handleEdgeClick = React.useCallback<EdgeMouseHandler>(
    (_e, edge) => onSelectEdge?.(edge.source, edge.target),
    [onSelectEdge],
  );

  const handleSave = React.useCallback(async () => {
    setSaving(true);
    setConflict(false);
    try {
      const result = await saveMissionLayoutAction({
        missionDefinitionId,
        nodes: nodes.map((n) => ({
          nodeId: n.id,
          x: n.position.x,
          y: n.position.y,
        })),
        expectedVersion: version,
      });
      if (result.ok) {
        setVersion(result.version);
        setDirty(false);
      } else {
        setConflict(true);
      }
    } finally {
      setSaving(false);
    }
  }, [missionDefinitionId, nodes, version]);

  return (
    <div className="h-[600px] w-full rounded-md border border-border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={canSave ? handleNodesChange : undefined}
        nodesDraggable={canSave}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        {canSave && (
          <Panel position="top-right" className="flex items-center gap-2">
            {conflict && (
              <span className="text-xs text-destructive" role="alert">
                Layout changed elsewhere, reload to edit.
              </span>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!dirty || saving}
              aria-label="Save layout"
            >
              {saving ? "Saving…" : "Save layout"}
            </Button>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
