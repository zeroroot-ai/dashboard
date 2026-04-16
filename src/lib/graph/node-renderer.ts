/**
 * Node Renderer Module
 *
 * Renders knowledge-graph entity nodes as rounded-rectangle "chips" with
 * Lucide stroke icons. Replaces the previous circle+Phosphor-duotone approach.
 *
 * Visual design:
 *  - Rounded rect background filled with a category-specific dark colour
 *  - Lucide icon centred inside, rendered as a stroke (lineCap/lineJoin: round)
 *  - Thin border by default; coloured + glowing border on hover/select
 *  - Optional left-edge severity stripe on `finding` nodes
 *  - Active nodes pulse the border opacity via a sine wave
 */

import { ENTITY_ICON_MAP, EntityType, LucideIconDefinition } from './lucide-icon-paths';

// ---------------------------------------------------------------------------
// Path2D cache
// ---------------------------------------------------------------------------

/**
 * Cache of parsed Path2D arrays, keyed by entity type.
 * Avoids re-parsing path strings every animation frame.
 */
const pathCache = new Map<string, Path2D[]>();

/**
 * Get (or build and store) the Path2D array for a given icon definition.
 */
function getCachedPaths(entityType: EntityType, def: LucideIconDefinition): Path2D[] {
  let cached = pathCache.get(entityType);
  if (!cached) {
    cached = def.paths.map((d) => new Path2D(d));
    pathCache.set(entityType, cached);
  }
  return cached;
}

// ---------------------------------------------------------------------------
// Node size tiers
// ---------------------------------------------------------------------------

/**
 * Default half-size (radius equivalent) for each entity type.
 * The value is the full square side length in logical pixels.
 *
 * Tier 1 (64px) — primary entities: mission, domain, host, finding
 * Tier 2 (52px) — secondary entities: mission_run, agent_run, service
 * Tier 3 (46px) — detail entities: subdomain, technology, technique
 * Tier 4 (38px) — operational entities: tool_execution, llm_call, port
 * Tier 5 (34px) — leaf entities: endpoint, certificate, evidence
 */
export const NODE_SIZES: Record<EntityType, number> = {
  mission:        64,
  domain:         64,
  host:           64,
  finding:        64,
  mission_run:    52,
  agent_run:      52,
  service:        52,
  subdomain:      46,
  technology:     46,
  technique:      46,
  tool_execution: 38,
  llm_call:       38,
  port:           38,
  endpoint:       34,
  certificate:    34,
  evidence:       34,
};

// ---------------------------------------------------------------------------
// Category colours (dark-theme backgrounds)
// ---------------------------------------------------------------------------

/**
 * Background fill colours for each category, designed for a dark terminal
 * aesthetic. These are intentionally darker than the icon stroke colour so
 * the icon remains the focal point.
 */
export const CATEGORY_COLORS: Record<string, string> = {
  execution:      '#166534',  // green-800  — mission / runs / calls
  dns:            '#1e3a5f',  // blue-900   — domain / subdomain
  infrastructure: '#134e4a',  // teal-900   — host / port / service
  technical:      '#164e63',  // cyan-900   — endpoint / technology / certificate
  security:       '#7f1d1d',  // red-900    — finding / evidence / technique
};

/** Maps each entity type to its visual category. */
function getCategory(type: EntityType): string {
  switch (type) {
    case 'mission':
    case 'mission_run':
    case 'agent_run':
    case 'tool_execution':
    case 'llm_call':
      return 'execution';

    case 'domain':
    case 'subdomain':
      return 'dns';

    case 'host':
    case 'port':
    case 'service':
      return 'infrastructure';

    case 'endpoint':
    case 'technology':
    case 'certificate':
      return 'technical';

    case 'finding':
    case 'evidence':
    case 'technique':
      return 'security';

    default:
      return 'infrastructure';
  }
}

// ---------------------------------------------------------------------------
// Severity colours
// ---------------------------------------------------------------------------

const SEVERITY_COLORS = {
  critical: '#ef4444',  // red-500
  high:     '#f97316',  // orange-500
  medium:   '#eab308',  // yellow-500
  low:      '#22c55e',  // green-500
  info:     '#6b7280',  // gray-500
} as const;

// ---------------------------------------------------------------------------
// Helper: rounded rectangle path
// ---------------------------------------------------------------------------

/**
 * Traces a rounded-rectangle path on `ctx`.
 * Caller is responsible for calling fill() or stroke() afterwards.
 *
 * @param ctx - Canvas 2D context
 * @param x   - Top-left X
 * @param y   - Top-left Y
 * @param w   - Width
 * @param h   - Height
 * @param r   - Corner radius
 */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Helper: hex → {r,g,b}
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface NodeOptions {
  /** Base colour used for the border and glow (hex string) */
  color: string;
  /** Overall opacity multiplier, 0–1 (default 1.0) */
  alpha?: number;
  /** Hovered state: thicker green border + subtle glow */
  isHovered?: boolean;
  /** Selected state: solid green border */
  isSelected?: boolean;
  /** Active / running state: pulsing border opacity */
  isActive?: boolean;
  /** Current animation phase for the pulse, 0–1 */
  pulsePhase?: number;
  /** Severity level — draws a coloured left-edge stripe on `finding` nodes */
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  /** Glow quality multiplier, 0.5–1.0 (default 1.0). Lower = cheaper blur. */
  glowQuality?: number;
}

// ---------------------------------------------------------------------------
// NodeRenderer
// ---------------------------------------------------------------------------

export class NodeRenderer {
  /** Minimum node side length before switching to a plain filled square */
  private readonly fallbackSize = 8;

  /**
   * Draw a single entity node centred at (x, y).
   *
   * @param ctx        - Canvas 2D rendering context
   * @param entityType - Gibson taxonomy entity type
   * @param x          - Centre X in canvas coordinates
   * @param y          - Centre Y in canvas coordinates
   * @param size       - Side length of the square in logical pixels
   * @param options    - Visual options
   */
  drawNode(
    ctx: CanvasRenderingContext2D,
    entityType: EntityType,
    x: number,
    y: number,
    size: number,
    options: NodeOptions,
  ): void {
    const {
      color,
      alpha = 1.0,
      isHovered = false,
      isSelected = false,
      isActive = false,
      pulsePhase = 0,
      severity,
      glowQuality = 1.0,
    } = options;

    ctx.save();

    try {
      // Expand slightly on hover
      const effectiveSize = isHovered ? size * 1.15 : size;

      // Use plain square fallback for very small nodes
      if (effectiveSize < this.fallbackSize) {
        this.drawFallback(ctx, x, y, effectiveSize, color, alpha);
        return;
      }

      const half = effectiveSize / 2;
      const left = x - half;
      const top  = y - half;
      const radius = effectiveSize * 0.2; // corner radius

      // ------------------------------------------------------------------
      // 1. Background rounded-rect
      // ------------------------------------------------------------------
      const category = getCategory(entityType);
      const bgColor  = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.infrastructure;
      const bgAlpha  = 0.85 * alpha;

      roundedRect(ctx, left, top, effectiveSize, effectiveSize, radius);
      ctx.fillStyle = hexToRgba(bgColor, bgAlpha);
      ctx.fill();

      // ------------------------------------------------------------------
      // 2. Severity stripe (left edge, findings only)
      // ------------------------------------------------------------------
      if (severity && entityType === 'finding') {
        const stripeWidth = Math.max(3, effectiveSize * 0.08);
        const stripeColor = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.info;

        ctx.save();
        // Clip to the node shape so the stripe respects rounded corners
        roundedRect(ctx, left, top, effectiveSize, effectiveSize, radius);
        ctx.clip();

        ctx.fillStyle = hexToRgba(stripeColor, alpha);
        ctx.fillRect(left, top, stripeWidth, effectiveSize);
        ctx.restore();
      }

      // ------------------------------------------------------------------
      // 3. Lucide icon (stroke-based)
      // ------------------------------------------------------------------
      const iconDef = ENTITY_ICON_MAP[entityType];
      if (iconDef) {
        this.drawIcon(ctx, entityType, iconDef, x, y, effectiveSize, alpha);
      }

      // ------------------------------------------------------------------
      // 4. Border
      // ------------------------------------------------------------------
      this.drawBorder(ctx, left, top, effectiveSize, radius, color, alpha, {
        isHovered,
        isSelected,
        isActive,
        pulsePhase,
        glowQuality,
      });
    } finally {
      ctx.restore();
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Draw the Lucide stroke icon centred at (cx, cy). */
  private drawIcon(
    ctx: CanvasRenderingContext2D,
    entityType: EntityType,
    def: LucideIconDefinition,
    cx: number,
    cy: number,
    nodeSize: number,
    alpha: number,
  ): void {
    const iconSize   = nodeSize * 0.55;
    const scale      = iconSize / def.viewBox;
    const iconLeft   = cx - iconSize / 2;
    const iconTop    = cy - iconSize / 2;

    const paths = getCachedPaths(entityType, def);

    ctx.save();

    // Position and scale the 24×24 viewBox to iconSize
    ctx.translate(iconLeft, iconTop);
    ctx.scale(scale, scale);

    // Lucide style: round caps and joins, stroke only
    ctx.strokeStyle  = `rgba(226,232,240,${alpha})`; // slate-200
    ctx.lineWidth    = def.strokeWidth / scale;        // keep apparent width constant
    ctx.lineCap      = 'round';
    ctx.lineJoin     = 'round';
    ctx.fillStyle    = 'transparent';

    for (const p of paths) {
      ctx.beginPath();
      ctx.stroke(p);
    }

    ctx.restore();
  }

  /** Draw the node border with state-dependent styling. */
  private drawBorder(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    size: number,
    radius: number,
    color: string,
    alpha: number,
    state: {
      isHovered:    boolean;
      isSelected:   boolean;
      isActive:     boolean;
      pulsePhase:   number;
      glowQuality:  number;
    },
  ): void {
    const { isHovered, isSelected, isActive, pulsePhase, glowQuality } = state;

    const GREEN = '#00ff41';

    if (isHovered) {
      // Thicker green border + shadow glow
      const blurRadius = Math.max(4, size * 0.3 * glowQuality);
      ctx.shadowColor  = hexToRgba(GREEN, 0.6 * alpha);
      ctx.shadowBlur   = blurRadius;
      roundedRect(ctx, left, top, size, size, radius);
      ctx.strokeStyle = hexToRgba(GREEN, alpha);
      ctx.lineWidth   = 2;
      ctx.stroke();
      ctx.shadowBlur  = 0;
      ctx.shadowColor = 'transparent';
      return;
    }

    if (isSelected) {
      // Solid green border, no glow
      roundedRect(ctx, left, top, size, size, radius);
      ctx.strokeStyle = hexToRgba(GREEN, alpha);
      ctx.lineWidth   = 2;
      ctx.stroke();
      return;
    }

    if (isActive) {
      // Pulsing border opacity — sine wave between 0.3 and 1.0
      const pulse = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(pulsePhase * Math.PI * 2));
      roundedRect(ctx, left, top, size, size, radius);
      ctx.strokeStyle = hexToRgba(color, pulse * alpha);
      ctx.lineWidth   = 1.5;
      ctx.stroke();
      return;
    }

    // Default: subtle 1px border at low opacity
    roundedRect(ctx, left, top, size, size, radius);
    ctx.strokeStyle = hexToRgba(color, 0.35 * alpha);
    ctx.lineWidth   = 1;
    ctx.stroke();
  }

  /** Minimal fallback for very small nodes — just a filled rounded rect. */
  private drawFallback(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    size: number,
    color: string,
    alpha: number,
  ): void {
    const half   = size / 2;
    const radius = size * 0.2;

    roundedRect(ctx, cx - half, cy - half, size, size, radius);
    ctx.fillStyle = hexToRgba(color, alpha * 0.8);
    ctx.fill();
  }
}

// Export singleton for convenience
export const nodeRenderer = new NodeRenderer();
