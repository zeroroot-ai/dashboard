"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Matrix palette: one hue, differentiated by brightness. Head-of-rain whites
// for "active" node types, classic phosphor for supporting ones.
const NODE_TYPES = {
  Mission:   { color: "#d4ffd4", radius: 24 }, // head-of-rain white-green — the goal
  Agent:     { color: "#00ff66", radius: 22 }, // classic matrix phosphor
  Tool:      { color: "#2ecc54", radius: 17 }, // mid phosphor
  Plugin:    { color: "#6cff8c", radius: 18 }, // bright phosphor
  Discovery: { color: "#baffc0", radius: 18 }, // pale bright green — finding
  Action:    { color: "#5cff7a", radius: 19 }, // bright phosphor
  Memory:    { color: "#3cbf5c", radius: 17 }, // deep phosphor
} as const;

type NodeType = keyof typeof NODE_TYPES;

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
  // Base anchor is the node's original radial position in its cluster. The
  // live anchor (anchorX/Y) orbits around the base each frame so the node
  // has something to chase — keeps the graph in continuous slow motion.
  baseAnchorX: number;
  baseAnchorY: number;
  anchorX: number;
  anchorY: number;
  orbitRadius: number;
  orbitSpeed: number;
  orbitPhase: number;
  type: NodeType;
  color: string;
  radius: number;
  label: string;
  opacity: number;
}

interface Edge {
  source: number;
  target: number;
  phase: number; // pulse phase 0..1 so edges don't fire in lockstep
}

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

function buildCluster(
  centerX: number,
  centerY: number,
  startId: number,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const usedLabels = new Set<string>();
  let nextId = startId;

  const addEdge = (source: number, target: number) => {
    edges.push({ source, target, phase: Math.random() });
  };

  const makeNode = (type: NodeType, dx: number, dy: number): Node => {
    const meta = NODE_TYPES[type];
    const baseX = centerX + dx;
    const baseY = centerY + dy;
    const node: Node = {
      id: nextId++,
      x: baseX + (Math.random() - 0.5) * 30,
      y: baseY + (Math.random() - 0.5) * 30,
      vx: 0,
      vy: 0,
      baseAnchorX: baseX,
      baseAnchorY: baseY,
      anchorX: baseX,
      anchorY: baseY,
      orbitRadius: 18 + Math.random() * 22, // 18–40 px drift
      orbitSpeed: 0.0025 + Math.random() * 0.003, // slow, each node different
      orbitPhase: Math.random() * Math.PI * 2,
      type,
      color: meta.color,
      radius: meta.radius,
      label: pickLabel(type, usedLabels),
      opacity: 0.82 + Math.random() * 0.18,
    };
    nodes.push(node);
    return node;
  };

  const mission = makeNode("Mission", 0, 0);

  // Single agent per cluster keeps each cluster visually coherent.
  const angle = Math.random() * Math.PI * 2;
  const agent = makeNode("Agent", Math.cos(angle) * 80, Math.sin(angle) * 80);
  addEdge(mission.id, agent.id);

  const toolCount = 1 + Math.floor(Math.random() * 2);
  for (let t = 0; t < toolCount; t++) {
    const tAngle = angle + (t - (toolCount - 1) / 2) * 0.7;
    const tool = makeNode("Tool", Math.cos(tAngle) * 150, Math.sin(tAngle) * 150);
    addEdge(agent.id, tool.id);

    const dAngle = tAngle + (Math.random() - 0.5) * 0.35;
    const discovery = makeNode("Discovery", Math.cos(dAngle) * 220, Math.sin(dAngle) * 220);
    addEdge(tool.id, discovery.id);

    const action = makeNode("Action", Math.cos(dAngle) * 285, Math.sin(dAngle) * 285);
    addEdge(discovery.id, action.id);

    const plugin = makeNode("Plugin", Math.cos(dAngle) * 345, Math.sin(dAngle) * 345 + 20);
    addEdge(action.id, plugin.id);
    addEdge(agent.id, plugin.id);
  }

  if (Math.random() < 0.6) {
    const mAngle = angle + Math.PI / 2;
    const memory = makeNode("Memory", Math.cos(mAngle) * 110, Math.sin(mAngle) * 110);
    addEdge(agent.id, memory.id);
  }

  return { nodes, edges };
}

// Distribute clusters across the full width with per-slot jitter. The hero is
// short and wide, so a jittered horizontal sweep keeps every column populated
// and avoids the vertical pile-up rejection sampling produces on this aspect.
function pickClusterCenters(width: number, height: number, count: number): { x: number; y: number }[] {
  const centers: { x: number; y: number }[] = [];
  const slotWidth = width / count;
  const xJitter = slotWidth * 0.25;
  const yBand = height * 0.55;
  const yCenter = height * 0.5;
  for (let i = 0; i < count; i++) {
    const slotCenter = slotWidth * (i + 0.5);
    const x = slotCenter + (Math.random() - 0.5) * xJitter * 2;
    const y = yCenter + (Math.random() - 0.5) * yBand;
    centers.push({ x, y });
  }
  // Shuffle y slightly so adjacent clusters rarely share a horizontal band
  for (let i = 0; i < centers.length - 1; i++) {
    if (Math.abs(centers[i].y - centers[i + 1].y) < height * 0.15) {
      centers[i + 1].y += height * 0.18 * (centers[i].y < yCenter ? 1 : -1);
    }
  }
  return centers;
}

function createGraph(width: number, height: number, clusterCount: number): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const centers = pickClusterCenters(width, height, clusterCount);
  for (const c of centers) {
    const cluster = buildCluster(c.x, c.y, nodes.length);
    nodes.push(...cluster.nodes);
    edges.push(...cluster.edges);
  }
  return { nodes, edges };
}

// Anchor-follow only: each node lerps toward a slowly orbiting anchor. The
// cluster layout already spaces nodes; skipping spring + repulsion forces
// eliminates the three-way fight that was causing drift instability.
function step(nodes: Node[], _edges: Edge[], width: number, height: number, frame: number) {
  const anchorK = 0.018;
  const damping = 0.86;
  const noise = 0.004;
  const margin = 20;

  for (const node of nodes) {
    const t = frame * node.orbitSpeed + node.orbitPhase;
    node.anchorX = node.baseAnchorX + Math.cos(t) * node.orbitRadius;
    node.anchorY = node.baseAnchorY + Math.sin(t) * node.orbitRadius;

    node.vx += (node.anchorX - node.x) * anchorK;
    node.vy += (node.anchorY - node.y) * anchorK;
    node.vx += (Math.random() - 0.5) * noise;
    node.vy += (Math.random() - 0.5) * noise;
    node.vx *= damping;
    node.vy *= damping;
    node.x += node.vx;
    node.y += node.vy;

    if (node.x < margin)          { node.x = margin;          node.vx = 0; }
    if (node.x > width - margin)  { node.x = width - margin;  node.vx = 0; }
    if (node.y < margin)          { node.y = margin;          node.vy = 0; }
    if (node.y > height - margin) { node.y = height - margin; node.vy = 0; }
  }
}

// ---------- Node glyphs ----------
// One terminal-style hex tile per node, differentiated by a single Unicode
// glyph. Keeps the whole graph reading as a mesh of code points rather than
// a menagerie of handcrafted shapes.
const NODE_GLYPHS: Record<NodeType, string> = {
  Mission:   "\u25CE", // ◎ target / command
  Agent:     "\u25C6", // ◆ worker node
  Tool:      "\u2699", // ⚙ gear
  Plugin:    "\u26A1", // ⚡ integration
  Discovery: "\u26A0", // ⚠ finding
  Action:    "\u25B6", // ▶ execute
  Memory:    "\u2261", // ≡ record / store
};

function drawIcon(ctx: CanvasRenderingContext2D, node: Node) {
  const rOuter = node.radius;
  const rInner = node.radius * 0.55;

  // Subtle phosphor wash so rings don't sit on a noisy background
  ctx.beginPath();
  ctx.arc(node.x, node.y, rOuter, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(4, 10, 7, 0.4)";
  ctx.fill();

  // Outer thin ring with phosphor bloom
  ctx.shadowColor = "#00ff66";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(node.x, node.y, rOuter, 0, Math.PI * 2);
  ctx.strokeStyle = node.color;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Inner thinner ring — reticle effect
  ctx.beginPath();
  ctx.arc(node.x, node.y, rInner, 0, Math.PI * 2);
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 0.6;
  ctx.stroke();

  // Glyph, centered, with bloom
  const glyph = NODE_GLYPHS[node.type];
  const fontSize = Math.round(node.radius * 0.9);
  ctx.font = `bold ${fontSize}px 'JetBrains Mono', 'Fira Code', ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = node.color;
  ctx.globalAlpha = 0.9;
  ctx.fillText(glyph, node.x, node.y + 1);

  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

export function GraphBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const animationRef = useRef<number>(0);
  const frameRef = useRef<number>(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  const CLUSTER_COUNT = 3;

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

    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const nodes = nodesRef.current;
    const edges = edgesRef.current;

    ctx.clearRect(0, 0, width, height);

    if (!reducedMotion) {
      frameRef.current += 1;
      step(nodes, edges, width, height, frameRef.current);
    }

    const frame = frameRef.current;

    // Edges: marching-ants dashed traces with a faint glow halo and a pulse.
    ctx.save();
    for (const edge of edges) {
      const source = nodes[edge.source];
      const target = nodes[edge.target];
      if (!source || !target) continue;

      // outer glow pass
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(0, 255, 136, 0.05)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();

      // crisp dashed line, animated
      ctx.setLineDash([5, 6]);
      ctx.lineDashOffset = -frame * 0.35;
      ctx.strokeStyle = "rgba(0, 255, 136, 0.32)";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();

      // traveling data pulse
      const t = ((frame * 0.004 + edge.phase) % 1);
      const px = source.x + (target.x - source.x) * t;
      const py = source.y + (target.y - source.y) * t;
      ctx.setLineDash([]);
      const pulse = ctx.createRadialGradient(px, py, 0, px, py, 8);
      pulse.addColorStop(0, "rgba(170, 255, 200, 0.95)");
      pulse.addColorStop(1, "rgba(0, 255, 136, 0)");
      ctx.fillStyle = pulse;
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(220, 255, 230, 0.95)";
      ctx.beginPath();
      ctx.arc(px, py, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Nodes: soft glow + thin ring + glyph + label
    for (const node of nodes) {
      // very soft outer glow — just enough to give the ring a phosphor feel
      const glow = ctx.createRadialGradient(
        node.x, node.y, node.radius * 0.4,
        node.x, node.y, node.radius * 2.2
      );
      const glowAlpha = Math.round(node.opacity * 70).toString(16).padStart(2, "0");
      glow.addColorStop(0, `${node.color}${glowAlpha}`);
      glow.addColorStop(1, `${node.color}00`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius * 2.2, 0, Math.PI * 2);
      ctx.fill();

      // thin ring + glyph
      ctx.globalAlpha = node.opacity;
      drawIcon(ctx, node);
      ctx.globalAlpha = 1;

      // label — Matrix phosphor green with bloom
      ctx.font = "bold 12px 'JetBrains Mono', 'Fira Code', monospace";
      ctx.shadowColor = "#00ff66";
      ctx.shadowBlur = 6;
      ctx.fillStyle = "#b3ffb3";
      ctx.fillText(node.label, node.x + node.radius * 1.15, node.y + 4);
      ctx.shadowBlur = 0;
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
      style={{ opacity: 0.5 }}
    />
  );
}
