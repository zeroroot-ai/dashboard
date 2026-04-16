/**
 * Lucide Icon Path Data for Knowledge Graph Entity Nodes
 *
 * Extracted from lucide-react v0.522.0 (ISC license).
 * Each icon is defined as an array of SVG path `d` attribute strings,
 * ready for use with Canvas Path2D. Primitive shapes (circle, line, rect,
 * polygon, polyline) are converted to equivalent path commands so that
 * a single Path2D array covers every element in the icon.
 *
 * All icons use a 24x24 viewBox and are rendered with stroke, not fill,
 * matching Lucide's visual style.
 */

export interface LucideIconDefinition {
  /** Array of SVG path 'd' attributes — one entry per path element */
  paths: string[];
  /** ViewBox size (always 24 for Lucide icons) */
  viewBox: number;
  /** Default stroke width used by Lucide */
  strokeWidth: number;
}

export type EntityType =
  | 'mission'
  | 'mission_run'
  | 'agent_run'
  | 'tool_execution'
  | 'llm_call'
  | 'domain'
  | 'subdomain'
  | 'host'
  | 'port'
  | 'service'
  | 'endpoint'
  | 'technology'
  | 'certificate'
  | 'finding'
  | 'evidence'
  | 'technique';

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------
// These convert Lucide primitive SVG elements to equivalent path `d` strings.

/**
 * Circle → approximate cubic-bezier path (standard SVG arc approximation).
 * Uses two half-arcs so the result is a closed path.
 */
function circlePath(cx: number, cy: number, r: number): string {
  // Two arc commands (top half + bottom half) to form a full circle.
  return (
    `M ${cx - r} ${cy} ` +
    `A ${r} ${r} 0 1 0 ${cx + r} ${cy} ` +
    `A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`
  );
}

/**
 * Line → path M…L.
 */
function linePath(x1: number, y1: number, x2: number, y2: number): string {
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

/**
 * Rect (optionally rounded) → path with optional quadratic-curve corners.
 */
function rectPath(x: number, y: number, w: number, h: number, rx: number = 0): string {
  if (rx === 0) {
    return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
  }
  const r = Math.min(rx, w / 2, h / 2);
  return (
    `M ${x + r} ${y} ` +
    `L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} ` +
    `L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} ` +
    `L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} ` +
    `L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`
  );
}

/**
 * Polygon → path built from a space/comma-separated points string.
 */
function polygonPath(points: string): string {
  const pairs = points.trim().split(/\s+/);
  return pairs
    .map((pair, i) => {
      const [px, py] = pair.split(',');
      return `${i === 0 ? 'M' : 'L'} ${px} ${py}`;
    })
    .join(' ') + ' Z';
}

// ---------------------------------------------------------------------------
// Icon definitions
// ---------------------------------------------------------------------------

export const ENTITY_ICON_MAP: Record<EntityType, LucideIconDefinition> = {
  // MISSION: Crosshair icon
  // Source: lucide-react/dist/esm/icons/crosshair.js
  // Elements: circle(12,12,10), line(22→18,12), line(6→2,12), line(12,6→2), line(12,22→18)
  mission: {
    paths: [
      circlePath(12, 12, 10),
      linePath(22, 12, 18, 12),
      linePath(6, 12, 2, 12),
      linePath(12, 6, 12, 2),
      linePath(12, 22, 12, 18),
    ],
    viewBox: 24,
    strokeWidth: 2,
  },

  // MISSION_RUN: Play icon
  // Source: lucide-react/dist/esm/icons/play.js
  // Elements: polygon("6 3 20 12 6 21 6 3")
  mission_run: {
    paths: [
      polygonPath('6,3 20,12 6,21 6,3'),
    ],
    viewBox: 24,
    strokeWidth: 2,
  },

  // AGENT_RUN: Bot icon
  // Source: lucide-react/dist/esm/icons/bot.js
  // Elements: path, rect(16×12 at 4,8 rx2), path×4
  agent_run: {
    paths: [
      'M12 8V4H8',
      rectPath(4, 8, 16, 12, 2),
      'M2 14h2',
      'M20 14h2',
      'M15 13v2',
      'M9 13v2',
    ],
    viewBox: 24,
    strokeWidth: 2,
  },

  // TOOL_EXECUTION: Zap icon
  // Source: lucide-react/dist/esm/icons/zap.js
  // Elements: path
  tool_execution: {
    paths: [
      'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z',
    ],
    viewBox: 24,
    strokeWidth: 2,
  },

  // LLM_CALL: Sparkles icon
  // Source: lucide-react/dist/esm/icons/sparkles.js
  // Elements: path (star), path×4 (accent lines)
  llm_call: {
    paths: [
      'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
      'M20 3v4',
      'M22 5h-4',
      'M4 17v2',
      'M5 18H3',
    ],
    viewBox: 24,
    strokeWidth: 2,
  },

  // DOMAIN: Globe icon
  // Source: lucide-react/dist/esm/icons/globe.js
  // Elements: circle(12,12,10), path (meridian), path (equator)
  domain: {
    paths: [
      circlePath(12, 12, 10),
      'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20',
      'M2 12h20',
    ],
    viewBox: 24,
    strokeWidth: 2,
  },

  // SUBDOMAIN: GitBranch icon
  // Source: lucide-react/dist/esm/icons/git-branch.js
  // Elements: line(6,3→6,15), circle(18,6,3), circle(6,18,3), path (curve)
  subdomain: {
    paths: [
      linePath(6, 3, 6, 15),
      circlePath(18, 6, 3),
      circlePath(6, 18, 3),
      'M18 9a9 9 0 0 1-9 9',
    ],
    viewBox: 24,
    strokeWidth: 2,
  },

  // HOST: Server icon
  // Source: lucide-react/dist/esm/icons/server.js
  // Elements: rect(20×8 at 2,2 rx2), rect(20×8 at 2,14 rx2), line×2 (indicator dots)
  host: {
    paths: [
      rectPath(2, 2, 20, 8, 2),
      rectPath(2, 14, 20, 8, 2),
      linePath(6, 6, 6.01, 6),
      linePath(6, 18, 6.01, 18),
    ],
    viewBox: 24,
    strokeWidth: 2,
  },

  // PORT: Plug icon
  // Source: lucide-react/dist/esm/icons/plug.js
  // Elements: path×4
  port: {
    paths: [
      'M12 22v-5',
      'M9 8V2',
      'M15 8V2',
      'M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z',
    ],
    viewBox: 24,
    strokeWidth: 2,
  },

  // SERVICE: Hexagon icon
  // Source: lucide-react/dist/esm/icons/hexagon.js
  // Elements: path
  service: {
    paths: [
      'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z',
    ],
    viewBox: 24,
    strokeWidth: 2,
  },

  // ENDPOINT: Route icon
  // Source: lucide-react/dist/esm/icons/route.js
  // Elements: circle(6,19,3), path (S-curve), circle(18,5,3)
  endpoint: {
    paths: [
      circlePath(6, 19, 3),
      'M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15',
      circlePath(18, 5, 3),
    ],
    viewBox: 24,
    strokeWidth: 2,
  },

  // TECHNOLOGY: Cpu icon
  // Source: lucide-react/dist/esm/icons/cpu.js
  // Elements: path×12 (pins), rect(16×16 at 4,4 rx2), rect(8×8 at 8,8 rx1)
  technology: {
    paths: [
      'M12 20v2',
      'M12 2v2',
      'M17 20v2',
      'M17 2v2',
      'M2 12h2',
      'M2 17h2',
      'M2 7h2',
      'M20 12h2',
      'M20 17h2',
      'M20 7h2',
      'M7 20v2',
      'M7 2v2',
      rectPath(4, 4, 16, 16, 2),
      rectPath(8, 8, 8, 8, 1),
    ],
    viewBox: 24,
    strokeWidth: 2,
  },

  // CERTIFICATE: ShieldCheck icon
  // Source: lucide-react/dist/esm/icons/shield-check.js
  // Elements: path (shield), path (checkmark)
  certificate: {
    paths: [
      'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
      'M9 12l2 2 4-4',
    ],
    viewBox: 24,
    strokeWidth: 2,
  },

  // FINDING: TriangleAlert icon (exported as alert-triangle in lucide-react)
  // Source: lucide-react/dist/esm/icons/triangle-alert.js
  // Elements: path (triangle), path (exclamation line), path (exclamation dot)
  finding: {
    paths: [
      'M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
      'M12 9v4',
      'M12 17h.01',
    ],
    viewBox: 24,
    strokeWidth: 2,
  },

  // EVIDENCE: FileSearch icon
  // Source: lucide-react/dist/esm/icons/file-search.js
  // Elements: path (fold line), path (file outline), path (magnifier handle), circle(5,14,3)
  evidence: {
    paths: [
      'M14 2v4a2 2 0 0 0 2 2h4',
      'M4.268 21a2 2 0 0 0 1.727 1H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3',
      'M9 18l-1.5-1.5',
      circlePath(5, 14, 3),
    ],
    viewBox: 24,
    strokeWidth: 2,
  },

  // TECHNIQUE: Skull icon
  // Source: lucide-react/dist/esm/icons/skull.js
  // Elements: path (chin notch), path (skull outline), circle(15,12,1), circle(9,12,1)
  technique: {
    paths: [
      'M12.5 17l-.5-1-.5 1h1z',
      'M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z',
      circlePath(15, 12, 1),
      circlePath(9, 12, 1),
    ],
    viewBox: 24,
    strokeWidth: 2,
  },
};
