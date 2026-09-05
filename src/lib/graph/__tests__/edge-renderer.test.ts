import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EdgeRenderer, type EdgeOptions, type DashPattern } from '../edge-renderer';

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

describe('EdgeRenderer', () => {
  let renderer: EdgeRenderer;
  let mockCtx: CanvasRenderingContext2D;

  beforeEach(() => {
    renderer = new EdgeRenderer();
    mockCtx = createMockCanvasContext();
  });

  describe('drawEdge', () => {
    it('should call save and restore on canvas context', () => {
      const options: EdgeOptions = {
        color: '#ffb000',
        dashPattern: 'solid',
        animated: false,
        glowEnabled: false,
        alpha: 1.0,
        lineWidth: 2,
      };

      renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('should draw line from source to target', () => {
      const options: EdgeOptions = {
        color: '#ffb000',
        dashPattern: 'solid',
        animated: false,
        glowEnabled: false,
        alpha: 1.0,
        lineWidth: 2,
      };

      renderer.drawEdge(mockCtx, 10, 20, 150, 200, options);

      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.moveTo).toHaveBeenCalledWith(10, 20);
      expect(mockCtx.lineTo).toHaveBeenCalledWith(150, 200);
      expect(mockCtx.stroke).toHaveBeenCalled();
    });

    describe('Dash patterns', () => {
      it('should set solid pattern (empty array)', () => {
        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'solid',
          animated: false,
          glowEnabled: false,
          alpha: 1.0,
          lineWidth: 2,
        };

        renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

        expect(mockCtx.setLineDash).toHaveBeenCalledWith([]);
      });

      it('should set short-dash pattern [4, 4]', () => {
        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'short-dash',
          animated: false,
          glowEnabled: false,
          alpha: 1.0,
          lineWidth: 2,
        };

        renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

        expect(mockCtx.setLineDash).toHaveBeenCalledWith([4, 4]);
      });

      it('should set long-dash pattern [12, 6]', () => {
        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'long-dash',
          animated: false,
          glowEnabled: false,
          alpha: 1.0,
          lineWidth: 2,
        };

        renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

        expect(mockCtx.setLineDash).toHaveBeenCalledWith([12, 6]);
      });

      it('should set dot-dash pattern [2, 4, 8, 4]', () => {
        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'dot-dash',
          animated: false,
          glowEnabled: false,
          alpha: 1.0,
          lineWidth: 2,
        };

        renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

        expect(mockCtx.setLineDash).toHaveBeenCalledWith([2, 4, 8, 4]);
      });

      it('should set all 4 dash patterns correctly', () => {
        const dashPatterns: DashPattern[] = ['solid', 'short-dash', 'long-dash', 'dot-dash'];
        const expectedArrays = [[], [4, 4], [12, 6], [2, 4, 8, 4]];

        dashPatterns.forEach((pattern, index) => {
          vi.clearAllMocks();

          const options: EdgeOptions = {
            color: '#ffb000',
            dashPattern: pattern,
            animated: false,
            glowEnabled: false,
            alpha: 1.0,
            lineWidth: 2,
          };

          renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

          expect(mockCtx.setLineDash).toHaveBeenCalledWith(expectedArrays[index]);
        });
      });
    });

    describe('Animation', () => {
      it('should apply animation offset when animated is true', () => {
        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'short-dash',
          animated: true,
          animationOffset: 10,
          glowEnabled: false,
          alpha: 1.0,
          lineWidth: 2,
        };

        renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

        expect(mockCtx.lineDashOffset).toBe(10);
      });

      it('should set lineDashOffset to 0 when animated is false', () => {
        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'short-dash',
          animated: false,
          glowEnabled: false,
          alpha: 1.0,
          lineWidth: 2,
        };

        renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

        expect(mockCtx.lineDashOffset).toBe(0);
      });

      it('should set lineDashOffset to 0 when animationOffset is undefined', () => {
        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'short-dash',
          animated: true,
          // animationOffset not provided
          glowEnabled: false,
          alpha: 1.0,
          lineWidth: 2,
        };

        renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

        expect(mockCtx.lineDashOffset).toBe(0);
      });

      it('should apply various animation offset values', () => {
        const offsets = [0, 5, 10, 25, 100, -10];

        offsets.forEach((offset) => {
          vi.clearAllMocks();

          const options: EdgeOptions = {
            color: '#ffb000',
            dashPattern: 'short-dash',
            animated: true,
            animationOffset: offset,
            glowEnabled: false,
            alpha: 1.0,
            lineWidth: 2,
          };

          renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

          expect(mockCtx.lineDashOffset).toBe(offset);
        });
      });
    });

    describe('Glow effects', () => {
      it('should apply glow effect in dark theme when enabled', () => {
        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'solid',
          animated: false,
          glowEnabled: true,
          alpha: 1.0,
          lineWidth: 2,
        };

        renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

        expect(mockCtx.shadowBlur).toBeGreaterThan(0);
        expect(mockCtx.shadowColor).toBeDefined();
      });

      it('should not apply glow when disabled', () => {
        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'solid',
          animated: false,
          glowEnabled: false,
          alpha: 1.0,
          lineWidth: 2,
        };

        renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

        expect(mockCtx.shadowBlur).toBe(0);
      });
    });

    describe('Color and alpha', () => {
      it('should apply color with alpha', () => {
        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'solid',
          animated: false,
          glowEnabled: false,
          alpha: 0.5,
          lineWidth: 2,
        };

        renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

        // strokeStyle should be set with rgba format including alpha
        expect(mockCtx.strokeStyle).toBeDefined();
        expect(typeof mockCtx.strokeStyle).toBe('string');
      });

      it('should handle full opacity (alpha = 1.0)', () => {
        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'solid',
          animated: false,
          glowEnabled: false,
          alpha: 1.0,
          lineWidth: 2,
        };

        renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

        expect(mockCtx.strokeStyle).toBeDefined();
      });

      it('should handle full transparency (alpha = 0)', () => {
        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'solid',
          animated: false,
          glowEnabled: false,
          alpha: 0,
          lineWidth: 2,
        };

        renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

        expect(mockCtx.strokeStyle).toBeDefined();
      });

      it('should handle various color formats', () => {
        const colors = [
          '#ffb000', // Hex
          '#f0b', // Short hex
          'rgb(255, 176, 0)', // RGB
          'rgba(255, 176, 0, 0.5)', // RGBA
        ];

        colors.forEach((color) => {
          vi.clearAllMocks();

          const options: EdgeOptions = {
            color,
            dashPattern: 'solid',
            animated: false,
            glowEnabled: false,
            alpha: 0.7,
            lineWidth: 2,
          };

          expect(() => {
            renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);
          }).not.toThrow();
        });
      });
    });

    describe('Line width', () => {
      it('should set line width from options', () => {
        const widths = [1, 2, 3, 5, 10];

        widths.forEach((width) => {
          vi.clearAllMocks();

          const options: EdgeOptions = {
            color: '#ffb000',
            dashPattern: 'solid',
            animated: false,
            glowEnabled: false,
            alpha: 1.0,
            lineWidth: width,
          };

          renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);

          expect(mockCtx.lineWidth).toBe(width);
        });
      });
    });

    describe('Edge cases', () => {
      it('should handle zero-length edge (same source and target)', () => {
        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'solid',
          animated: false,
          glowEnabled: false,
          alpha: 1.0,
          lineWidth: 2,
        };

        expect(() => {
          renderer.drawEdge(mockCtx, 50, 50, 50, 50, options);
        }).not.toThrow();

        expect(mockCtx.moveTo).toHaveBeenCalledWith(50, 50);
        expect(mockCtx.lineTo).toHaveBeenCalledWith(50, 50);
      });

      it('should handle negative coordinates', () => {
        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'solid',
          animated: false,
          glowEnabled: false,
          alpha: 1.0,
          lineWidth: 2,
        };

        expect(() => {
          renderer.drawEdge(mockCtx, -100, -100, -50, -50, options);
        }).not.toThrow();
      });

      it('should handle very large coordinates', () => {
        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'solid',
          animated: false,
          glowEnabled: false,
          alpha: 1.0,
          lineWidth: 2,
        };

        expect(() => {
          renderer.drawEdge(mockCtx, 0, 0, 10000, 10000, options);
        }).not.toThrow();
      });

      it('should restore context even if error occurs', () => {
        // Create a context that throws during stroke
        const faultyCtx = createMockCanvasContext();
        (faultyCtx as unknown as Record<string, unknown>).stroke = vi.fn(() => {
          throw new Error('Canvas error');
        });

        const options: EdgeOptions = {
          color: '#ffb000',
          dashPattern: 'solid',
          animated: false,
          glowEnabled: false,
          alpha: 1.0,
          lineWidth: 2,
        };

        try {
          renderer.drawEdge(faultyCtx, 0, 0, 100, 100, options);
        } catch {
          // Error is expected
        }

        // Restore should still be called due to try-finally
        expect(faultyCtx.restore).toHaveBeenCalled();
      });
    });

    describe('Complete option combinations', () => {
      it('should handle all combinations without throwing', () => {
        const combinations: EdgeOptions[] = [
          {
            color: '#ffb000',
            dashPattern: 'solid',
            animated: false,
            glowEnabled: false,
            alpha: 1.0,
            lineWidth: 2,
          },
          {
            color: '#00bfff',
            dashPattern: 'short-dash',
            animated: true,
            animationOffset: 15,
            glowEnabled: true,
            alpha: 0.8,
            lineWidth: 3,
          },
          {
            color: 'rgba(255, 0, 0, 0.5)',
            dashPattern: 'long-dash',
            animated: true,
            animationOffset: -5,
            glowEnabled: true,
            alpha: 0.5,
            lineWidth: 1,
          },
          {
            color: '#ff6b6b',
            dashPattern: 'dot-dash',
            animated: false,
            glowEnabled: false,
            alpha: 0.3,
            lineWidth: 4,
          },
        ];

        combinations.forEach((options) => {
          vi.clearAllMocks();

          expect(() => {
            renderer.drawEdge(mockCtx, 0, 0, 100, 100, options);
          }).not.toThrow();

          expect(mockCtx.save).toHaveBeenCalled();
          expect(mockCtx.restore).toHaveBeenCalled();
        });
      });
    });
  });
});
