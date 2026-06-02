/**
 * EdgeRenderer: Renders graph edges with dash patterns, animations, and glow effects
 *
 * Features:
 * - Configurable dash patterns (solid, short-dash, long-dash, dot-dash)
 * - Animated dash offsets for visual flow
 * - Theme-aware glow effects (amber for dark, subtle shadow for light)
 * - Alpha transparency support
 * - Canvas state management
 */

export type DashPattern = 'solid' | 'short-dash' | 'long-dash' | 'dot-dash';

export interface EdgeOptions {
  color: string;
  dashPattern: DashPattern;
  animated: boolean;
  animationOffset?: number;
  glowEnabled: boolean;
  alpha: number;
  lineWidth: number;
}

/**
 * Dash pattern definitions in pixels
 * Format: [dash length, gap length, ...]
 */
const DASH_PATTERNS: Record<DashPattern, number[]> = {
  'solid': [],                  // No dashes
  'short-dash': [4, 4],        // 4px dash, 4px gap
  'long-dash': [12, 6],        // 12px dash, 6px gap
  'dot-dash': [2, 4, 8, 4],    // 2px dot, 4px gap, 8px dash, 4px gap
};

/**
 * Glow configuration for the single dark brand.
 * Kept subtle for clean, readable edges.
 */
const GLOW_CONFIG = {
  shadowBlur: 3,
  shadowColor: 'rgba(139, 92, 246, 0.25)',  // Very subtle brand-violet glow
};

export class EdgeRenderer {
  /**
   * Draws an edge with specified styling and effects
   *
   * @param ctx Canvas 2D rendering context
   * @param x1 Source X coordinate
   * @param y1 Source Y coordinate
   * @param x2 Target X coordinate
   * @param y2 Target Y coordinate
   * @param options Edge rendering options
   */
  drawEdge(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options: EdgeOptions
  ): void {
    // Save canvas state to restore later
    ctx.save();

    try {
      // Apply dash pattern
      const dashPattern = DASH_PATTERNS[options.dashPattern];
      ctx.setLineDash(dashPattern);

      // Apply animation offset if animated
      if (options.animated && options.animationOffset !== undefined) {
        ctx.lineDashOffset = options.animationOffset;
      } else {
        ctx.lineDashOffset = 0;
      }

      // Apply glow effect if enabled
      if (options.glowEnabled) {
        ctx.shadowBlur = GLOW_CONFIG.shadowBlur;
        ctx.shadowColor = GLOW_CONFIG.shadowColor;
      } else {
        ctx.shadowBlur = 0;
      }

      // Apply alpha to stroke color
      const strokeColor = this.applyAlpha(options.color, options.alpha);
      ctx.strokeStyle = strokeColor;

      // Set line width
      ctx.lineWidth = options.lineWidth;

      // Draw the line
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

    } finally {
      // Always restore canvas state, even if an error occurs
      ctx.restore();
    }
  }

  /**
   * Applies alpha transparency to a color
   * Handles hex colors (#rrggbb), rgb/rgba, and named colors
   *
   * @param color Color string
   * @param alpha Alpha value (0-1)
   * @returns Color string with alpha applied
   */
  private applyAlpha(color: string, alpha: number): string {
    // If already rgba, extract rgb and apply new alpha
    const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (rgbaMatch) {
      const [, r, g, b] = rgbaMatch;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // If hex color, convert to rgba
    const hexMatch = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (hexMatch) {
      const [, r, g, b] = hexMatch;
      return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${alpha})`;
    }

    // If short hex (#rgb), expand and convert
    const shortHexMatch = color.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
    if (shortHexMatch) {
      const [, r, g, b] = shortHexMatch;
      return `rgba(${parseInt(r + r, 16)}, ${parseInt(g + g, 16)}, ${parseInt(b + b, 16)}, ${alpha})`;
    }

    // For named colors or unrecognized formats, use canvas to convert
    // Create a temporary canvas element to get computed color
    if (typeof document !== 'undefined') {
      const tempCtx = document.createElement('canvas').getContext('2d');
      if (tempCtx) {
        tempCtx.fillStyle = color;
        const computedColor = tempCtx.fillStyle;
        // Recursively call with the computed color
        return this.applyAlpha(computedColor, alpha);
      }
    }

    // Fallback: return original color (best effort)
    return color;
  }
}
