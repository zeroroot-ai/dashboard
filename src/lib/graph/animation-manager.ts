/**
 * AnimationManager - Centralized timing and coordination for graph animations
 *
 * Provides high-resolution timing, delta time calculation, and animation utilities
 * for pulse effects, dash animations, and frame-based callbacks.
 */

export class AnimationManager {
  private startTime: number = 0;
  private currentTime: number = 0;
  private lastFrameTime: number = 0;
  private running: boolean = false;
  private callbacks: Map<string, (deltaTime: number) => void> = new Map();
  private accumulatedDashOffset: number = 0;

  /**
   * Start the animation timer
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.startTime = performance.now();
    this.lastFrameTime = this.startTime;
    this.currentTime = this.startTime;
  }

  /**
   * Stop the animation timer (pause)
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Check if animation manager is currently running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get elapsed time since start in seconds
   */
  getTime(): number {
    if (!this.running) {
      return 0;
    }
    return (this.currentTime - this.startTime) / 1000;
  }

  /**
   * Get delta time since last frame in seconds
   */
  getDeltaTime(): number {
    if (!this.running) {
      return 0;
    }
    return (this.currentTime - this.lastFrameTime) / 1000;
  }

  /**
   * Get a pulsing value (0-1 sine wave) at given frequency
   *
   * @param frequency - Pulse frequency in Hz (cycles per second)
   * @returns Value between 0 and 1
   */
  getPulseValue(frequency: number): number {
    if (!this.running) {
      return 0.5; // Return middle value when not running
    }

    const time = this.getTime();
    const rawSine = Math.sin(time * frequency * 2 * Math.PI);

    // Normalize from [-1, 1] to [0, 1]
    return (rawSine + 1) / 2;
  }

  /**
   * Get cumulative dash offset for animated dashed lines
   *
   * @param speed - Animation speed in pixels per second
   * @returns Cumulative offset in pixels
   */
  getDashOffset(speed: number): number {
    return this.accumulatedDashOffset * speed;
  }

  /**
   * Register a callback to be called each frame
   *
   * @param id - Unique identifier for the callback
   * @param callback - Function to call with deltaTime in seconds
   */
  registerCallback(id: string, callback: (deltaTime: number) => void): void {
    this.callbacks.set(id, callback);
  }

  /**
   * Unregister a previously registered callback
   *
   * @param id - Identifier of the callback to remove
   */
  unregisterCallback(id: string): void {
    this.callbacks.delete(id);
  }

  /**
   * Update animation state - call this every frame from render loop
   *
   * This updates internal time tracking and invokes all registered callbacks
   */
  update(): void {
    if (!this.running) {
      return;
    }

    const now = performance.now();
    this.currentTime = now;

    const deltaTime = (now - this.lastFrameTime) / 1000; // Convert to seconds
    this.lastFrameTime = now;

    // Accumulate dash offset (normalized per second)
    this.accumulatedDashOffset += deltaTime;

    // Invoke all registered callbacks with delta time
    for (const callback of this.callbacks.values()) {
      try {
        callback(deltaTime);
      } catch (error) {
        console.error('AnimationManager callback error:', error);
      }
    }
  }

  /**
   * Reset the animation state (useful when restarting)
   */
  reset(): void {
    const wasRunning = this.running;
    this.stop();
    this.startTime = 0;
    this.currentTime = 0;
    this.lastFrameTime = 0;
    this.accumulatedDashOffset = 0;

    if (wasRunning) {
      this.start();
    }
  }

  /**
   * Get animation statistics for debugging
   */
  getStats(): {
    running: boolean;
    elapsedTime: number;
    deltaTime: number;
    callbackCount: number;
  } {
    return {
      running: this.running,
      elapsedTime: this.getTime(),
      deltaTime: this.getDeltaTime(),
      callbackCount: this.callbacks.size,
    };
  }
}

// Export singleton instance for convenience
export const animationManager = new AnimationManager();
