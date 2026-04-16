'use client';

import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  type FitViewOptions,
  Panel,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import * as Icons from 'lucide-react';
import type { GraphNode, GraphEdge } from '@/src/types/graph';

/**
 * Color mapping for node types based on design spec
 */
const NODE_COLORS: Record<string, string> = {
  Mission: '#ffb000',        // amber
  Agent: '#ff8c00',          // orange
  AgentExecution: '#ff8c00', // orange
  Host: '#3b82f6',           // blue
  Service: '#8b5cf6',        // purple
  Vulnerability: '#ff4433',  // red
  Finding: '#ff6633',        // orange-red
  Endpoint: '#33ff33',       // green
  default: '#6b7280',        // gray
};

/**
 * Icon mapping for node types (Lucide icon names)
 */
const NODE_ICONS: Record<string, keyof typeof Icons> = {
  Mission: 'Rocket',
  Agent: 'Bot',
  AgentExecution: 'Cpu',
  Host: 'Server',
  Service: 'Box',
  Vulnerability: 'ShieldAlert',
  Finding: 'Flag',
  Endpoint: 'Globe',
  default: 'Circle',
};

/**
 * Get node color based on primary label
 */
function getNodeColor(labels: string[]): string {
  for (const label of labels) {
    if (NODE_COLORS[label]) {
      return NODE_COLORS[label];
    }
  }
  return NODE_COLORS.default;
}

/**
 * Get node icon based on primary label
 */
function getNodeIcon(labels: string[]): keyof typeof Icons {
  for (const label of labels) {
    if (NODE_ICONS[label]) {
      return NODE_ICONS[label];
    }
  }
  return NODE_ICONS.default;
}

/**
 * Custom node component with type-based styling
 */
function CustomNode({ data }: { data: Record<string, unknown> }) {
  const iconKey = data.icon as keyof typeof Icons;
  const IconComponent = (Icons[iconKey] || Icons.Circle) as React.ComponentType<{
    className?: string;
    style?: React.CSSProperties;
  }>;

  return (
    <div
      className="px-4 py-2 rounded-lg border-2 shadow-lg backdrop-blur-sm bg-background/80 hover:bg-background/90 transition-all cursor-pointer"
      style={{
        borderColor: data.color as string,
        boxShadow: `0 0 20px ${data.color as string}40`,
      }}
    >
      <div className="flex items-center gap-2">
        <IconComponent
          className="w-4 h-4 flex-shrink-0"
          style={{ color: data.color as string }}
        />
        <div className="text-sm font-medium text-foreground truncate max-w-[200px]">
          {data.label as string}
        </div>
      </div>
      {Boolean(data.subtitle) && (
        <div className="text-xs text-muted-foreground mt-1 truncate">
          {data.subtitle as string}
        </div>
      )}
    </div>
  );
}

// Register custom node types
const nodeTypes: NodeTypes = {
  custom: CustomNode,
};

/**
 * Get edge color based on relationship type
 */
function getEdgeColor(type: string): string {
  const edgeColors: Record<string, string> = {
    DISCOVERED: '#22c55e',    // green
    CONTAINS: '#3b82f6',      // blue
    EXPLOITS: '#ef4444',      // red
    AFFECTS: '#f59e0b',       // amber
    USES: '#8b5cf6',          // purple
    default: '#6b7280',       // gray
  };

  return edgeColors[type] || edgeColors.default;
}

/**
 * Transform Neo4j graph data to React Flow format
 */
function transformGraphData(
  nodes: GraphNode[],
  edges: GraphEdge[],
  layout: 'force' | 'hierarchical'
): { nodes: Node[]; edges: Edge[] } {
  const transformedNodes: Node[] = nodes.map((node, index) => {
    const nodeLabels = node.labels ?? [];
    const color = node.color || getNodeColor(nodeLabels);
    const icon = node.icon || getNodeIcon(nodeLabels);

    const position =
      layout === 'hierarchical'
        ? { x: (index % 5) * 250, y: Math.floor(index / 5) * 150 }
        : {
            x: Math.cos((index / nodes.length) * Math.PI * 2) * 300 + 400,
            y: Math.sin((index / nodes.length) * Math.PI * 2) * 300 + 300,
          };

    return {
      id: node.id,
      type: 'custom',
      position,
      data: {
        label: (node.properties.name as string) || (node.properties.id as string) || node.id,
        subtitle: nodeLabels[0],
        color,
        icon,
        nodeData: node,
      },
    };
  });

  const transformedEdges: Edge[] = edges.map((edge) => {
    const color = getEdgeColor(edge.type);

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.type,
      animated: edge.type === 'DISCOVERED' || edge.type === 'EXPLOITS',
      style: {
        stroke: color,
        strokeWidth: 2,
      },
      labelStyle: {
        fill: color,
        fontSize: 10,
        fontWeight: 500,
      },
      labelBgStyle: {
        fill: '#18181b',
        fillOpacity: 0.8,
      },
    };
  });

  return { nodes: transformedNodes, edges: transformedEdges };
}

export interface KnowledgeGraphViewProps {
  /** Graph data from Neo4j */
  data: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  /** Layout algorithm */
  layout?: 'force' | 'hierarchical';
  /** Callback when a node is clicked */
  onNodeClick?: (node: GraphNode) => void;
  /** Callback when an edge is clicked */
  onEdgeClick?: (edge: GraphEdge) => void;
  /** Loading state */
  loading?: boolean;
  /** Error state */
  error?: string;
}

/**
 * KnowledgeGraphView Component
 *
 * Interactive knowledge graph visualization using React Flow (2D fallback).
 * Displays nodes with type-based colors and icons, and edges with relationship types.
 *
 * Features:
 * - Custom node styling with colors and icons
 * - Edge styling based on relationship type
 * - Zoom controls, fit-to-view, minimap
 * - Force layout (default) and hierarchical layout
 * - Node click triggers selection callback
 */
export function KnowledgeGraphView({
  data,
  layout = 'force',
  onNodeClick,
  onEdgeClick,
  loading = false,
  error,
}: KnowledgeGraphViewProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => transformGraphData(data.nodes, data.edges, layout),
    [data.nodes, data.edges, layout]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes and edges when data changes
  useMemo(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (onNodeClick && node.data.nodeData) {
        onNodeClick(node.data.nodeData as GraphNode);
      }
    },
    [onNodeClick]
  );

  const handleEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      if (onEdgeClick) {
        const originalEdge = data.edges.find((e) => e.id === edge.id);
        if (originalEdge) {
          onEdgeClick(originalEdge);
        }
      }
    },
    [onEdgeClick, data.edges]
  );

  const fitViewOptions: FitViewOptions = {
    padding: 0.2,
    duration: 400,
  };

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading graph...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <Icons.AlertCircle className="w-12 h-12 text-destructive" />
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Failed to load graph
            </h3>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (data.nodes.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <Icons.Network className="w-12 h-12 text-muted-foreground" />
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              No graph data available
            </h3>
            <p className="text-sm text-muted-foreground">
              Select a mission or run a scan to populate the knowledge graph.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.1}
        maxZoom={4}
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="hsl(var(--muted-foreground) / 0.2)"
        />
        <Controls
          showZoom
          showFitView
          showInteractive
          className="bg-background/80 backdrop-blur-sm border border-border rounded-lg"
        />
        <MiniMap
          nodeColor={(node) => (node.data.color || NODE_COLORS.default) as string}
          className="bg-background/80 backdrop-blur-sm border border-border rounded-lg"
          maskColor="hsl(var(--background) / 0.8)"
        />
        <Panel
          position="top-right"
          className="bg-background/80 backdrop-blur-sm border border-border rounded-lg p-2 m-2"
        >
          <div className="text-xs text-muted-foreground space-y-1">
            <div>Nodes: {nodes.length}</div>
            <div>Edges: {edges.length}</div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
