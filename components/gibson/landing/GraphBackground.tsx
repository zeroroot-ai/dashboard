"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Node types representing the lifecycle of agent work — discover, decide, act, remember.
// Each color tracks a stage of the workflow so the eye can follow a mission from goal to action.
const NODE_TYPES = {
  Mission:   { color: "#ffb000", radius: 14 }, // amber — the goal
  Agent:     { color: "#ff8c00", radius: 12 }, // orange — the worker
  Tool:      { color: "#00bfff", radius: 9  }, // cyan — read-only ops
  Plugin:    { color: "#c084fc", radius: 10 }, // violet — external systems
  Discovery: { color: "#ff4444", radius: 10 }, // red — what was noticed
  Action:    { color: "#22c55e", radius: 11 }, // green — what was done
  Memory:    { color: "#2dd4bf", radius: 9  }, // teal — what's remembered
} as const;

type NodeType = keyof typeof NODE_TYPES;

// Labels reflect real cross-system workflows: an agent checks an endpoint, opens a ticket,
// merges a fix, posts to chat, and remembers the outcome. Not just security scanning.
const NODE_LABELS: Record<NodeType, string[]> = {
  Mission: [
    "fix-payment-vulns",
    "auto-triage-incidents",
    "rotate-stale-secrets",
    "onboard-new-customer",
    "weekly-compliance-sweep",
    "drift-detection",
  ],
  Agent: [
    "vuln-triager",
    "incident-responder",
    "pr-author",
    "ticket-router",
    "drift-detector",
    "auto-remediator",
    "compliance-checker",
  ],
  Tool: [
    "scan-endpoint",
    "check-tls",
    "query-graph",
    "read-config",
    "fetch-logs",
    "diff-state",
    "lint-code",
  ],
  Plugin: [
    "jira",
    "slack",
    "gitlab",
    "github",
    "servicenow",
    "salesforce",
    "datadog",
    "pagerduty",
  ],
  Discovery: [
    "expired-cert",
    "drifted-config",
    "stale-secret",
    "auth-bypass-risk",
    "outdated-dep",
    "unmonitored-route",
    "missing-runbook",
  ],
  Action: [
    "opened-INC-4471",
    "merged-PR-#218",
    "posted-#sec-alerts",
    "assigned-@oncall",
    "rotated-key",
    "deployed-fix",
    "closed-JIRA-882",
  ],
  Memory: [
    "known-false-positive",
    "approved-exception",
    "last-run-baseline",
    "cached-asset-list",
    "prior-fix-pattern",
  ],
};

interface Node {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: NodeType;
  color: string;
  radius: number;
  label: string;
  opacity: number;
}

interface Edge {
  source: number;
  target: number;
}

// Pick a random label for a given node type without repeats inside a single cluster.
function pickLabel(type: NodeType, used: Set<string>): string {
  const labels = NODE_LABELS[type];
  for (let attempt = 0; attempt < 8; attempt++) {
    const label = labels[Math.floor(Math.random() * labels.length)];
    if (!used.has(label)) {
      used.add(label);
      return label;
    }
  }
  return labels[Math.floor(Math.random() * labels.length)];
}

// Build a single mission cluster: one Mission node, 1–2 Agents, each with their own
// Tools, Plugins, Discoveries, Actions, and a shared Memory node. Returns the nodes
// and explicit semantic edges between them.
function buildCluster(
  centerX: number,
  centerY: number,
  startId: number,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const usedLabels = new Set<string>();
  let nextId = startId;

  const makeNode = (type: NodeType, dx: number, dy: number): Node => {
    const meta = NODE_TYPES[type];
    const node: Node = {
      id: nextId++,
      x: centerX + dx + (Math.random() - 0.5) * 30,
      y: centerY + dy + (Math.random() - 0.5) * 30,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      type,
      color: meta.color,
      radius: meta.radius,
      label: pickLabel(type, usedLabels),
      opacity: 0.4 + Math.random() * 0.3,
    };
    nodes.push(node);
    return node;
  };

  // Center: the Mission
  const mission = makeNode("Mission", 0, 0);

  // 1–2 Agents per mission
  const agentCount = 1 + Math.floor(Math.random() * 2);
  for (let a = 0; a < agentCount; a++) {
    const angle = (a / agentCount) * Math.PI * 2 + Math.random() * 0.5;
    const agent = makeNode("Agent", Math.cos(angle) * 70, Math.sin(angle) * 70);
    edges.push({ source: mission.id, target: agent.id });

    // Each agent uses 1–2 tools (read-only ops) — these are how it discovers things
    const toolCount = 1 + Math.floor(Math.random() * 2);
    for (let t = 0; t < toolCount; t++) {
      const tAngle = angle + (t - 0.5) * 0.6;
      const tool = makeNode("Tool", Math.cos(tAngle) * 140, Math.sin(tAngle) * 140);
      edges.push({ source: agent.id, target: tool.id });

      // Each tool produces a discovery
      const dAngle = tAngle + (Math.random() - 0.5) * 0.4;
      const discovery = makeNode("Discovery", Math.cos(dAngle) * 210, Math.sin(dAngle) * 210);
      edges.push({ source: tool.id, target: discovery.id });

      // Each discovery leads to an action
      const action = makeNode("Action", Math.cos(dAngle) * 280, Math.sin(dAngle) * 280);
      edges.push({ source: discovery.id, target: action.id });

      // The action invokes a plugin (external system)
      const plugin = makeNode("Plugin", Math.cos(dAngle) * 340, Math.sin(dAngle) * 340 + 30);
      edges.push({ source: action.id, target: plugin.id });
      // The agent has access to that plugin too — represents the policy grant
      edges.push({ source: agent.id, target: plugin.id });
    }

    // Half the agents read from memory, and one of their discoveries feeds it
    if (Math.random() < 0.6) {
      const mAngle = angle + Math.PI / 2;
      const memory = makeNode("Memory", Math.cos(mAngle) * 100, Math.sin(mAngle) * 100);
      edges.push({ source: agent.id, target: memory.id });
    }
  }

  return { nodes, edges };
}

function createGraph(width: number, height: number, clusterCount: number): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Place each mission cluster around the canvas, biased toward the center area
  for (let c = 0; c < clusterCount; c++) {
    // Distribute cluster centers across the screen with some jitter
    const cols = Math.ceil(Math.sqrt(clusterCount));
    const rows = Math.ceil(clusterCount / cols);
    const col = c % cols;
    const row = Math.floor(c / cols);
    const cellW = width / cols;
    const cellH = height / rows;
    const cx = cellW * col + cellW / 2 + (Math.random() - 0.5) * cellW * 0.3;
    const cy = cellH * row + cellH / 2 + (Math.random() - 0.5) * cellH * 0.3;

    const cluster = buildCluster(cx, cy, nodes.length);
    nodes.push(...cluster.nodes);
    edges.push(...cluster.edges);
  }

  return { nodes, edges };
}

// Apply a light spring force along edges so connected nodes attract,
// plus weak global repulsion so they don't collapse into a single point.
// Edges are stable across frames — they encode meaning, not proximity.
function step(nodes: Node[], edges: Edge[], width: number, height: number) {
  const idealEdgeLen = 110;
  const springK = 0.0008;
  const repulsionK = 90;
  const damping = 0.92;
  const margin = 30;

  // Spring forces along real edges
  for (const edge of edges) {
    const a = nodes[edge.source];
    const b = nodes[edge.target];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    const force = (dist - idealEdgeLen) * springK;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  // Weak repulsion between every pair (keeps the layout breathing)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < 1) continue;
      const dist = Math.sqrt(distSq);
      const force = repulsionK / distSq;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  // Integrate, damp, and bounce off canvas edges
  for (const node of nodes) {
    node.vx *= damping;
    node.vy *= damping;
    node.x += node.vx;
    node.y += node.vy;

    if (node.x < margin)        { node.x = margin;        node.vx *= -0.5; }
    if (node.x > width - margin){ node.x = width - margin; node.vx *= -0.5; }
    if (node.y < margin)        { node.y = margin;        node.vy *= -0.5; }
    if (node.y > height - margin){ node.y = height - margin; node.vy *= -0.5; }
  }
}

export function GraphBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const animationRef = useRef<number>(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  const CLUSTER_COUNT = 5;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Use the canvas's CSS size for layout coordinates (the context is already
    // scaled to devicePixelRatio in the resize handler).
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const nodes = nodesRef.current;
    const edges = edgesRef.current;

    ctx.clearRect(0, 0, width, height);

    if (!reducedMotion) {
      step(nodes, edges, width, height);
    }

    // Draw edges (semantic only — no distance threshold)
    for (const edge of edges) {
      const source = nodes[edge.source];
      const target = nodes[edge.target];
      if (!source || !target) continue;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = "rgba(34, 197, 94, 0.22)";
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    // Draw nodes
    for (const node of nodes) {
      // Outer glow
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius * 2.5, 0, Math.PI * 2);
      const gradient = ctx.createRadialGradient(
        node.x, node.y, 0,
        node.x, node.y, node.radius * 2.5
      );
      gradient.addColorStop(0, `${node.color}${Math.round(node.opacity * 80).toString(16).padStart(2, "0")}`);
      gradient.addColorStop(1, `${node.color}00`);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Core dot
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = `${node.color}${Math.round(node.opacity * 255).toString(16).padStart(2, "0")}`;
      ctx.fill();

      // Label next to every node
      ctx.font = "12px 'JetBrains Mono', 'Fira Code', monospace";
      ctx.fillStyle = "rgba(0, 255, 65, 0.85)";
      ctx.fillText(node.label, node.x + node.radius + 6, node.y + 4);
    }

    animationRef.current = requestAnimationFrame(draw);
  }, [reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);

      // Reinitialize the graph on resize so clusters fit the new canvas size
      const graph = createGraph(rect.width, rect.height, CLUSTER_COUNT);
      nodesRef.current = graph.nodes;
      edgesRef.current = graph.edges;
    };

    resize();
    window.addEventListener("resize", resize);
    animationRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationRef.current);
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity: 0.7 }}
    />
  );
}
