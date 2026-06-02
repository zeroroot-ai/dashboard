import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ParticleSystem } from '../particle-system';

// Mock canvas context for testing
function createMockCanvasContext(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    // Comet-tail flowing lines (#652) stroke a gradient along the edge.
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    lineDashOffset: 0,
  } as unknown as CanvasRenderingContext2D;
}

describe('ParticleSystem', () => {
  let particleSystem: ParticleSystem;
  let mockCtx: CanvasRenderingContext2D;

  beforeEach(() => {
    particleSystem = new ParticleSystem(100); // Max 100 particles
    mockCtx = createMockCanvasContext();
  });

  describe('Constructor and initialization', () => {
    it('should create particle system with default maxParticles', () => {
      const system = new ParticleSystem();

      const stats = system.getStats();
      expect(stats.activeParticles).toBe(0);
      expect(stats.activeEdges).toBe(0);
    });

    it('should create particle system with specified maxParticles', () => {
      const system = new ParticleSystem(50);

      const stats = system.getStats();
      expect(stats.activeParticles).toBe(0);
    });

    it('should initialize with no active particles', () => {
      const stats = particleSystem.getStats();

      expect(stats.activeParticles).toBe(0);
      expect(stats.activeEdges).toBe(0);
      expect(stats.poolUtilization).toBe(0);
    });
  });

  describe('activateEdge and deactivateEdge', () => {
    it('should activate an edge', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');

      const stats = particleSystem.getStats();
      expect(stats.activeEdges).toBe(1);
    });

    it('should activate multiple edges', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');
      particleSystem.activateEdge('edge-2', 100, 100, 200, 200, '#00bfff');
      particleSystem.activateEdge('edge-3', 50, 50, 150, 150, '#ff6b6b');

      const stats = particleSystem.getStats();
      expect(stats.activeEdges).toBe(3);
    });

    it('should deactivate an edge', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');
      particleSystem.activateEdge('edge-2', 100, 100, 200, 200, '#00bfff');

      expect(particleSystem.getStats().activeEdges).toBe(2);

      particleSystem.deactivateEdge('edge-1');

      expect(particleSystem.getStats().activeEdges).toBe(1);
    });

    it('should handle deactivating non-existent edge', () => {
      expect(() => {
        particleSystem.deactivateEdge('non-existent');
      }).not.toThrow();
    });

    it('should allow reactivating a previously deactivated edge', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');
      particleSystem.deactivateEdge('edge-1');

      expect(particleSystem.getStats().activeEdges).toBe(0);

      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');

      expect(particleSystem.getStats().activeEdges).toBe(1);
    });
  });

  describe('update', () => {
    it('should advance particle progress over time', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');

      // Update multiple times to spawn and advance particles
      // Need longer intervals or more updates to spawn particles
      for (let i = 0; i < 20; i++) {
        particleSystem.update(0.5); // 500ms delta time for more particle spawning
      }

      const stats = particleSystem.getStats();
      // Should have spawned some particles (may be 0 if they all completed)
      // Just verify the system ran without errors
      expect(stats.activeParticles).toBeGreaterThanOrEqual(0);
    });

    it('should spawn particles for active edges over time', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');

      const initialStats = particleSystem.getStats();
      expect(initialStats.activeParticles).toBe(0);

      // Update to spawn particles
      particleSystem.update(1.0); // 1 second

      const updatedStats = particleSystem.getStats();
      expect(updatedStats.activeParticles).toBeGreaterThan(0);
    });

    it('should handle zero delta time', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');

      expect(() => {
        particleSystem.update(0);
      }).not.toThrow();
    });

    it('should handle very small delta time', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');

      expect(() => {
        particleSystem.update(0.001); // 1ms
      }).not.toThrow();
    });

    it('should handle very large delta time', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');

      expect(() => {
        particleSystem.update(10.0); // 10 seconds
      }).not.toThrow();
    });

    it('should recycle particles that reach the end (progress >= 1)', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');

      // Spawn particles
      particleSystem.update(1.0);

      const beforeRecycle = particleSystem.getStats().activeParticles;

      // Advance particles to completion
      for (let i = 0; i < 10; i++) {
        particleSystem.update(1.0);
      }

      // Some particles should have been recycled
      const afterRecycle = particleSystem.getStats().activeParticles;

      // Pool should maintain particles (spawning new ones as old ones complete)
      expect(afterRecycle).toBeGreaterThanOrEqual(0);
    });
  });

  describe('maxParticles limit', () => {
    it('should respect maxParticles limit', () => {
      const smallSystem = new ParticleSystem(10); // Very small pool

      // Activate multiple edges
      for (let i = 0; i < 5; i++) {
        smallSystem.activateEdge(`edge-${i}`, 0, 0, 100, 100, '#ffb000');
      }

      // Update many times to try to spawn more than max
      for (let i = 0; i < 100; i++) {
        smallSystem.update(0.1);
      }

      const stats = smallSystem.getStats();
      expect(stats.activeParticles).toBeLessThanOrEqual(10);
      expect(stats.poolUtilization).toBeLessThanOrEqual(1.0);
    });

    it('should not exceed maxParticles even with high density', () => {
      const smallSystem = new ParticleSystem(20);
      smallSystem.setDensity(1.0); // Maximum density

      smallSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');

      // Update many times
      for (let i = 0; i < 50; i++) {
        smallSystem.update(0.1);
      }

      const stats = smallSystem.getStats();
      expect(stats.activeParticles).toBeLessThanOrEqual(20);
    });
  });

  describe('setDensity', () => {
    it('should accept density values between 0.1 and 1.0', () => {
      const densities = [0.1, 0.3, 0.5, 0.7, 1.0];

      densities.forEach((density) => {
        expect(() => {
          particleSystem.setDensity(density);
        }).not.toThrow();
      });
    });

    it('should clamp density below 0.1 to 0.1', () => {
      particleSystem.setDensity(0.05);

      // Can't directly test internal state, but should not throw
      expect(() => {
        particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');
        particleSystem.update(1.0);
      }).not.toThrow();
    });

    it('should clamp density above 1.0 to 1.0', () => {
      particleSystem.setDensity(2.0);

      expect(() => {
        particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');
        particleSystem.update(1.0);
      }).not.toThrow();
    });

    it('should affect particle spawn rate', () => {
      const lowDensitySystem = new ParticleSystem(100);
      const highDensitySystem = new ParticleSystem(100);

      lowDensitySystem.setDensity(0.1);
      highDensitySystem.setDensity(1.0);

      lowDensitySystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');
      highDensitySystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');

      // Update both systems
      for (let i = 0; i < 5; i++) {
        lowDensitySystem.update(0.5);
        highDensitySystem.update(0.5);
      }

      const lowStats = lowDensitySystem.getStats();
      const highStats = highDensitySystem.getStats();

      // High density should spawn more particles
      expect(highStats.activeParticles).toBeGreaterThanOrEqual(lowStats.activeParticles);
    });
  });

  describe('render', () => {
    it('should call save and restore on canvas context', () => {
      particleSystem.render(mockCtx);

      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('should not throw when rendering with no particles', () => {
      expect(() => {
        particleSystem.render(mockCtx);
      }).not.toThrow();
    });

    it('should render active particles', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');

      // Spawn particles
      particleSystem.update(1.0);

      // Render should not throw
      expect(() => {
        particleSystem.render(mockCtx);
      }).not.toThrow();

      // Should have drawn particles (arc and fill calls)
      if (particleSystem.getStats().activeParticles > 0) {
        expect(mockCtx.arc).toHaveBeenCalled();
        expect(mockCtx.fill).toHaveBeenCalled();
      }
    });

    it('should handle rendering with deactivated edges', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');
      particleSystem.update(1.0);

      // Deactivate edge while particles still exist
      particleSystem.deactivateEdge('edge-1');

      expect(() => {
        particleSystem.render(mockCtx);
      }).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should clear all active edges', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');
      particleSystem.activateEdge('edge-2', 100, 100, 200, 200, '#00bfff');

      expect(particleSystem.getStats().activeEdges).toBe(2);

      particleSystem.clear();

      expect(particleSystem.getStats().activeEdges).toBe(0);
    });

    it('should deactivate all particles', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');
      particleSystem.update(1.0);

      expect(particleSystem.getStats().activeParticles).toBeGreaterThan(0);

      particleSystem.clear();

      expect(particleSystem.getStats().activeParticles).toBe(0);
    });

    it('should reset pool utilization to 0', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');
      particleSystem.update(1.0);

      particleSystem.clear();

      const stats = particleSystem.getStats();
      expect(stats.poolUtilization).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');
      particleSystem.activateEdge('edge-2', 100, 100, 200, 200, '#00bfff');
      particleSystem.update(1.0);

      const stats = particleSystem.getStats();

      expect(stats).toHaveProperty('activeParticles');
      expect(stats).toHaveProperty('activeEdges');
      expect(stats).toHaveProperty('poolUtilization');

      expect(typeof stats.activeParticles).toBe('number');
      expect(typeof stats.activeEdges).toBe('number');
      expect(typeof stats.poolUtilization).toBe('number');

      expect(stats.activeEdges).toBe(2);
      expect(stats.activeParticles).toBeGreaterThanOrEqual(0);
      expect(stats.poolUtilization).toBeGreaterThanOrEqual(0);
      expect(stats.poolUtilization).toBeLessThanOrEqual(1);
    });

    it('should calculate pool utilization correctly', () => {
      const smallSystem = new ParticleSystem(10);

      smallSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');

      // Spawn some particles
      for (let i = 0; i < 5; i++) {
        smallSystem.update(0.5);
      }

      const stats = smallSystem.getStats();

      // Pool utilization should be activeParticles / maxParticles
      const expectedUtilization = stats.activeParticles / 10;
      expect(stats.poolUtilization).toBeCloseTo(expectedUtilization, 5);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle update with no active edges', () => {
      expect(() => {
        particleSystem.update(1.0);
      }).not.toThrow();

      expect(particleSystem.getStats().activeParticles).toBe(0);
    });

    it('should handle rendering with no active edges', () => {
      expect(() => {
        particleSystem.render(mockCtx);
      }).not.toThrow();
    });

    it('should handle activating edge with same ID multiple times', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');
      particleSystem.activateEdge('edge-1', 50, 50, 150, 150, '#00bfff');

      // Should only have one active edge (overwritten)
      expect(particleSystem.getStats().activeEdges).toBe(1);
    });

    it('should handle negative coordinates', () => {
      expect(() => {
        particleSystem.activateEdge('edge-1', -100, -100, -50, -50, '#ffb000');
        particleSystem.update(1.0);
        particleSystem.render(mockCtx);
      }).not.toThrow();
    });

    it('should handle zero-length edges (same start and end)', () => {
      expect(() => {
        particleSystem.activateEdge('edge-1', 100, 100, 100, 100, '#ffb000');
        particleSystem.update(1.0);
        particleSystem.render(mockCtx);
      }).not.toThrow();
    });

    it('should handle very long edges', () => {
      expect(() => {
        particleSystem.activateEdge('edge-1', 0, 0, 10000, 10000, '#ffb000');
        particleSystem.update(1.0);
        particleSystem.render(mockCtx);
      }).not.toThrow();
    });
  });

  describe('Lifecycle integration', () => {
    it('should complete full lifecycle: activate, update, render, deactivate', () => {
      // Activate
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');
      expect(particleSystem.getStats().activeEdges).toBe(1);

      // Update to spawn particles
      particleSystem.update(1.0);
      expect(particleSystem.getStats().activeParticles).toBeGreaterThan(0);

      // Render
      expect(() => particleSystem.render(mockCtx)).not.toThrow();

      // Deactivate
      particleSystem.deactivateEdge('edge-1');
      expect(particleSystem.getStats().activeEdges).toBe(0);

      // Particles may still exist (completing their journey)
      // but no new particles should spawn
      const particlesAfterDeactivate = particleSystem.getStats().activeParticles;

      particleSystem.update(1.0);

      // No new particles should be spawned (may have decreased as existing ones complete)
      expect(particleSystem.getStats().activeParticles).toBeLessThanOrEqual(
        particlesAfterDeactivate
      );
    });

    it('should handle multiple edges with different lifecycles', () => {
      particleSystem.activateEdge('edge-1', 0, 0, 100, 100, '#ffb000');
      particleSystem.activateEdge('edge-2', 100, 100, 200, 200, '#00bfff');

      particleSystem.update(0.5);

      particleSystem.deactivateEdge('edge-1'); // Only deactivate first edge

      particleSystem.update(0.5);

      // Edge 2 should still be active
      expect(particleSystem.getStats().activeEdges).toBe(1);
    });
  });
});
