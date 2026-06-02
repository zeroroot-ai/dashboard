'use client';

/**
 * KnowledgeGraph3D Component
 *
 * Interactive 3D knowledge graph visualization using Canvas 2D.
 * Pure Canvas implementation without external 3D libraries.
 *
 * Features:
 * - 3D force-directed layout with depth
 * - Mouse rotation, zoom (scroll wheel), and pan
 * - Node hover highlighting with labels
 * - Edge rendering with relationship colors
 * - Click-to-select nodes
 * - Performance optimized for 500+ nodes
 * - Crisp rendering at any DPR
 * - Wheel events blocked from propagating to parent scroll containers
 * - LOD (Level of Detail) scaling based on zoom level
 * - Selection highlighting with dimming of unconnected nodes
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { GraphNode, GraphEdge } from '@/src/types/graph';
import { nodeRenderer, NODE_SIZES } from '@/src/lib/graph/node-renderer';
import { parseEntityType, getRelationshipDashPattern, type RelationshipType } from '@/src/lib/graph/entity-taxonomy';
import { EdgeRenderer } from '@/src/lib/graph/edge-renderer';
import { animationManager } from '@/src/lib/graph/animation-manager';
import { ParticleSystem } from '@/src/lib/graph/particle-system';
import { useGraph3DPerformance } from '@/src/stores/graph3d-store';
import { ClusterManager } from '@/src/lib/graph/cluster-manager';
import {
  Rocket, Play, Bot, Wrench, Sparkles, Globe, Server,
  Plug, Cog, Link, Cpu, Shield, Bug, FileText, Crosshair, HelpCircle
} from 'lucide-react';

// Canvas colors for the graph. There is one locked dark brand; these mirror
// the background + grid values from DARK_THEME in theme-colors.ts (the single
// source of truth) so the Graph3DRenderer can access them without importing
// from src/lib inside the React component.
// Single locked dark brand (#652) — violet-led, mirrors src/lib/graph
// theme-colors.ts and globals.css --background.
const THEME_COLORS = {
  // Near-black blue-violet, aligned to --background (oklch 0.17 0.012 280)
  background: '#14121c',
  // Faint violet grid lines, aligned to --primary (oklch 0.58 0.225 295)
  grid: 'rgba(139, 92, 246, 0.07)',
} as const;

// ============================================================================
// Types
// ============================================================================

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Node3D {
  id: string;
  position: Vec3;
  velocity: Vec3;
  labels: string[];
  properties: Record<string, unknown>;
  color: string;
  size: number;
  screenX?: number;
  screenY?: number;
  screenSize?: number;
}

interface Edge3D {
  id: string;
  source: string;
  target: string;
  type: string;
  color: string;
}

interface Camera {
  rotationX: number;
  rotationY: number;
  // Single zoom value on a logarithmic scale.
  // zoom=1 means "default" view. zoom>1 zooms in, zoom<1 zooms out.
  zoom: number;
  // Pan offset in screen pixels (applied after projection)
  panX: number;
  panY: number;
}

// ============================================================================
// Constants
// ============================================================================

// How far the camera sits from the origin in world units (fixed).
const CAMERA_DISTANCE = 600;
// Focal length used for perspective divide (fixed — zoom is applied separately).
const FOCAL_LENGTH = 600;
// Min/max zoom factors — wide enough to go from "whole graph as tiny dots"
// to "single node fills screen".
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 20;
// Multiplicative zoom factor per wheel tick (feels natural, ~7% per tick).
const ZOOM_SPEED = 0.001;

const NODE_COLORS: Record<string, string> = {
  Mission: '#ffb000',      // Amber
  Agent: '#ff8c00',        // Orange
  AgentExecution: '#ff8c00',
  Host: '#00bfff',         // Cyan (contrast)
  Service: '#b87333',      // Bronze
  Vulnerability: '#ff4444', // Red (warning)
  Finding: '#ff6633',       // Orange-red
  Endpoint: '#7fff00',      // Chartreuse
  User: '#00bfff',          // Cyan
  Credential: '#ff4444',    // Red
  default: '#cc8800',       // Muted amber
};

const EDGE_COLORS: Record<string, string> = {
  DISCOVERED: '#22c55e',
  CONTAINS: '#3b82f6',
  EXPLOITS: '#ef4444',
  AFFECTS: '#f59e0b',
  USES: '#8b5cf6',
  HAS_CREDENTIAL: '#f43f5e',
  CONNECTS_TO: '#06b6d4',
  default: '#6b7280',
};

// ============================================================================
// Utility Functions
// ============================================================================

function getNodeColor(labels: string[]): string {
  for (const label of labels) {
    if (NODE_COLORS[label]) return NODE_COLORS[label];
  }
  return NODE_COLORS.default;
}

function getEdgeColor(type: string): string {
  return EDGE_COLORS[type] || EDGE_COLORS.default;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Get the appropriate Lucide icon component for an entity type
 */
function getEntityIcon(entityType: string): React.ReactNode {
  const iconProps = { className: "w-4 h-4" };
  switch (entityType) {
    case 'mission':
      return <Rocket {...iconProps} />;
    case 'mission_run':
      return <Play {...iconProps} />;
    case 'agent_run':
      return <Bot {...iconProps} />;
    case 'tool_execution':
      return <Wrench {...iconProps} />;
    case 'llm_call':
      return <Sparkles {...iconProps} />;
    case 'domain':
      return <Globe {...iconProps} />;
    case 'subdomain':
      return <Globe {...iconProps} />;
    case 'host':
      return <Server {...iconProps} />;
    case 'port':
      return <Plug {...iconProps} />;
    case 'service':
      return <Cog {...iconProps} />;
    case 'endpoint':
      return <Link {...iconProps} />;
    case 'technology':
      return <Cpu {...iconProps} />;
    case 'certificate':
      return <Shield {...iconProps} />;
    case 'finding':
      return <Bug {...iconProps} />;
    case 'evidence':
      return <FileText {...iconProps} />;
    case 'technique':
      return <Crosshair {...iconProps} />;
    default:
      return <HelpCircle {...iconProps} />;
  }
}

// ============================================================================
// Force-Directed Layout
// ============================================================================

class ForceLayout {
  nodes: Node3D[];
  edges: Edge3D[];
  nodeMap: Map<string, Node3D>;
  clusterManager: ClusterManager;
  private springLength = 100;
  private springStrength = 0.01;
  private repulsionStrength = 500;
  private damping = 0.8;
  private centerStrength = 0.005;

  constructor(graphNodes: GraphNode[], graphEdges: GraphEdge[]) {
    this.nodeMap = new Map();
    this.clusterManager = new ClusterManager();

    this.nodes = graphNodes.map((node, i) => {
      const angle = (i / graphNodes.length) * Math.PI * 2;
      const radius = 200 + Math.random() * 100;
      const height = (Math.random() - 0.5) * 200;

      const entityType = parseEntityType(node.labels);

      const node3d: Node3D = {
        id: node.id,
        position: {
          x: Math.cos(angle) * radius,
          y: height,
          z: Math.sin(angle) * radius,
        },
        velocity: { x: 0, y: 0, z: 0 },
        labels: node.labels,
        properties: node.properties,
        color: node.color || getNodeColor(node.labels),
        // Use NODE_SIZES tier system; fall back to 32 for unknown types
        size: (NODE_SIZES[entityType] ?? 32) / 4, // divide by 4 to match old "radius" scale
      };

      this.nodeMap.set(node.id, node3d);
      return node3d;
    });

    this.edges = graphEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      color: getEdgeColor(edge.type),
    }));

    // Assign nodes to clusters based on mission_run hierarchy
    this.clusterManager.assignClusters(this.nodes, this.edges);
  }

  step(): boolean {
    let totalMovement = 0;

    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const force: Vec3 = { x: 0, y: 0, z: 0 };

      // Repulsion from other nodes
      for (let j = 0; j < this.nodes.length; j++) {
        if (i === j) continue;
        const other = this.nodes[j];
        const dx = node.position.x - other.position.x;
        const dy = node.position.y - other.position.y;
        const dz = node.position.z - other.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

        const repulsion = this.repulsionStrength / (dist * dist);
        force.x += (dx / dist) * repulsion;
        force.y += (dy / dist) * repulsion;
        force.z += (dz / dist) * repulsion;
      }

      // Attraction to center
      force.x -= node.position.x * this.centerStrength;
      force.y -= node.position.y * this.centerStrength;
      force.z -= node.position.z * this.centerStrength;

      // Inter-cluster repulsion to keep mission_run clusters separated
      const clusterForce = this.clusterManager.getInterClusterRepulsionForce(
        node.id,
        node.position,
        1000 // repulsion strength for cluster separation
      );
      force.x += clusterForce.x;
      force.y += clusterForce.y;
      force.z += clusterForce.z;

      node.velocity.x = (node.velocity.x + force.x) * this.damping;
      node.velocity.y = (node.velocity.y + force.y) * this.damping;
      node.velocity.z = (node.velocity.z + force.z) * this.damping;
    }

    // Edge spring forces
    for (const edge of this.edges) {
      const source = this.nodeMap.get(edge.source);
      const target = this.nodeMap.get(edge.target);
      if (!source || !target) continue;

      const dx = target.position.x - source.position.x;
      const dy = target.position.y - source.position.y;
      const dz = target.position.z - source.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

      const displacement = dist - this.springLength;
      const spring = displacement * this.springStrength;

      const fx = (dx / dist) * spring;
      const fy = (dy / dist) * spring;
      const fz = (dz / dist) * spring;

      source.velocity.x += fx;
      source.velocity.y += fy;
      source.velocity.z += fz;
      target.velocity.x -= fx;
      target.velocity.y -= fy;
      target.velocity.z -= fz;
    }

    for (const node of this.nodes) {
      node.position.x += node.velocity.x;
      node.position.y += node.velocity.y;
      node.position.z += node.velocity.z;

      totalMovement +=
        Math.abs(node.velocity.x) + Math.abs(node.velocity.y) + Math.abs(node.velocity.z);
    }

    return totalMovement > 0.1;
  }
}

// ============================================================================
// 3D Renderer
// ============================================================================

class Graph3DRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  // Logical (CSS) dimensions — what we draw in.
  private cssWidth: number;
  private cssHeight: number;
  private dpr: number;

  private camera: Camera;
  private layout: ForceLayout;
  private edgeRenderer: EdgeRenderer;
  private particleSystem: ParticleSystem;
  private hoveredNode: Node3D | null = null;
  private hoveredEdge: Edge3D | null = null;
  private selectedNode: Node3D | null = null;
  private isDragging = false;
  private isPanning = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private animationId: number | null = null;
  private isLayoutStable = false;
  private onNodeClick?: (node: GraphNode) => void;
  private onNodeHover?: (node: GraphNode | null) => void;
  private onZoomChange?: (zoom: number) => void;
  private particlesEnabled: boolean = true;
  private activeEdges: Set<string> = new Set();
  // FPS counter for dev mode
  private frameCount = 0;
  private lastFpsUpdate = 0;
  private currentFps = 0;
  // Connected-node set for selection dimming
  private connectedNodeIds: Set<string> = new Set();
  // Cyber background: scanline y-offset (animated), reduced-motion flag
  private scanlineOffset: number = 0;
  private reducedMotion: boolean = false;

  constructor(
    canvas: HTMLCanvasElement,
    cssWidth: number,
    cssHeight: number,
    nodes: GraphNode[],
    edges: GraphEdge[],
    onNodeClick?: (node: GraphNode) => void,
    onNodeHover?: (node: GraphNode | null) => void,
    onZoomChange?: (zoom: number) => void
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.dpr = window.devicePixelRatio || 1;
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.onNodeClick = onNodeClick;
    this.onNodeHover = onNodeHover;
    this.onZoomChange = onZoomChange;
    // Detect prefers-reduced-motion — static at construction time.
    this.reducedMotion = typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

    // Apply DPR scale once at construction — never again.
    this.ctx.scale(this.dpr, this.dpr);

    this.camera = {
      rotationX: -0.3,
      rotationY: 0,
      zoom: 1,
      panX: 0,
      panY: 0,
    };

    this.layout = new ForceLayout(nodes, edges);
    this.edgeRenderer = new EdgeRenderer();
    this.particleSystem = new ParticleSystem(200);

    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);

    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('mouseleave', this.handleMouseUp);
    // passive: false is required so we can call e.preventDefault() and prevent
    // the parent <main overflow-auto> from scrolling when the user wheels over the graph.
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.canvas.addEventListener('click', this.handleClick);
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
  }

  private removeEventListeners(): void {
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('mouseleave', this.handleMouseUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('click', this.handleClick);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
  }

  private handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
  }

  private handleMouseDown(e: MouseEvent): void {
    // Left click = pan (like Neo4j); right/middle click = rotate
    if (e.button === 0) {
      this.isPanning = true;
    } else if (e.button === 1 || e.button === 2) {
      this.isDragging = true;
    }
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    e.preventDefault();
  }

  private handleMouseMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (this.isDragging) {
      const deltaX = e.clientX - this.lastMouseX;
      const deltaY = e.clientY - this.lastMouseY;

      this.camera.rotationY += deltaX * 0.005;
      this.camera.rotationX += deltaY * 0.005;
      this.camera.rotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.camera.rotationX));

      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    } else if (this.isPanning) {
      const deltaX = e.clientX - this.lastMouseX;
      const deltaY = e.clientY - this.lastMouseY;
      this.camera.panX += deltaX;
      this.camera.panY += deltaY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    }

    // Hit-test nodes in screen space
    this.hoveredNode = null;
    for (const node of this.layout.nodes) {
      if (node.screenX !== undefined && node.screenY !== undefined && node.screenSize !== undefined) {
        const dx = mouseX - node.screenX;
        const dy = mouseY - node.screenY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Add a few pixels of hit padding so small nodes are easier to click
        if (dist < node.screenSize + 6) {
          this.hoveredNode = node;
          break;
        }
      }
    }

    // Hit-test edges in screen space (only if no node is hovered)
    if (!this.hoveredNode) {
      this.hoveredEdge = null;
      for (const edge of this.layout.edges) {
        const source = this.layout.nodeMap.get(edge.source);
        const target = this.layout.nodeMap.get(edge.target);
        if (source?.screenX !== undefined && target?.screenX !== undefined) {
          const dist = this.pointToLineDistance(
            mouseX,
            mouseY,
            source.screenX,
            source.screenY!,
            target.screenX,
            target.screenY!
          );
          // 8px hit tolerance for edges
          if (dist < 8) {
            this.hoveredEdge = edge;
            break;
          }
        }
      }
    } else {
      // Clear edge hover when a node is hovered
      this.hoveredEdge = null;
    }

    this.canvas.style.cursor = this.hoveredNode || this.hoveredEdge
      ? 'pointer'
      : this.isDragging || this.isPanning
      ? 'grabbing'
      : 'grab';

    if (this.onNodeHover) {
      if (this.hoveredNode) {
        this.onNodeHover({
          id: this.hoveredNode.id,
          labels: this.hoveredNode.labels,
          properties: this.hoveredNode.properties,
          color: this.hoveredNode.color,
        } as GraphNode);
      } else {
        this.onNodeHover(null);
      }
    }
  }

  private handleMouseUp(): void {
    this.isDragging = false;
    this.isPanning = false;
  }

  private handleWheel(e: WheelEvent): void {
    // Always prevent default — this stops the parent <main> from scrolling.
    e.preventDefault();
    e.stopPropagation();

    // Exponential zoom: multiply/divide by a factor proportional to scroll amount.
    // deltaY > 0 means scroll down = zoom out; deltaY < 0 = scroll up = zoom in.
    // Using e.deltaY directly (which can be large for trackpads) clamped so a
    // single event never changes zoom by more than 40%.
    const rawDelta = e.deltaY;
    // Clamp to prevent huge jumps from high-resolution trackpads
    const clampedDelta = Math.max(-200, Math.min(200, rawDelta));
    const factor = Math.exp(-clampedDelta * ZOOM_SPEED);
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.camera.zoom * factor));
    this.camera.zoom = newZoom;

    if (this.onZoomChange) {
      this.onZoomChange(newZoom);
    }
  }

  private handleClick(e: MouseEvent): void {
    if (this.hoveredNode) {
      // Check if it's a mission_run node
      if (this.hoveredNode.labels.includes('mission_run')) {
        const clusterId = this.layout.clusterManager.getClusterForNode(this.hoveredNode.id);
        this.layout.clusterManager.setFocusedCluster(clusterId);

        // Optionally animate camera to cluster center
        const clusterCenter = clusterId ? this.layout.clusterManager.getClusterCenter(clusterId) : null;
        if (clusterCenter) {
          // TODO: Could add smooth camera animation to cluster center here
          // For now, just set focus visually
        }
      }

      // Always call the node click handler
      if (this.onNodeClick) {
        this.selectedNode = this.hoveredNode;
        // Build the set of node IDs connected to the selected node
        this.connectedNodeIds = this.buildConnectedSet(this.hoveredNode.id);
        this.onNodeClick({
          id: this.hoveredNode.id,
          labels: this.hoveredNode.labels,
          properties: this.hoveredNode.properties,
          color: this.hoveredNode.color,
        } as GraphNode);
      }
    } else {
      // Clicked on background - clear cluster focus and selection
      this.layout.clusterManager.setFocusedCluster(null);
      this.selectedNode = null;
      this.connectedNodeIds.clear();
    }
  }

  /**
   * Build the set of node IDs directly connected to a given node (one hop).
   * Includes the node itself so it doesn't get dimmed.
   */
  private buildConnectedSet(nodeId: string): Set<string> {
    const connected = new Set<string>([nodeId]);
    for (const edge of this.layout.edges) {
      if (edge.source === nodeId) connected.add(edge.target);
      if (edge.target === nodeId) connected.add(edge.source);
    }
    return connected;
  }

  /**
   * Project a world-space Vec3 to screen space.
   *
   * The camera sits at z = +CAMERA_DISTANCE looking toward the origin.
   * After rotation, a node at world origin would be at camera-space z = 0
   * (exactly at the camera), which we avoid by adding CAMERA_DISTANCE.
   *
   * Perspective scale = FOCAL_LENGTH / (FOCAL_LENGTH + cameraSpaceZ)
   * Then the camera.zoom multiplier is applied uniformly, giving a clean
   * zoom that does not interact with the depth calculation.
   *
   * Screen origin is at the canvas centre, offset by pan.
   */
  private project(pos: Vec3): { x: number; y: number; z: number; scale: number } {
    let x = pos.x;
    let y = pos.y;
    let z = pos.z;

    // Rotate around Y axis
    const cosY = Math.cos(this.camera.rotationY);
    const sinY = Math.sin(this.camera.rotationY);
    const rx = x * cosY - z * sinY;
    const rz = x * sinY + z * cosY;
    x = rx;
    z = rz;

    // Rotate around X axis
    const cosX = Math.cos(this.camera.rotationX);
    const sinX = Math.sin(this.camera.rotationX);
    const ry = y * cosX - z * sinX;
    const rz2 = y * sinX + z * cosX;
    y = ry;
    z = rz2;

    // Camera is behind the scene; bring rotated coords into camera space.
    const cameraZ = z + CAMERA_DISTANCE;

    // Perspective divide — avoid division by near-zero
    const perspScale = FOCAL_LENGTH / Math.max(0.1, FOCAL_LENGTH + cameraZ);

    // Apply zoom on top of perspective — this is the single source of zoom truth.
    const scale = perspScale * this.camera.zoom;

    const cx = this.cssWidth / 2 + this.camera.panX;
    const cy = this.cssHeight / 2 + this.camera.panY;

    return {
      x: cx + x * scale,
      y: cy + y * scale,
      z: cameraZ,
      scale,
    };
  }

  /**
   * Linearly interpolate between two hex colors
   * @param color1 - Start color in hex format (#RRGGBB)
   * @param color2 - End color in hex format (#RRGGBB)
   * @param t - Interpolation factor (0-1)
   * @returns Interpolated color in hex format
   */
  private lerpColor(color1: string, color2: string, t: number): string {
    const r1 = parseInt(color1.slice(1, 3), 16);
    const g1 = parseInt(color1.slice(3, 5), 16);
    const b1 = parseInt(color1.slice(5, 7), 16);
    const r2 = parseInt(color2.slice(1, 3), 16);
    const g2 = parseInt(color2.slice(3, 5), 16);
    const b2 = parseInt(color2.slice(5, 7), 16);

    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  /**
   * Calculate the shortest distance from a point to a line segment.
   * Used for edge hover detection.
   */
  private pointToLineDistance(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;
    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private updateActiveEdges(): void {
    const newActiveEdges = new Set<string>();

    // Find all edges connected to running nodes
    for (const edge of this.layout.edges) {
      const source = this.layout.nodeMap.get(edge.source);
      const target = this.layout.nodeMap.get(edge.target);

      // Check if either source or target node is running
      const sourceRunning = source && source.properties.status === 'running';
      const targetRunning = target && target.properties.status === 'running';

      if (sourceRunning || targetRunning) {
        newActiveEdges.add(edge.id);

        // Skip particle updates for off-screen edges
        const isVisible = (
          source &&
          target &&
          source.screenX !== undefined &&
          target.screenX !== undefined &&
          source.screenX > -50 && source.screenX < this.cssWidth + 50 &&
          target.screenX > -50 && target.screenX < this.cssWidth + 50
        );

        // Activate particles if not already active and edge is visible
        if (!this.activeEdges.has(edge.id) && isVisible) {
          this.particleSystem.activateEdge(
            edge.id,
            source.screenX!,
            source.screenY!,
            target.screenX!,
            target.screenY!,
            edge.color
          );
        }
      }
    }

    // Deactivate edges that are no longer active
    for (const edgeId of this.activeEdges) {
      if (!newActiveEdges.has(edgeId)) {
        this.particleSystem.deactivateEdge(edgeId);
      }
    }

    this.activeEdges = newActiveEdges;
  }

  private render(): void {
    const { ctx } = this;
    const colors = THEME_COLORS;
    const zoom = this.camera.zoom;

    // Clear — draw in logical (CSS) pixel space because ctx was scaled by DPR at init.
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    // Cyber background layer: vignette + scanline
    this.drawCyberBackground();

    this.drawGrid();

    // Project all nodes
    const projectedNodes: Array<{ node: Node3D; projected: { x: number; y: number; z: number; scale: number } }> = [];
    for (const node of this.layout.nodes) {
      const projected = this.project(node.position);
      node.screenX = projected.x;
      node.screenY = projected.y;
      // Scale the base node size by the combined perspective+zoom scale
      node.screenSize = node.size * projected.scale;
      projectedNodes.push({ node, projected });
    }

    // Back-to-front sort for painter's algorithm
    projectedNodes.sort((a, b) => b.projected.z - a.projected.z);

    // Count visible nodes for performance optimization
    const visibleNodeCount = projectedNodes.filter(n =>
      n.projected.x > 0 && n.projected.x < this.cssWidth &&
      n.projected.y > 0 && n.projected.y < this.cssHeight
    ).length;

    // Reduce glow quality when > 300 nodes visible
    const glowQuality = visibleNodeCount > 300 ? 0.5 : 1.0;

    // Whether a selection is active (determines if unconnected nodes should be dimmed)
    const hasSelection = this.selectedNode !== null;

    // Draw edges first (behind nodes)
    for (const edge of this.layout.edges) {
      const source = this.layout.nodeMap.get(edge.source);
      const target = this.layout.nodeMap.get(edge.target);

      if (
        source?.screenX !== undefined &&
        source.screenY !== undefined &&
        target?.screenX !== undefined &&
        target.screenY !== undefined
      ) {
        // Fade edges that are far away (large cameraZ)
        const avgDepth =
          (this.project(source.position).z + this.project(target.position).z) / 2;
        let alpha = Math.max(0.1, Math.min(0.7, 500 / Math.max(1, avgDepth)));

        // Check cluster focus and dim edges connecting to unfocused clusters
        const focusedCluster = this.layout.clusterManager.getFocusedCluster();
        const sourceCluster = this.layout.clusterManager.getClusterForNode(source.id);
        const targetCluster = this.layout.clusterManager.getClusterForNode(target.id);
        const isEdgeFocused = !focusedCluster ||
                              sourceCluster === focusedCluster ||
                              targetCluster === focusedCluster;
        // Reduce alpha for edges not connected to focused cluster
        alpha = isEdgeFocused ? alpha : alpha * 0.3;

        // Get dash pattern from relationship type
        const dashInfo = getRelationshipDashPattern(edge.type as RelationshipType);

        // Check if either source or target node has status 'running' for animation
        const isSourceRunning = source.properties.status === 'running';
        const isTargetRunning = target.properties.status === 'running';
        const shouldAnimate = isSourceRunning || isTargetRunning;

        // Get animation offset from animation manager (50 pixels per second)
        const animationOffset = shouldAnimate ? animationManager.getDashOffset(50) : 0;

        // Check if this edge is hovered
        const isHovered = edge === this.hoveredEdge;

        // Path highlight: on-path edges at full opacity, off-path dimmed to 0.1
        if (this.hasHighlight) {
          if (this.highlightedEdgeIds.has(edge.id)) {
            alpha = 1.0;
          } else {
            alpha = 0.1;
          }
        }

        // Draw edge using EdgeRenderer
        this.edgeRenderer.drawEdge(
          ctx,
          source.screenX,
          source.screenY,
          target.screenX,
          target.screenY,
          {
            color: edge.color,
            dashPattern: dashInfo.pattern,
            animated: shouldAnimate,
            animationOffset: animationOffset,
            glowEnabled: true,
            alpha: isHovered ? Math.min(1, alpha + 0.3) : alpha,
            lineWidth: isHovered || (this.hasHighlight && this.highlightedEdgeIds.has(edge.id))
              ? Math.max(0.5, 0.8 * this.camera.zoom)
              : Math.max(0.2, 0.4 * this.camera.zoom),
          }
        );
      }
    }

    // Render particles (after edges, before nodes)
    // Disable particle effects below zoom threshold for performance
    const shouldRenderParticles =
      this.particlesEnabled && !this.reducedMotion && this.camera.zoom > 0.3;
    if (shouldRenderParticles) {
      this.particleSystem.render(ctx);
    }

    // Draw nodes
    for (const { node, projected } of projectedNodes) {
      const isHovered = node === this.hoveredNode;
      const isSelected = node === this.selectedNode;
      // Check if node is connected to hovered edge
      const isEdgeEndpoint = this.hoveredEdge &&
        (this.hoveredEdge.source === node.id || this.hoveredEdge.target === node.id);
      // Nodes very far behind the camera can be skipped
      if (projected.z < -FOCAL_LENGTH) continue;

      // Parse entity type from node labels for NODE_SIZES lookup
      const entityType = parseEntityType(node.labels);

      // Use NODE_SIZES tier — the base size in logical pixels
      const baseSize = NODE_SIZES[entityType] ?? 32;

      // LOD: at very low zoom, reduce the drawn size to 60% to keep the graph legible
      let lodSize: number;
      if (zoom < 0.15) {
        lodSize = baseSize * 0.6;
      } else {
        lodSize = baseSize;
      }

      // Scale by perspective+zoom, but floor to avoid invisible nodes
      const screenSize = Math.max(1.5, lodSize * projected.scale);

      let alpha = Math.max(0.2, Math.min(1, 500 / Math.max(1, projected.z)));

      // Check cluster focus and dim unfocused clusters
      const focusedCluster = this.layout.clusterManager.getFocusedCluster();
      const nodeCluster = this.layout.clusterManager.getClusterForNode(node.id);
      const isFocused = !focusedCluster || nodeCluster === focusedCluster;
      alpha = isFocused ? alpha : alpha * 0.3;

      // Boost alpha slightly for edge endpoints
      if (isEdgeEndpoint) {
        alpha = Math.min(1, alpha + 0.2);
      }

      // Selection dimming: unconnected nodes get alpha 0.3
      if (hasSelection && !isSelected && !this.connectedNodeIds.has(node.id)) {
        alpha = 0.3;
      }

      // Path highlight: on-path nodes at full opacity, off-path dimmed to 0.1
      if (this.hasHighlight) {
        if (this.highlightedNodeIds.has(node.id)) {
          alpha = 1.0;
        } else {
          alpha = 0.1;
        }
      }

      // Check if node is in active/running state
      const isActive = node.properties.status === 'running';

      // Generate pulse phase (0-1 sine wave) for active nodes
      const pulsePhase = isActive ? (Date.now() % 2000) / 2000 : 0;

      // Severity for finding nodes
      const severity = node.properties.severity as
        | 'critical' | 'high' | 'medium' | 'low' | 'info'
        | undefined;

      // At extreme low zoom (< 0.15), draw a minimal plain square via nodeRenderer
      // (it handles the fallback internally via drawNode at small sizes).
      // At low zoom (< 0.3), draw the node chip but skip labels entirely.
      // Otherwise draw labels according to zoom level.
      nodeRenderer.drawNode(
        ctx,
        entityType,
        node.screenX!,
        node.screenY!,
        screenSize,
        {
          color: node.color,
          alpha,
          isHovered: !!(isHovered || isEdgeEndpoint),
          isSelected,
          isActive,
          pulsePhase,
          severity,
          glowQuality,
        }
      );

      // Label drawing — controlled by LOD zoom thresholds
      const shouldDrawLabels = zoom >= 0.3;
      if (shouldDrawLabels) {
        const label = (node.properties.name as string) || node.id;
        const labelY = node.screenY! + screenSize / 2 + 10;

        if (zoom > 0.8) {
          // Standard label below the node in monospace font
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';

          // Halo / outline pass: dark stroke wide enough to create a solid
          // contrast border around every glyph. Works against both the
          // deep-navy background AND bright-coloured node chips (issue #636).
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          // Outer glow — very faint shadow so label lifts off the canvas
          ctx.shadowColor  = 'rgba(0, 0, 0, 0.9)';
          ctx.shadowBlur   = 4;
          ctx.strokeStyle  = 'rgba(0, 0, 0, 0.9)';
          ctx.lineWidth    = 4;
          ctx.strokeText(label, node.screenX!, labelY);
          ctx.shadowBlur   = 0;
          ctx.shadowColor  = 'transparent';

          // Fill: near-white (#f0f5ef ≈ --foreground dark) at high-alpha
          ctx.fillStyle = `rgba(240, 245, 239, ${Math.min(1, alpha + 0.3)})`;
          ctx.fillText(label, node.screenX!, labelY);

          // At high zoom, also draw a property line below the label
          if (zoom > 1.5) {
            const propLine = buildPropertyLine(node);
            if (propLine) {
              const propY = labelY + 13;
              ctx.font = '9px monospace';
              ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
              ctx.lineWidth = 3;
              ctx.strokeText(propLine, node.screenX!, propY);
              // Muted cyan secondary text for property line (brand --link aligned)
              ctx.fillStyle = `rgba(128, 216, 255, ${Math.min(0.9, alpha)})`;
              ctx.fillText(propLine, node.screenX!, propY);
            }
          }
        } else if (isHovered) {
          // Always show label on hovered nodes even between 0.3 and 0.8
          const fontSize = Math.max(11, Math.min(16, 13 * zoom));
          ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';

          // Hover label: stronger halo + phosphor-green tint on the fill
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          ctx.shadowColor  = 'rgba(0, 0, 0, 0.9)';
          ctx.shadowBlur   = 6;
          ctx.strokeStyle  = 'rgba(0, 0, 0, 0.9)';
          ctx.lineWidth    = 4;
          ctx.strokeText(label, node.screenX!, labelY);
          ctx.shadowBlur   = 0;
          ctx.shadowColor  = 'transparent';

          // Near-white fill — readable against any node color or the bg
          ctx.fillStyle = `rgba(240, 245, 239, ${Math.min(1, alpha + 0.3)})`;
          ctx.fillText(label, node.screenX!, labelY);
        }
      }
    }

    this.drawStats();

    // Dev FPS counter is now shown in the Graph3DControls overlay (Stats/FPS HUD)
    // with high-contrast color-coded display. This canvas fallback is no longer needed.
  }

  /**
   * Draw the cyber atmosphere layer (dark theme only).
   *
   * Layers (back to front):
   *   1. Radial vignette — brighter centre → darker edges (depth perception)
   *   2. CRT scanline — a single translucent horizontal band that scrolls
   *      downward; paused when prefers-reduced-motion is set.
   *
   * All effects are low-opacity so node/label/HUD contrast (slice #633)
   * is unaffected. The scanline opacity is intentionally minimal — its
   * purpose is atmosphere, not visibility — and respects the brand
   * `--scanline-opacity` token value (0.010 in dark mode).
   */
  private drawCyberBackground(): void {
    const { ctx } = this;
    const w = this.cssWidth;
    const h = this.cssHeight;

    // -- 1. Radial vignette --------------------------------------------------
    // Brighter centre (transparent) → darker edges (deep-black overlay).
    // Outer alpha 0.4 gives perceptible depth without washing out node colors.
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.sqrt(cx * cx + cy * cy);

    const vignette = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    vignette.addColorStop(0,   'rgba(0, 0, 0, 0)');
    vignette.addColorStop(0.6, 'rgba(0, 0, 0, 0.05)');
    vignette.addColorStop(1,   'rgba(0, 0, 0, 0.40)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    // -- 2. CRT scanline -----------------------------------------------------
    // A single horizontal band, 2px tall, scrolls downward once per ~4 s.
    // When prefers-reduced-motion is set the band is rendered static at the
    // top of the frame (still visible as a subtle decoration, but not moving).
    // Opacity 0.010 aligns to the --scanline-opacity brand token value.
    const SCANLINE_OPACITY = 0.010;
    const SCANLINE_HEIGHT  = 2;
    const SCANLINE_SPEED   = h / 4; // px/s → one pass per 4 s

    if (!this.reducedMotion) {
      // Advance position each render call. animationManager.getDeltaTime()
      // returns seconds since last frame.
      const dt = animationManager.getDeltaTime();
      this.scanlineOffset = (this.scanlineOffset + SCANLINE_SPEED * dt) % (h + SCANLINE_HEIGHT);
    }

    const scanlineY = this.reducedMotion ? 0 : this.scanlineOffset;

    ctx.fillStyle = `rgba(158, 230, 64, ${SCANLINE_OPACITY})`; // phosphor green
    ctx.fillRect(0, scanlineY, w, SCANLINE_HEIGHT);
  }

  private drawGrid(): void {
    const { ctx } = this;
    const gridSize = 50;
    const gridCount = 10;
    const colors = THEME_COLORS;

    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;

    for (let i = -gridCount; i <= gridCount; i++) {
      const startH = this.project({ x: i * gridSize, y: 0, z: -gridCount * gridSize });
      const endH = this.project({ x: i * gridSize, y: 0, z: gridCount * gridSize });

      if (startH.z > 0 && endH.z > 0) {
        ctx.beginPath();
        ctx.moveTo(startH.x, startH.y);
        ctx.lineTo(endH.x, endH.y);
        ctx.stroke();
      }

      const startV = this.project({ x: -gridCount * gridSize, y: 0, z: i * gridSize });
      const endV = this.project({ x: gridCount * gridSize, y: 0, z: i * gridSize });

      if (startV.z > 0 && endV.z > 0) {
        ctx.beginPath();
        ctx.moveTo(startV.x, startV.y);
        ctx.lineTo(endV.x, endV.y);
        ctx.stroke();
      }
    }
  }

  private drawStats(): void {
    // Stats are shown in the Graph3DControls overlay — no need to duplicate on canvas
  }

  start(): void {
    let frameCount = 0;
    const maxLayoutIterations = 200;

    // Start animation manager for edge animations
    animationManager.start();

    const animate = () => {
      // Update force layout
      if (!this.isLayoutStable && frameCount < maxLayoutIterations) {
        this.isLayoutStable = !this.layout.step();
      }

      // Update animation manager each frame
      animationManager.update();

      // Get delta time for particle system
      const deltaTime = animationManager.getDeltaTime();

      // Update active edges for particle flow + the flowing-line particles.
      // Both are skipped under prefers-reduced-motion so the graph stays
      // static for motion-sensitive users.
      if (!this.reducedMotion) {
        this.updateActiveEdges();
        this.particleSystem.update(deltaTime);
      }

      // Render frame
      this.render();

      // Update FPS counter
      this.frameCount++;
      if (Date.now() - this.lastFpsUpdate > 1000) {
        this.currentFps = this.frameCount;
        this.frameCount = 0;
        this.lastFpsUpdate = Date.now();
      }

      frameCount++;
      this.animationId = requestAnimationFrame(animate);
    };

    animate();
  }

  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    // Stop animation manager
    animationManager.stop();
    this.removeEventListeners();
  }

  /**
   * Resize the renderer to new CSS dimensions.
   *
   * IMPORTANT: Do NOT call ctx.scale() here. The DPR scale was applied once
   * in the constructor via ctx.scale(dpr, dpr). Calling it again on each
   * resize would stack transforms and corrupt all rendering coordinates.
   *
   * Instead we resize the canvas buffer (physical pixels) and the CSS display
   * size, then restore the DPR transform by resetting and re-applying it to
   * the fresh context state.
   */
  resize(cssWidth: number, cssHeight: number): void {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;

    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;

    // Resize the backing buffer
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    // Resizing resets the context transform — reapply DPR scale once.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  selectNode(nodeId: string | null): void {
    this.selectedNode = nodeId ? (this.layout.nodeMap.get(nodeId) ?? null) : null;
    if (this.selectedNode) {
      this.connectedNodeIds = this.buildConnectedSet(this.selectedNode.id);
    } else {
      this.connectedNodeIds.clear();
    }
  }

  /** Track highlighted path node/edge sets for path-query visualisation. */
  private highlightedNodeIds: Set<string> = new Set();
  private highlightedEdgeIds: Set<string> = new Set();
  private hasHighlight = false;

  setHighlightedPathIds(nodeIds: Set<string>, edgeIds: Set<string>): void {
    this.highlightedNodeIds = nodeIds;
    this.highlightedEdgeIds = edgeIds;
    this.hasHighlight = nodeIds.size > 0 || edgeIds.size > 0;
  }

  resetCamera(): void {
    this.camera = {
      rotationX: -0.3,
      rotationY: 0,
      zoom: 1,
      panX: 0,
      panY: 0,
    };
    if (this.onZoomChange) this.onZoomChange(1);
  }

  setParticlesEnabled(enabled: boolean): void {
    this.particlesEnabled = enabled;
    if (!enabled) {
      this.particleSystem.clear();
    }
  }

  getZoom(): number {
    return this.camera.zoom;
  }

  getHoveredEdge(): Edge3D | null {
    return this.hoveredEdge;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a short one-line property string for a node, used for the zoom > 1.5
 * detail text row. Returns null if there is nothing interesting to show.
 */
function buildPropertyLine(node: Node3D): string | null {
  const p = node.properties;
  if (p.ip) return `ip: ${p.ip}`;
  if (p.port) return `port: ${p.port}`;
  if (p.status) return `status: ${p.status}`;
  if (p.severity) return `sev: ${p.severity}`;
  if (p.product) return String(p.product);
  return null;
}

// ============================================================================
// React Component
// ============================================================================

export interface HighlightedPath {
  node_ids: string[];
  edge_ids: string[];
}

export interface KnowledgeGraph3DProps {
  data?: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
  onNodeClick?: (node: GraphNode) => void;
  onNodeHover?: (node: GraphNode | null) => void;
  loading?: boolean;
  error?: string;
  className?: string;
  /**
   * Paths returned by QueryPaths. When set, edges on these paths render at
   * full opacity and off-path nodes/edges are dimmed to 0.1.
   */
  highlightedPaths?: HighlightedPath[];
  /**
   * Duration in ms over which newly-streamed nodes fade from opacity 0 to 1.
   * Nodes carrying an `addedAt` property (epoch ms) within this window are
   * tweened. Default 800ms.
   */
  nodeFadeInDuration?: number;
}

export function KnowledgeGraph3D({
  data = { nodes: [], edges: [] },
  onNodeClick,
  onNodeHover,
  loading = false,
  error,
  className,
  highlightedPaths,
  nodeFadeInDuration = 800,
}: KnowledgeGraph3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Graph3DRenderer | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const { performance } = useGraph3DPerformance();

  const handleNodeHover = useCallback(
    (node: GraphNode | null) => {
      setHoveredNode(node);
      onNodeHover?.(node);
    },
    [onNodeHover]
  );

  const handleZoomChange = useCallback((zoom: number) => {
    setZoomPct(Math.round(zoom * 100));
  }, []);

  // Initialize renderer once data is available
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current || loading || error) return;
    if (data.nodes.length === 0) return;

    const container = containerRef.current;
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;

    // Measure the container in CSS pixels
    const rect = container.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;

    // Set the canvas buffer size (physical pixels)
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    // Set the CSS display size
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const renderer = new Graph3DRenderer(
      canvas,
      cssW,
      cssH,
      data.nodes,
      data.edges,
      onNodeClick,
      handleNodeHover,
      handleZoomChange
    );
    rendererRef.current = renderer;
    renderer.start();

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        renderer.resize(width, height);
      }
    });
    resizeObserver.observe(container);

    return () => {
      renderer.stop();
      resizeObserver.disconnect();
      rendererRef.current = null;
    };
    // Intentionally exclude onNodeClick/handleNodeHover — they are stable refs
    // but we don't want to recreate the renderer when callbacks change identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.nodes, data.edges, loading, error]);

  // Update renderer particle settings when store changes
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setParticlesEnabled(performance.particleEffects);
    }
  }, [performance.particleEffects]);

  // Update highlighted path sets on the renderer when prop changes.
  useEffect(() => {
    if (!rendererRef.current) return;
    if (!highlightedPaths || highlightedPaths.length === 0) {
      rendererRef.current.setHighlightedPathIds(new Set(), new Set());
      return;
    }
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    for (const path of highlightedPaths) {
      for (const id of path.node_ids) nodeIds.add(id);
      for (const id of path.edge_ids) edgeIds.add(id);
    }
    rendererRef.current.setHighlightedPathIds(nodeIds, edgeIds);
  }, [highlightedPaths]);

  // Node fade-in: nodes with addedAt within nodeFadeInDuration are tweened.
  // We expose this via the node's properties.addedAt (epoch ms). The renderer
  // reads alpha from the render loop; to implement fade-in we periodically
  // force re-renders by toggling a counter when newly-added nodes are present.
  // This is a lightweight approximation — we don't need sub-frame precision.
  const [, setFadeTick] = useState(0);
  useEffect(() => {
    if (!nodeFadeInDuration) return;
    const now = Date.now();
    const freshNodes = data.nodes.filter(n => {
      const addedAt = n.properties?.addedAt as number | undefined;
      return addedAt && now - addedAt < nodeFadeInDuration;
    });
    if (freshNodes.length === 0) return;
    const interval = setInterval(() => {
      const still = data.nodes.some(n => {
        const addedAt = n.properties?.addedAt as number | undefined;
        return addedAt && Date.now() - addedAt < nodeFadeInDuration;
      });
      if (still) {
        setFadeTick(t => t + 1);
      } else {
        clearInterval(interval);
      }
    }, 32); // ~30fps updates for fade
    return () => clearInterval(interval);
  }, [data.nodes, nodeFadeInDuration]);

  if (loading) {
    return (
      <div className={cn('w-full h-full flex items-center justify-center bg-background', className)}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading 3D graph...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('w-full h-full flex items-center justify-center bg-background', className)}>
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <div className="w-12 h-12 text-destructive">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Failed to load 3D graph</h3>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (data.nodes.length === 0) {
    return (
      <div className={cn('w-full h-full flex items-center justify-center bg-background', className)}>
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <div className="w-12 h-12 text-muted-foreground">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No graph data available</h3>
            <p className="text-sm text-muted-foreground">
              Select a mission or run a scan to populate the 3D knowledge graph.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full h-full overflow-hidden', className)}
      // Prevent the container itself from scrolling or bouncing on overscroll,
      // which would compete with the canvas wheel handler.
      style={{ touchAction: 'none', overscrollBehavior: 'none' }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block"
        // touch-action none on the canvas element tells the browser not to
        // handle touch/pointer events as scroll gestures.
        style={{ touchAction: 'none' }}
      />

      {/* Hover tooltip */}
      {hoveredNode && (
        <div className="absolute top-4 left-4 bg-background/90 backdrop-blur-sm border border-border rounded-lg p-3 shadow-lg max-w-sm pointer-events-none">
          {/* Header with icon and name */}
          <div className="flex items-center gap-2 mb-2">
            <div className="text-foreground flex-shrink-0">{getEntityIcon(parseEntityType(hoveredNode.labels))}</div>
            <span className="font-semibold text-foreground truncate">
              {(hoveredNode.properties.name as string) || hoveredNode.id}
            </span>
          </div>

          {/* Entity type label */}
          <div className="text-xs text-muted-foreground mb-2">
            {hoveredNode.labels.join(', ')}
          </div>

          {/* Key properties */}
          <div className="text-xs space-y-1.5">
            {/* Severity badge for findings */}
            {Boolean(hoveredNode.properties.severity) && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground min-w-[60px]">Severity:</span>
                <span className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium",
                  hoveredNode.properties.severity === 'critical' && "bg-destructive/20 text-destructive border border-destructive/30",
                  hoveredNode.properties.severity === 'high' && "bg-alt/20 text-alt border border-alt/30",
                  hoveredNode.properties.severity === 'medium' && "bg-alt/20 text-alt border border-alt/30",
                  hoveredNode.properties.severity === 'low' && "bg-link/20 text-link border border-link/30",
                  hoveredNode.properties.severity === 'info' && "bg-muted/20 text-muted-foreground border border-border/30"
                )}>
                  {(hoveredNode.properties.severity as string).toUpperCase()}
                </span>
              </div>
            )}

            {/* Status badge for missions/runs */}
            {Boolean(hoveredNode.properties.status) && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground min-w-[60px]">Status:</span>
                <span className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium",
                  hoveredNode.properties.status === 'running' && "bg-highlight/20 text-highlight border border-highlight/30",
                  hoveredNode.properties.status === 'completed' && "bg-link/20 text-link border border-link/30",
                  hoveredNode.properties.status === 'failed' && "bg-destructive/20 text-destructive border border-destructive/30",
                  hoveredNode.properties.status === 'pending' && "bg-muted/20 text-muted-foreground border border-border/30"
                )}>
                  {(hoveredNode.properties.status as string).charAt(0).toUpperCase() + (hoveredNode.properties.status as string).slice(1)}
                </span>
              </div>
            )}

            {/* IP address for hosts */}
            {Boolean(hoveredNode.properties.ip) && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground min-w-[60px]">IP:</span>
                <span className="text-foreground font-mono text-xs">{hoveredNode.properties.ip as string}</span>
              </div>
            )}

            {/* Port for services/ports */}
            {Boolean(hoveredNode.properties.port) && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground min-w-[60px]">Port:</span>
                <span className="text-foreground font-mono text-xs">{hoveredNode.properties.port as string}</span>
              </div>
            )}

            {/* Product for services */}
            {Boolean(hoveredNode.properties.product) && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground min-w-[60px]">Product:</span>
                <span className="text-foreground text-xs">{hoveredNode.properties.product as string}</span>
              </div>
            )}

            {/* Connection count */}
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50">
              <span className="text-muted-foreground min-w-[60px]">Connections:</span>
              <span className="text-foreground font-semibold">
                {data.edges.filter(e => e.source === hoveredNode.id || e.target === hoveredNode.id).length}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Controls hint — legible panel with border */}
      <div className="absolute bottom-4 left-4 text-xs text-foreground/70 bg-background/80 backdrop-blur-md border border-border/60 rounded px-2 py-1 pointer-events-none select-none">
        Drag to pan &bull; Right-click drag to rotate &bull; Scroll to zoom &bull; Click node to select
      </div>

      {/* Live zoom indicator — high-contrast, monospace tabular nums */}
      <div className="absolute bottom-4 right-4 text-xs text-foreground font-mono font-semibold tabular-nums bg-background/80 backdrop-blur-md border border-border/60 rounded px-2 py-1 pointer-events-none select-none">
        {zoomPct}%
      </div>
    </div>
  );
}

export default KnowledgeGraph3D;
