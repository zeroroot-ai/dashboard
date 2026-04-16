/**
 * Icon Renderer Module
 *
 * Renders entity-specific icons on Canvas with visual effects including:
 * - Color fill and glow effects
 * - Hover state (enlarged size and enhanced glow)
 * - Active state (pulsing glow)
 * - Graceful degradation to simple circle at small sizes
 */

import { ICON_PATHS, DuotoneIconDefinition } from './icon-paths';

// Cache for parsed Path2D objects to avoid re-parsing every frame
const pathCache: Map<string, { background: Path2D; foreground: Path2D }> = new Map();

/**
 * Parse SVG path string into a Path2D object
 */
function parseSvgPath(pathData: string): Path2D {
  return new Path2D(pathData);
}

/**
 * Get or create cached Path2D objects for an icon definition
 */
function getCachedPaths(
  entityType: string,
  iconDef: DuotoneIconDefinition
): { background: Path2D; foreground: Path2D } {
  let cached = pathCache.get(entityType);
  if (!cached) {
    cached = {
      background: parseSvgPath(iconDef.background),
      foreground: parseSvgPath(iconDef.foreground),
    };
    pathCache.set(entityType, cached);
  }
  return cached;
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

export interface IconOptions {
  /** Base color for the icon */
  color: string;
  /** Color for the glow effect (defaults to color if not specified) */
  glowColor?: string;
  /** Intensity of the glow effect (0-1, default 0.7) */
  glowIntensity?: number;
  /** Overall opacity (0-1, default 1.0) */
  alpha?: number;
  /** Whether the icon is being hovered (triggers size increase and glow enhancement) */
  isHovered?: boolean;
  /** Whether the icon is in active state (triggers pulsing effect) */
  isActive?: boolean;
  /** Phase of the pulse animation (0-1, used with isActive) */
  pulsePhase?: number;
  /** Quality multiplier for glow blur radius (0.5-1.0, default 1.0) - used for performance optimization */
  glowQuality?: number;
}

/**
 * Converts hex color to rgba string with specified alpha
 */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Extracts RGB values from a color string (hex or rgba)
 */
function parseColor(color: string): { r: number; g: number; b: number } | null {
  // Handle hex colors
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return { r, g, b };
  }

  // Handle rgba colors
  const rgbaMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]),
      g: parseInt(rgbaMatch[2]),
      b: parseInt(rgbaMatch[3]),
    };
  }

  return null;
}

/**
 * IconRenderer class handles rendering of entity-specific icons on Canvas
 * with visual effects including glow, hover states, and pulsing animations.
 */
export class IconRenderer {
  private fallbackSize = 6; // Size threshold below which we use simple circle fallback

  /**
   * Draws an entity icon at the specified position with visual effects
   *
   * @param ctx - Canvas 2D rendering context
   * @param entityType - Type of entity to render
   * @param x - X coordinate of icon center
   * @param y - Y coordinate of icon center
   * @param size - Base size of the icon (diameter)
   * @param options - Visual options for rendering
   */
  drawIcon(
    ctx: CanvasRenderingContext2D,
    entityType: EntityType,
    x: number,
    y: number,
    size: number,
    options: IconOptions
  ): void {
    const {
      color,
      glowColor = color,
      glowIntensity = 0.7,
      alpha = 1.0,
      isHovered = false,
      isActive = false,
      pulsePhase = 0,
      glowQuality = 1.0,
    } = options;

    // Save context state to avoid leaking settings
    ctx.save();

    try {
      // Calculate effective size with hover enhancement
      let effectiveSize = size;
      if (isHovered) {
        effectiveSize *= 1.2; // 20% size increase on hover
      }

      // Calculate pulse effect for active state
      let pulseMultiplier = 1.0;
      if (isActive && pulsePhase !== undefined) {
        // Sine wave oscillation from 0.8 to 1.2 based on pulsePhase (0-1)
        pulseMultiplier = 1.0 + 0.2 * Math.sin(pulsePhase * Math.PI * 2);
      }

      // Fallback to simple circle for very small sizes
      if (effectiveSize < this.fallbackSize) {
        this.drawFallbackCircle(ctx, x, y, effectiveSize, color, alpha);
        return;
      }

      // Calculate glow properties
      const baseGlowIntensity = isHovered ? glowIntensity * 1.5 : glowIntensity;
      const effectiveGlowIntensity = isActive
        ? baseGlowIntensity * pulseMultiplier
        : baseGlowIntensity;

      // Apply glow effect
      if (effectiveGlowIntensity > 0) {
        this.applyGlow(ctx, glowColor, effectiveSize, effectiveGlowIntensity, glowQuality);
      }

      // Draw the icon
      if (ICON_PATHS && ICON_PATHS[entityType]) {
        this.drawVectorIcon(ctx, entityType, x, y, effectiveSize, color, alpha);
      } else {
        // Fallback if icon paths not loaded
        this.drawFallbackCircle(ctx, x, y, effectiveSize, color, alpha);
      }
    } finally {
      // Restore context state
      ctx.restore();
    }
  }

  /**
   * Draws a duotone vector icon from the Phosphor icon paths
   *
   * Duotone icons have two layers:
   * - Background: rendered at 20% opacity for the filled areas
   * - Foreground: rendered at full opacity for the outlines and details
   */
  private drawVectorIcon(
    ctx: CanvasRenderingContext2D,
    entityType: EntityType,
    x: number,
    y: number,
    size: number,
    color: string,
    alpha: number
  ): void {
    if (!ICON_PATHS || !ICON_PATHS[entityType]) return;

    const iconDef = ICON_PATHS[entityType];
    const paths = getCachedPaths(entityType, iconDef);

    // Parse color for rgba construction
    const rgb = parseColor(color);
    if (!rgb) return;

    // Calculate scale factor from 256x256 viewBox to desired size
    const scale = size / iconDef.viewBox;

    ctx.save();

    // Position icon centered at (x, y)
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(scale, scale);

    // Draw background layer at 20% opacity (the filled duotone area)
    ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha * 0.2})`;
    ctx.fill(paths.background);

    // Draw foreground layer at full opacity (the outlines and details)
    ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
    ctx.fill(paths.foreground);

    ctx.restore();
  }

  /**
   * Draws a simple filled circle as fallback for small sizes or missing icons
   */
  private drawFallbackCircle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string,
    alpha: number
  ): void {
    const radius = size / 2;

    // Parse color to apply alpha
    const rgb = parseColor(color);
    if (rgb) {
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
    } else {
      ctx.fillStyle = color;
      ctx.globalAlpha *= alpha;
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Applies glow effect using shadow blur
   */
  private applyGlow(
    ctx: CanvasRenderingContext2D,
    glowColor: string,
    size: number,
    intensity: number,
    quality: number = 1.0
  ): void {
    // Glow blur scales with size and quality (quality reduces blur radius for performance)
    const blurRadius = Math.max(2, size * 0.5 * intensity * quality);

    // Parse glow color
    const rgb = parseColor(glowColor);
    if (rgb) {
      // Apply glow with intensity-based alpha
      ctx.shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${intensity})`;
    } else {
      ctx.shadowColor = glowColor;
    }

    ctx.shadowBlur = blurRadius;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  /**
   * Checks if an icon exists for a specific entity type
   */
  hasIcon(entityType: EntityType): boolean {
    return !!(ICON_PATHS && ICON_PATHS[entityType]);
  }

  /**
   * Checks if icon paths are loaded
   */
  isIconPathsLoaded(): boolean {
    return ICON_PATHS !== null;
  }

  /**
   * Returns the parsed Path2D for a given entity type, or null if not available.
   *
   * @param entityType - The entity type to get the path for
   */
  getIconPath(entityType: EntityType): Path2D | null {
    if (!ICON_PATHS || !ICON_PATHS[entityType]) return null;
    const iconDef = ICON_PATHS[entityType];
    const cached = getCachedPaths(entityType, iconDef);
    return cached?.foreground ?? null;
  }
}

// Export a singleton instance for convenience
export const iconRenderer = new IconRenderer();
