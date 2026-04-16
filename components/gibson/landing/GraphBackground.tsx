"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// Old-school CRT palette: P1 green phosphor + IBM 5151 amber. Two hues only —
// types differentiate by brightness rather than by bringing in foreign colors.
const NODE_TYPES = {
  Mission:   { color: "#ffb000", radius: 16 }, // amber — the goal (primary)
  Agent:     { color: "#00ff41", radius: 14 }, // phosphor green — the worker
  Tool:      { color: "#33cc44", radius: 11 }, // dim green — read-only ops
  Plugin:    { color: "#33ddff", radius: 12 }, // phosphor cyan — external systems
  Discovery: { color: "#ffd700", radius: 12 }, // bright amber — warnings
  Action:    { color: "#66ff77", radius: 13 }, // bright green — what was done
  Memory:    { color: "#88cc66", radius: 11 }, // olive-green — stored state
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

  const agentCount = 1 + Math.floor(Math.random() * 2);
  for (let a = 0; a < agentCount; a++) {
    const angle = (a / agentCount) * Math.PI * 2 + Math.random() * 0.5;
    const agent = makeNode("Agent", Math.cos(angle) * 90, Math.sin(angle) * 90);
    addEdge(mission.id, agent.id);

    const toolCount = 1 + Math.floor(Math.random() * 2);
    for (let t = 0; t < toolCount; t++) {
      const tAngle = angle + (t - 0.5) * 0.6;
      const tool = makeNode("Tool", Math.cos(tAngle) * 175, Math.sin(tAngle) * 175);
      addEdge(agent.id, tool.id);

      const dAngle = tAngle + (Math.random() - 0.5) * 0.4;
      const discovery = makeNode("Discovery", Math.cos(dAngle) * 260, Math.sin(dAngle) * 260);
      addEdge(tool.id, discovery.id);

      const action = makeNode("Action", Math.cos(dAngle) * 345, Math.sin(dAngle) * 345);
      addEdge(discovery.id, action.id);

      const plugin = makeNode("Plugin", Math.cos(dAngle) * 420, Math.sin(dAngle) * 420 + 30);
      addEdge(action.id, plugin.id);
      addEdge(agent.id, plugin.id);
    }

    if (Math.random() < 0.6) {
      const mAngle = angle + Math.PI / 2;
      const memory = makeNode("Memory", Math.cos(mAngle) * 125, Math.sin(mAngle) * 125);
      addEdge(agent.id, memory.id);
    }
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

// Each node chases a slowly orbiting anchor. Anchor orbit supplies continuous
// motion; spring + edge forces keep the structure coherent; low damping +
// small noise smooth it out. No settling, no pinballing.
function step(nodes: Node[], edges: Edge[], width: number, height: number, frame: number) {
  const idealEdgeLen = 145;
  const springK = 0.0005;
  const repulsionK = 90;
  const anchorK = 0.0025;
  const damping = 0.965;
  const noise = 0.01;
  const velocityCap = 0.7;
  const margin = 30;

  // Move each anchor along its slow orbit so nodes always have a moving target.
  for (const node of nodes) {
    const t = frame * node.orbitSpeed + node.orbitPhase;
    node.anchorX = node.baseAnchorX + Math.cos(t) * node.orbitRadius;
    node.anchorY = node.baseAnchorY + Math.sin(t) * node.orbitRadius;
  }

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

  for (const node of nodes) {
    node.vx += (node.anchorX - node.x) * anchorK;
    node.vy += (node.anchorY - node.y) * anchorK;
    node.vx += (Math.random() - 0.5) * noise;
    node.vy += (Math.random() - 0.5) * noise;
    node.vx *= damping;
    node.vy *= damping;
    // Cap velocity so nodes never pinball even if forces spike
    const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
    if (speed > velocityCap) {
      const s = velocityCap / speed;
      node.vx *= s;
      node.vy *= s;
    }
    node.x += node.vx;
    node.y += node.vy;

    if (node.x < margin)         { node.x = margin;         node.vx = Math.abs(node.vx) * 0.6; }
    if (node.x > width - margin) { node.x = width - margin; node.vx = -Math.abs(node.vx) * 0.6; }
    if (node.y < margin)         { node.y = margin;         node.vy = Math.abs(node.vy) * 0.6; }
    if (node.y > height - margin){ node.y = height - margin; node.vy = -Math.abs(node.vy) * 0.6; }
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
  const r = node.radius * 1.25;
  // dark phosphor backdrop
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(6, 12, 8, 0.92)";
  ctx.fill();
  // neon ring
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = node.color;
  ctx.lineWidth = 1.8;
  ctx.stroke();
  // glyph in phosphor color
  const glyph = NODE_GLYPHS[node.type];
  const fontSize = Math.round(node.radius * 1.5);
  ctx.font = `bold ${fontSize}px 'JetBrains Mono', 'Fira Code', ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = node.color;
  ctx.fillText(glyph, node.x, node.y + 1);
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
      ctx.strokeStyle = "rgba(0, 255, 136, 0.08)";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();

      // crisp dashed line, animated
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -frame * 0.35;
      ctx.strokeStyle = "rgba(0, 255, 136, 0.42)";
      ctx.lineWidth = 1.1;
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

    // Nodes: colored glow + drawn glyph + label
    for (const node of nodes) {
      // outer glow
      const glow = ctx.createRadialGradient(
        node.x, node.y, 0,
        node.x, node.y, node.radius * 2.8
      );
      const glowAlpha = Math.round(node.opacity * 170).toString(16).padStart(2, "0");
      glow.addColorStop(0, `${node.color}${glowAlpha}`);
      glow.addColorStop(1, `${node.color}00`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius * 2.8, 0, Math.PI * 2);
      ctx.fill();

      // hex tile + glyph
      ctx.globalAlpha = node.opacity;
      drawIcon(ctx, node);
      ctx.globalAlpha = 1;

      // label
      ctx.font = "12px 'JetBrains Mono', 'Fira Code', monospace";
      ctx.fillStyle = "rgba(0, 255, 80, 0.9)";
      ctx.fillText(node.label, node.x + node.radius * 1.6, node.y + 4);
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
