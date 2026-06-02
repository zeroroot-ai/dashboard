import { describe, it, expect } from 'vitest';
import {
  getThemeColors,
  DARK_THEME,
  type EntityType,
  type RelationshipType,
  type Severity,
  type ThemeColors,
} from '../theme-colors';

// ============================================================================
// WCAG Contrast Utilities (pure functions — no DOM required)
// ============================================================================

/**
 * Convert an sRGB channel value [0,1] to linear light.
 * Inverse of the IEC 61966-2-1 transfer function.
 */
function srgbToLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Compute the relative luminance of a hex color as defined by WCAG 2.1.
 * Input must be a 6-digit hex string (with or without leading '#').
 */
function hexLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * Compute the WCAG 2.1 contrast ratio between two hex colors.
 * Result is in [1, 21].
 */
function contrastRatio(hex1: string, hex2: string): number {
  const L1 = hexLuminance(hex1);
  const L2 = hexLuminance(hex2);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ============================================================================
// Tests — single locked dark brand (#652)
// ============================================================================

describe('theme-colors (single dark brand)', () => {
  describe('getThemeColors', () => {
    it('returns the dark brand palette', () => {
      const colors = getThemeColors();
      expect(colors).toBeDefined();
      expect(colors).toBe(DARK_THEME);
    });
  });

  describe('DARK_THEME structure', () => {
    it('has all required color keys', () => {
      expect(DARK_THEME.background).toBeDefined();
      expect(DARK_THEME.grid).toBeDefined();
      expect(DARK_THEME.glowColors).toBeDefined();
      expect(DARK_THEME.nodeColors).toBeDefined();
      expect(DARK_THEME.edgeColors).toBeDefined();
      expect(DARK_THEME.severityColors).toBeDefined();
    });

    it('has a near-black, blue-violet-tinted background', () => {
      expect(DARK_THEME.background).toMatch(/^#[0-9a-f]{6}$/i);
      // Not pure cold-black; the brand base is lifted off #000.
      expect(DARK_THEME.background).not.toBe('#000000');
      // Dark enough to be a near-black surface.
      expect(hexLuminance(DARK_THEME.background)).toBeLessThan(0.03);
    });

    it('uses a violet-led grid + glow (the brand accent)', () => {
      expect(DARK_THEME.grid).toMatch(/^rgba\(139,\s*92,\s*246/);
      expect(DARK_THEME.glowColors.primary).toMatch(/^rgba\(139,\s*92,\s*246/);
    });

    it('makes the mission (root) node the brand violet', () => {
      // The mission node anchors the graph; it carries the primary brand hue.
      expect(DARK_THEME.nodeColors.mission).toBe('#b39dff');
    });

    it('has all glow colors in rgba format', () => {
      const { glowColors } = DARK_THEME;
      expect(glowColors.primary).toMatch(/^rgba\(/);
      expect(glowColors.active).toMatch(/^rgba\(/);
      expect(glowColors.critical).toMatch(/^rgba\(/);
      expect(glowColors.success).toMatch(/^rgba\(/);
    });

    it('has colors for all 16 entity types', () => {
      const entityTypes: EntityType[] = [
        'mission', 'mission_run', 'agent_run', 'tool_execution', 'llm_call',
        'domain', 'subdomain', 'host', 'port', 'service', 'endpoint',
        'technology', 'certificate', 'finding', 'evidence', 'technique',
      ];
      entityTypes.forEach((t) => {
        expect(DARK_THEME.nodeColors[t]).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    it('has colors for all relationship types', () => {
      const relTypes: RelationshipType[] = [
        'HAS_SUBDOMAIN', 'RESOLVES_TO', 'HAS_PORT', 'RUNS_SERVICE', 'HAS_ENDPOINT',
        'USES_TECHNOLOGY', 'SERVES_CERTIFICATE', 'AFFECTS', 'HAS_EVIDENCE',
        'USES_TECHNIQUE', 'LEADS_TO', 'USED_TO', 'USED_TOOL', 'DELEGATED_TO',
        'DISCOVERED', 'BELONGS_TO',
      ];
      relTypes.forEach((r) => {
        expect(DARK_THEME.edgeColors[r]).toMatch(
          /^(#[0-9a-f]{6}|rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\))$/i,
        );
      });
    });

    it('has colors for all severity levels', () => {
      const severities: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
      severities.forEach((s) => {
        expect(DARK_THEME.severityColors[s]).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });
  });

  // --------------------------------------------------------------------------
  // WCAG AA contrast — re-paletted colors must stay legible on the new base.
  // --------------------------------------------------------------------------

  describe('WCAG AA — node colors vs the brand background (>=4.5:1)', () => {
    const bg = DARK_THEME.background;
    const entityTypes: EntityType[] = [
      'mission', 'mission_run', 'agent_run', 'tool_execution', 'llm_call',
      'domain', 'subdomain', 'host', 'port', 'service', 'endpoint',
      'technology', 'certificate', 'finding', 'evidence', 'technique',
    ];
    it.each(entityTypes)('%s node color is AA-legible', (t) => {
      expect(contrastRatio(DARK_THEME.nodeColors[t], bg)).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('WCAG AA — severity colors vs the brand background (>=4.5:1)', () => {
    const bg = DARK_THEME.background;
    const severities: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
    it.each(severities)('%s severity color is AA-legible', (s) => {
      expect(contrastRatio(DARK_THEME.severityColors[s], bg)).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('node types stay mutually distinguishable', () => {
    it('mission and domain differ', () => {
      expect(DARK_THEME.nodeColors.mission).not.toBe(DARK_THEME.nodeColors.domain);
    });
    it('finding and evidence differ', () => {
      expect(DARK_THEME.nodeColors.finding).not.toBe(DARK_THEME.nodeColors.evidence);
    });
    it('host and service differ', () => {
      expect(DARK_THEME.nodeColors.host).not.toBe(DARK_THEME.nodeColors.service);
    });
    it('agent_run and llm_call differ', () => {
      expect(DARK_THEME.nodeColors.agent_run).not.toBe(DARK_THEME.nodeColors.llm_call);
    });
    it('mission and finding have a luminance gap', () => {
      const diff = Math.abs(
        hexLuminance(DARK_THEME.nodeColors.mission) -
        hexLuminance(DARK_THEME.nodeColors.finding),
      );
      expect(diff).toBeGreaterThan(0.01);
    });
  });

  describe('ThemeColors type conformance', () => {
    it('conforms to the ThemeColors interface', () => {
      const colors: ThemeColors = DARK_THEME;
      expect(colors.background).toBeDefined();
      expect(colors.grid).toBeDefined();
      expect(colors.glowColors).toBeDefined();
      expect(colors.nodeColors).toBeDefined();
      expect(colors.edgeColors).toBeDefined();
      expect(colors.severityColors).toBeDefined();
    });
  });
});
