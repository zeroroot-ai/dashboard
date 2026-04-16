/**
 * ParticleSystem - High-performance particle effects for graph edges
 *
 * Features:
 * - Object pooling for efficient particle reuse
 * - Configurable density and spawn rates
 * - Smooth particle flow along edges with proper interpolation
 * - Subtle glow effects for visual polish
 * - Automatic lifecycle management (spawn, update, recycle)
 */

interface Particle {
  active: boolean;
  edgeId: string;
  progress: number;  // 0-1 position along edge
  speed: number;     // progress per second
  size: number;
  alpha: number;
  color: string;
}

interface EdgeEndpoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export class ParticleSystem {
  private pool: Particle[] = [];
  private activeEdges: Map<string, EdgeEndpoints> = new Map();
  private maxParticles: number;
  private density: number = 0.5;
  private spawnAccumulator: Map<string, number> = new Map();

  // Particle appearance settings
  private readonly MIN_SIZE = 2;
  private readonly MAX_SIZE = 4;
  private readonly MIN_SPEED = 0.15;  // 15% of edge per second
  private readonly MAX_SPEED = 0.35;  // 35% of edge per second
  private readonly BASE_ALPHA = 0.7;
  private readonly FADE_DURATION = 0.15; // 15% of progress for fade in/out

  constructor(maxParticles: number = 200) {
    this.maxParticles = maxParticles;
    this.initializePool();
  }

  /**
   * Pre-allocate particle objects for reuse
   */
  private initializePool(): void {
    this.pool = [];
    for (let i = 0; i < this.maxParticles; i++) {
      this.pool.push({
        active: false,
        edgeId: '',
        progress: 0,
        speed: 0,
        size: 0,
        alpha: 0,
        color: '#ffffff',
      });
    }
  }

  /**
   * Set particle density (affects spawn rate)
   * @param density - Value between 0.1 and 1.0
   */
  setDensity(density: number): void {
    this.density = Math.max(0.1, Math.min(1.0, density));
  }

  /**
   * Activate an edge for particle flow
   * @param edgeId - Unique edge identifier
   * @param x1 - Start X coordinate
   * @param y1 - Start Y coordinate
   * @param x2 - End X coordinate
   * @param y2 - End Y coordinate
   * @param color - Particle color (hex or rgba string)
   */
  activateEdge(
    edgeId: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string
  ): void {
    this.activeEdges.set(edgeId, { x1, y1, x2, y2 });

    // Initialize spawn accumulator for this edge
    if (!this.spawnAccumulator.has(edgeId)) {
      this.spawnAccumulator.set(edgeId, 0);
    }
  }

  /**
   * Deactivate an edge (stop spawning particles, existing ones will complete)
   * @param edgeId - Unique edge identifier
   */
  deactivateEdge(edgeId: string): void {
    this.activeEdges.delete(edgeId);
    this.spawnAccumulator.delete(edgeId);
  }

  /**
   * Update particle positions and lifecycle
   * @param deltaTime - Time since last update in seconds
   */
  update(deltaTime: number): void {
    // Update existing particles
    for (const particle of this.pool) {
      if (!particle.active) continue;

      // Update progress along edge
      particle.progress += particle.speed * deltaTime;

      // Fade in at start, fade out at end
      if (particle.progress < this.FADE_DURATION) {
        particle.alpha = this.BASE_ALPHA * (particle.progress / this.FADE_DURATION);
      } else if (particle.progress > 1 - this.FADE_DURATION) {
        const fadeProgress = (1 - particle.progress) / this.FADE_DURATION;
        particle.alpha = this.BASE_ALPHA * fadeProgress;
      } else {
        particle.alpha = this.BASE_ALPHA;
      }

      // Deactivate if reached end
      if (particle.progress >= 1) {
        particle.active = false;
      }
    }

    // Spawn new particles for active edges
    this.spawnParticles(deltaTime);
  }

  /**
   * Spawn new particles based on density and edge activity
   * @param deltaTime - Time since last update in seconds
   */
  private spawnParticles(deltaTime: number): void {
    // Calculate spawn rate: particles per second per edge
    const baseSpawnRate = 2.0; // 2 particles/second at density 1.0
    const spawnRate = baseSpawnRate * this.density;
    const spawnInterval = 1.0 / spawnRate;

    for (const [edgeId, endpoints] of this.activeEdges) {
      // Accumulate spawn time
      const currentAccumulator = this.spawnAccumulator.get(edgeId) || 0;
      let newAccumulator = currentAccumulator + deltaTime;

      // Spawn particles when accumulator exceeds interval
      while (newAccumulator >= spawnInterval) {
        this.spawnParticle(edgeId, endpoints);
        newAccumulator -= spawnInterval;
      }

      this.spawnAccumulator.set(edgeId, newAccumulator);
    }
  }

  /**
   * Spawn a single particle on an edge
   * @param edgeId - Edge identifier
   * @param endpoints - Edge coordinates (not used for spawn, but kept for potential variation)
   */
  private spawnParticle(edgeId: string, endpoints: EdgeEndpoints): void {
    // Find an inactive particle in the pool
    const particle = this.pool.find(p => !p.active);
    if (!particle) return; // Pool exhausted

    // Get edge info for color variation
    const edge = this.activeEdges.get(edgeId);
    if (!edge) return;

    // Activate particle with randomized properties
    particle.active = true;
    particle.edgeId = edgeId;
    particle.progress = 0;
    particle.speed = this.randomRange(this.MIN_SPEED, this.MAX_SPEED);
    particle.size = this.randomRange(this.MIN_SIZE, this.MAX_SIZE);
    particle.alpha = 0; // Will fade in

    // Use edge color directly (color variation handled by edge renderer)
    particle.color = this.getEdgeColor(edgeId);
  }

  /**
   * Get color for particles on a given edge
   * @param edgeId - Edge identifier
   * @returns Color string
   */
  private getEdgeColor(edgeId: string): string {
    // In a real implementation, this would look up the edge's actual color
    // For now, we'll extract it when the edge is activated
    // This is a placeholder that should be enhanced to store color per edge
    return '#ffb000'; // Default amber color
  }

  /**
   * Render all active particles
   * @param ctx - Canvas 2D rendering context
   */
  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();

    for (const particle of this.pool) {
      if (!particle.active) continue;

      const edge = this.activeEdges.get(particle.edgeId);
      if (!edge) {
        // Edge was deactivated, let particle complete naturally
        // Don't render if edge endpoints are gone
        continue;
      }

      // Interpolate position along edge
      const x = edge.x1 + (edge.x2 - edge.x1) * particle.progress;
      const y = edge.y1 + (edge.y2 - edge.y1) * particle.progress;

      // Parse color and add alpha
      const color = this.addAlphaToColor(particle.color, particle.alpha);

      // Draw particle with subtle glow
      this.drawParticle(ctx, x, y, particle.size, color);
    }

    ctx.restore();
  }

  /**
   * Draw a single particle with glow effect
   * @param ctx - Canvas context
   * @param x - X position
   * @param y - Y position
   * @param size - Particle radius
   * @param color - Color with alpha
   */
  private drawParticle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    color: string
  ): void {
    // Draw glow (larger, more transparent)
    ctx.fillStyle = color.replace(/[\d.]+\)$/, '0.2)'); // Reduce alpha for glow
    ctx.beginPath();
    ctx.arc(x, y, size * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Draw core particle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Add alpha channel to color string
   * @param color - Color string (hex or rgb)
   * @param alpha - Alpha value (0-1)
   * @returns rgba color string
   */
  private addAlphaToColor(color: string, alpha: number): string {
    // Handle hex colors
    if (color.startsWith('#')) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // Handle rgb colors - convert to rgba
    if (color.startsWith('rgb(')) {
      return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
    }

    // Handle rgba - replace existing alpha
    if (color.startsWith('rgba(')) {
      return color.replace(/[\d.]+\)$/, `${alpha})`);
    }

    // Fallback
    return `rgba(255, 176, 0, ${alpha})`;
  }

  /**
   * Generate random value in range
   * @param min - Minimum value
   * @param max - Maximum value
   * @returns Random number in range
   */
  private randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  /**
   * Clear all particles and reset system
   */
  clear(): void {
    this.activeEdges.clear();
    this.spawnAccumulator.clear();

    // Deactivate all particles
    for (const particle of this.pool) {
      particle.active = false;
    }
  }

  /**
   * Get statistics about particle system state
   */
  getStats(): {
    activeParticles: number;
    activeEdges: number;
    poolUtilization: number;
  } {
    const activeParticles = this.pool.filter(p => p.active).length;
    return {
      activeParticles,
      activeEdges: this.activeEdges.size,
      poolUtilization: activeParticles / this.maxParticles,
    };
  }
}

export type { Particle, EdgeEndpoints };
