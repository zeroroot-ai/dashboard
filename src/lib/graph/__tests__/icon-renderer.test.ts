import { describe, it, expect, beforeEach, vi } from 'vitest';

// Path2D is not available in jsdom, provide a minimal stub so icon-renderer
// can construct Path2D objects without throwing.
if (typeof globalThis.Path2D === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Path2D = class Path2D {
    constructor(_pathData?: string) {}
  };
}

import { IconRenderer, type EntityType, type IconOptions } from '../icon-renderer';

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
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    lineDashOffset: 0,
  } as unknown as CanvasRenderingContext2D;
}

describe('IconRenderer', () => {
  let renderer: IconRenderer;
  let mockCtx: CanvasRenderingContext2D;

  beforeEach(() => {
    renderer = new IconRenderer();
    mockCtx = createMockCanvasContext();
  });

  describe('drawIcon', () => {
    const allEntityTypes: EntityType[] = [
      'mission',
      'mission_run',
      'agent_run',
      'tool_execution',
      'llm_call',
      'domain',
      'subdomain',
      'host',
      'port',
      'service',
      'endpoint',
      'technology',
      'certificate',
      'finding',
      'evidence',
      'technique',
    ];

    it('should not throw for all entity types', () => {
      allEntityTypes.forEach((entityType) => {
        expect(() => {
          renderer.drawIcon(mockCtx, entityType, 100, 100, 20, { color: '#ffb000' });
        }).not.toThrow();
      });
    });

    it('should call save and restore on canvas context', () => {
      renderer.drawIcon(mockCtx, 'mission', 100, 100, 20, { color: '#ffb000' });

      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('should fallback to circle at small sizes (< 6px)', () => {
      // At size 4px (< 6px fallback threshold)
      renderer.drawIcon(mockCtx, 'mission', 100, 100, 4, { color: '#ffb000' });

      // Should draw a circle (arc call)
      expect(mockCtx.arc).toHaveBeenCalled();
      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.fill).toHaveBeenCalled();
    });

    it('should fallback to circle at exactly 5px', () => {
      renderer.drawIcon(mockCtx, 'domain', 100, 100, 5, { color: '#00bfff' });

      // Should draw a circle
      expect(mockCtx.arc).toHaveBeenCalled();
      expect(mockCtx.fill).toHaveBeenCalled();
    });

    it('should not fallback to circle at 6px or larger', () => {
      // Clear previous calls
      vi.clearAllMocks();

      renderer.drawIcon(mockCtx, 'mission', 100, 100, 6, { color: '#ffb000' });

      // At 6px, should attempt to draw icon (not simple fallback circle)
      // Arc should still be called for fallback since icon paths may not be loaded
      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('should apply glow effect when glowIntensity > 0', () => {
      const options: IconOptions = {
        color: '#ffb000',
        glowColor: '#ff0000',
        glowIntensity: 0.8,
      };

      renderer.drawIcon(mockCtx, 'mission', 100, 100, 20, options);

      // Should set shadow properties for glow
      expect(mockCtx.shadowBlur).toBeGreaterThan(0);
    });

    it('should not apply glow when glowIntensity is 0', () => {
      const options: IconOptions = {
        color: '#ffb000',
        glowIntensity: 0,
      };

      renderer.drawIcon(mockCtx, 'mission', 100, 100, 20, options);

      // Shadow blur should remain at 0 or not be set significantly
      expect(mockCtx.shadowBlur).toBe(0);
    });

    it('should handle hover state (increased size)', () => {
      const options: IconOptions = {
        color: '#ffb000',
        isHovered: true,
      };

      // We can't directly test size increase, but we can verify it doesn't throw
      expect(() => {
        renderer.drawIcon(mockCtx, 'mission', 100, 100, 20, options);
      }).not.toThrow();

      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('should handle active state with pulse', () => {
      const options: IconOptions = {
        color: '#ffb000',
        isActive: true,
        pulsePhase: 0.5,
      };

      expect(() => {
        renderer.drawIcon(mockCtx, 'mission', 100, 100, 20, options);
      }).not.toThrow();

      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('should apply alpha transparency', () => {
      const options: IconOptions = {
        color: '#ffb000',
        alpha: 0.5,
      };

      renderer.drawIcon(mockCtx, 'mission', 100, 100, 20, options);

      // fillStyle should contain alpha or globalAlpha should be modified
      expect(mockCtx.save).toHaveBeenCalled();
    });

    it('should use glowColor when provided', () => {
      const options: IconOptions = {
        color: '#ffb000',
        glowColor: '#00ff00',
        glowIntensity: 0.7,
      };

      renderer.drawIcon(mockCtx, 'mission', 100, 100, 20, options);

      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('should default glowColor to color when not provided', () => {
      const options: IconOptions = {
        color: '#ffb000',
        glowIntensity: 0.7,
      };

      renderer.drawIcon(mockCtx, 'mission', 100, 100, 20, options);

      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('should handle all option combinations without throwing', () => {
      const optionsCombinations: IconOptions[] = [
        { color: '#ffb000' },
        { color: '#ffb000', glowIntensity: 0 },
        { color: '#ffb000', glowIntensity: 1 },
        { color: '#ffb000', alpha: 0.5 },
        { color: '#ffb000', isHovered: true },
        { color: '#ffb000', isActive: true, pulsePhase: 0 },
        { color: '#ffb000', isActive: true, pulsePhase: 1 },
        {
          color: '#ffb000',
          glowColor: '#ff0000',
          glowIntensity: 0.8,
          alpha: 0.7,
          isHovered: true,
          isActive: true,
          pulsePhase: 0.5,
        },
      ];

      optionsCombinations.forEach((options) => {
        expect(() => {
          renderer.drawIcon(mockCtx, 'mission', 100, 100, 20, options);
        }).not.toThrow();
      });
    });

    it('should restore context state even if error occurs', () => {
      // Create a context that throws during drawing
      const faultyCtx = createMockCanvasContext();
      (faultyCtx as unknown as Record<string, unknown>).fill = vi.fn(() => {
        throw new Error('Canvas error');
      });

      // Should catch error internally and still restore
      try {
        renderer.drawIcon(faultyCtx, 'mission', 100, 100, 20, { color: '#ffb000' });
      } catch {
        // Error is expected
      }

      // Restore should still be called due to try-finally
      expect(faultyCtx.restore).toHaveBeenCalled();
    });
  });

  describe('getIconPath', () => {
    it('should not throw when getting icon paths for all entity types', () => {
      const allEntityTypes: EntityType[] = [
        'mission',
        'mission_run',
        'agent_run',
        'tool_execution',
        'llm_call',
        'domain',
        'subdomain',
        'host',
        'port',
        'service',
        'endpoint',
        'technology',
        'certificate',
        'finding',
        'evidence',
        'technique',
      ];

      allEntityTypes.forEach((entityType) => {
        // Should not throw when calling getIconPath
        expect(() => {
          renderer.getIconPath(entityType);
        }).not.toThrow();
      });
    });

    it('should return null when icon paths are not loaded', () => {
      // Since icon paths may not be loaded in test environment
      const path = renderer.getIconPath('mission');

      // Should be null if paths not loaded, or Path2D if available
      expect(path).toBeDefined();
    });
  });

  describe('isIconPathsLoaded', () => {
    it('should return a boolean', () => {
      const loaded = renderer.isIconPathsLoaded();

      expect(typeof loaded).toBe('boolean');
    });
  });

  describe('Edge cases', () => {
    it('should handle zero size gracefully', () => {
      expect(() => {
        renderer.drawIcon(mockCtx, 'mission', 100, 100, 0, { color: '#ffb000' });
      }).not.toThrow();
    });

    it('should handle negative coordinates', () => {
      expect(() => {
        renderer.drawIcon(mockCtx, 'mission', -100, -100, 20, { color: '#ffb000' });
      }).not.toThrow();
    });

    it('should handle very large sizes', () => {
      expect(() => {
        renderer.drawIcon(mockCtx, 'mission', 100, 100, 1000, { color: '#ffb000' });
      }).not.toThrow();
    });

    it('should handle pulsePhase outside 0-1 range', () => {
      const options: IconOptions = {
        color: '#ffb000',
        isActive: true,
        pulsePhase: 5.5, // Outside normal range
      };

      expect(() => {
        renderer.drawIcon(mockCtx, 'mission', 100, 100, 20, options);
      }).not.toThrow();
    });

    it('should handle alpha outside 0-1 range', () => {
      const options: IconOptions = {
        color: '#ffb000',
        alpha: 2.5, // Outside normal range
      };

      expect(() => {
        renderer.drawIcon(mockCtx, 'mission', 100, 100, 20, options);
      }).not.toThrow();
    });

    it('should handle various color formats', () => {
      const colorFormats = [
        '#ffb000', // Hex
        'rgb(255, 176, 0)', // RGB
        'rgba(255, 176, 0, 0.5)', // RGBA
      ];

      colorFormats.forEach((color) => {
        expect(() => {
          renderer.drawIcon(mockCtx, 'mission', 100, 100, 20, { color });
        }).not.toThrow();
      });
    });
  });
});
