import { describe, it, expect } from 'vitest';
import {
  getThemeColors,
  DARK_THEME,
  LIGHT_THEME,
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
// Tests
// ============================================================================

describe('theme-colors', () => {
  describe('getThemeColors', () => {
    it('should return dark theme colors when theme is "dark"', () => {
      const colors = getThemeColors('dark');

      expect(colors).toBeDefined();
      expect(colors).toBe(DARK_THEME);
    });

    it('should return light theme colors when theme is "light"', () => {
      const colors = getThemeColors('light');

      expect(colors).toBeDefined();
      expect(colors).toBe(LIGHT_THEME);
    });
  });

  describe('DARK_THEME', () => {
    it('should have all required color keys', () => {
      expect(DARK_THEME).toBeDefined();
      expect(DARK_THEME.background).toBeDefined();
      expect(DARK_THEME.grid).toBeDefined();
      expect(DARK_THEME.glowColors).toBeDefined();
      expect(DARK_THEME.nodeColors).toBeDefined();
      expect(DARK_THEME.edgeColors).toBeDefined();
      expect(DARK_THEME.severityColors).toBeDefined();
    });

    it('should have a deep-navy background (not pure cold-black)', () => {
      // The background must be a valid hex color
      expect(DARK_THEME.background).toMatch(/^#[0-9a-f]{6}$/i);
      // Must NOT be the old pure cold-black value
      expect(DARK_THEME.background).not.toBe('#09090b');
      // Must be dark enough (luminance < 0.03) — it is a near-black surface
      expect(hexLuminance(DARK_THEME.background)).toBeLessThan(0.03);
    });

    it('should have valid grid color (rgba)', () => {
      expect(DARK_THEME.grid).toMatch(/^rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)$/);
    });

    it('should have all glow color properties', () => {
      const { glowColors } = DARK_THEME;

      expect(glowColors.primary).toBeDefined();
      expect(glowColors.active).toBeDefined();
      expect(glowColors.critical).toBeDefined();
      expect(glowColors.success).toBeDefined();

      // All glow colors should be rgba format
      expect(glowColors.primary).toMatch(/^rgba\(/);
      expect(glowColors.active).toMatch(/^rgba\(/);
      expect(glowColors.critical).toMatch(/^rgba\(/);
      expect(glowColors.success).toMatch(/^rgba\(/);
    });

    it('should have colors for all 16 entity types', () => {
      const entityTypes: EntityType[] = [
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

      entityTypes.forEach((entityType) => {
        const color = DARK_THEME.nodeColors[entityType];
        expect(color).toBeDefined();
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    it('should have colors for all relationship types', () => {
      const relationshipTypes: RelationshipType[] = [
        'HAS_SUBDOMAIN',
        'RESOLVES_TO',
        'HAS_PORT',
        'RUNS_SERVICE',
        'HAS_ENDPOINT',
        'USES_TECHNOLOGY',
        'SERVES_CERTIFICATE',
        'AFFECTS',
        'HAS_EVIDENCE',
        'USES_TECHNIQUE',
        'LEADS_TO',
        'USED_TOOL',
        'DELEGATED_TO',
        'DISCOVERED',
        'BELONGS_TO',
      ];

      relationshipTypes.forEach((relType) => {
        const color = DARK_THEME.edgeColors[relType];
        expect(color).toBeDefined();
        // Dark theme uses rgba() for structural edges and hex for others.
        expect(color).toMatch(/^(#[0-9a-f]{6}|rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\))$/i);
      });
    });

    it('should have colors for all severity levels', () => {
      const severities: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

      severities.forEach((severity) => {
        const color = DARK_THEME.severityColors[severity];
        expect(color).toBeDefined();
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });
  });

  describe('LIGHT_THEME', () => {
    it('should have all required color keys', () => {
      expect(LIGHT_THEME).toBeDefined();
      expect(LIGHT_THEME.background).toBeDefined();
      expect(LIGHT_THEME.grid).toBeDefined();
      expect(LIGHT_THEME.glowColors).toBeDefined();
      expect(LIGHT_THEME.nodeColors).toBeDefined();
      expect(LIGHT_THEME.edgeColors).toBeDefined();
      expect(LIGHT_THEME.severityColors).toBeDefined();
    });

    it('should have valid background color', () => {
      expect(LIGHT_THEME.background).toMatch(/^#[0-9a-f]{6}$/i);
      expect(LIGHT_THEME.background).toBe('#faf6eb');
    });

    it('should have valid grid color (rgba)', () => {
      expect(LIGHT_THEME.grid).toMatch(/^rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)$/);
    });

    it('should have all glow color properties', () => {
      const { glowColors } = LIGHT_THEME;

      expect(glowColors.primary).toBeDefined();
      expect(glowColors.active).toBeDefined();
      expect(glowColors.critical).toBeDefined();
      expect(glowColors.success).toBeDefined();

      // All glow colors should be rgba format
      expect(glowColors.primary).toMatch(/^rgba\(/);
      expect(glowColors.active).toMatch(/^rgba\(/);
      expect(LIGHT_THEME.glowColors.primary).toMatch(/^rgba\(/);
      expect(LIGHT_THEME.glowColors.active).toMatch(/^rgba\(/);
    });

    it('should have colors for all 16 entity types', () => {
      const entityTypes: EntityType[] = [
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

      entityTypes.forEach((entityType) => {
        const color = LIGHT_THEME.nodeColors[entityType];
        expect(color).toBeDefined();
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    it('should have colors for all relationship types', () => {
      const relationshipTypes: RelationshipType[] = [
        'HAS_SUBDOMAIN',
        'RESOLVES_TO',
        'HAS_PORT',
        'RUNS_SERVICE',
        'HAS_ENDPOINT',
        'USES_TECHNOLOGY',
        'SERVES_CERTIFICATE',
        'AFFECTS',
        'HAS_EVIDENCE',
        'USES_TECHNIQUE',
        'LEADS_TO',
        'USED_TOOL',
        'DELEGATED_TO',
        'DISCOVERED',
        'BELONGS_TO',
      ];

      relationshipTypes.forEach((relType) => {
        const color = LIGHT_THEME.edgeColors[relType];
        expect(color).toBeDefined();
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    it('should have colors for all severity levels', () => {
      const severities: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

      severities.forEach((severity) => {
        const color = LIGHT_THEME.severityColors[severity];
        expect(color).toBeDefined();
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });
  });

  describe('Theme consistency', () => {
    it('should have same structure for dark and light themes', () => {
      // Both themes should have the same keys
      expect(Object.keys(DARK_THEME).sort()).toEqual(Object.keys(LIGHT_THEME).sort());

      // Both should have same glow color keys
      expect(Object.keys(DARK_THEME.glowColors).sort()).toEqual(
        Object.keys(LIGHT_THEME.glowColors).sort()
      );

      // Both should have same entity type keys
      expect(Object.keys(DARK_THEME.nodeColors).sort()).toEqual(
        Object.keys(LIGHT_THEME.nodeColors).sort()
      );

      // Both should have same severity keys
      expect(Object.keys(DARK_THEME.severityColors).sort()).toEqual(
        Object.keys(LIGHT_THEME.severityColors).sort()
      );
    });

    it('should have different background colors between themes', () => {
      expect(DARK_THEME.background).not.toBe(LIGHT_THEME.background);
    });

    it('should have different node colors between themes (most cases)', () => {
      const entityTypes: EntityType[] = ['mission', 'domain', 'finding'];

      entityTypes.forEach((entityType) => {
        const darkColor = DARK_THEME.nodeColors[entityType];
        const lightColor = LIGHT_THEME.nodeColors[entityType];

        expect(darkColor).not.toBe(lightColor);
      });
    });
  });

  describe('ThemeColors type conformance', () => {
    it('should conform to ThemeColors interface for dark theme', () => {
      const colors: ThemeColors = DARK_THEME;

      // Type checking - these should compile without errors
      expect(colors.background).toBeDefined();
      expect(colors.grid).toBeDefined();
      expect(colors.glowColors).toBeDefined();
      expect(colors.nodeColors).toBeDefined();
      expect(colors.edgeColors).toBeDefined();
      expect(colors.severityColors).toBeDefined();
    });

    it('should conform to ThemeColors interface for light theme', () => {
      const colors: ThemeColors = LIGHT_THEME;

      // Type checking - these should compile without errors
      expect(colors.background).toBeDefined();
      expect(colors.grid).toBeDefined();
      expect(colors.glowColors).toBeDefined();
      expect(colors.nodeColors).toBeDefined();
      expect(colors.edgeColors).toBeDefined();
      expect(colors.severityColors).toBeDefined();
    });
  });

  describe('Color format validation', () => {
    it('should use hex format for node colors in both themes', () => {
      const entityTypes: EntityType[] = [
        'mission',
        'domain',
        'host',
        'finding',
        'technique',
      ];

      entityTypes.forEach((entityType) => {
        expect(DARK_THEME.nodeColors[entityType]).toMatch(/^#[0-9a-f]{6}$/i);
        expect(LIGHT_THEME.nodeColors[entityType]).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    it('should use hex format for severity colors in both themes', () => {
      const severities: Severity[] = ['critical', 'high', 'medium'];

      severities.forEach((severity) => {
        expect(DARK_THEME.severityColors[severity]).toMatch(/^#[0-9a-f]{6}$/i);
        expect(LIGHT_THEME.severityColors[severity]).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    it('should use rgba format for glow colors in both themes', () => {
      expect(DARK_THEME.glowColors.primary).toMatch(/^rgba\(/);
      expect(DARK_THEME.glowColors.active).toMatch(/^rgba\(/);
      expect(LIGHT_THEME.glowColors.primary).toMatch(/^rgba\(/);
      expect(LIGHT_THEME.glowColors.active).toMatch(/^rgba\(/);
    });
  });

  // ============================================================================
  // WCAG AA Contrast Tests — required by issue #633
  // These are pure-function tests; no DOM required.
  // ============================================================================

  describe('WCAG AA contrast — dark theme node colors vs background', () => {
    const bg = DARK_THEME.background;

    // WCAG AA for normal-size text: 4.5:1
    // WCAG AA for large text / UI components: 3:1
    // Node colors are used as border/accent colors against the canvas bg.
    // We require ≥4.5:1 for node type colors (they appear as labels too).
    const NORMAL_TEXT_THRESHOLD = 4.5;

    const entityTypes: EntityType[] = [
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

    entityTypes.forEach((entityType) => {
      it(`${entityType} node color meets WCAG AA (≥${NORMAL_TEXT_THRESHOLD}:1) vs dark bg`, () => {
        const nodeColor = DARK_THEME.nodeColors[entityType];
        const ratio = contrastRatio(nodeColor, bg);
        expect(ratio).toBeGreaterThanOrEqual(NORMAL_TEXT_THRESHOLD);
      });
    });
  });

  describe('WCAG AA contrast — dark theme severity colors vs background', () => {
    const bg = DARK_THEME.background;
    const THRESHOLD = 4.5;

    const severities: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

    severities.forEach((severity) => {
      it(`${severity} severity color meets WCAG AA (≥${THRESHOLD}:1) vs dark bg`, () => {
        const color = DARK_THEME.severityColors[severity];
        const ratio = contrastRatio(color, bg);
        expect(ratio).toBeGreaterThanOrEqual(THRESHOLD);
      });
    });
  });

  describe('Node types are mutually distinguishable in dark theme', () => {
    // Requirement: key node type pairs must differ in perceived hue/lightness
    // enough that they are not identical. We assert that the hex strings differ
    // (same color → obvious confusion). For a stronger check we also verify
    // that the luminance difference between selected pairs is > 0.01.
    it('mission and domain are not the same color', () => {
      expect(DARK_THEME.nodeColors.mission).not.toBe(DARK_THEME.nodeColors.domain);
    });

    it('finding and evidence are not the same color', () => {
      expect(DARK_THEME.nodeColors.finding).not.toBe(DARK_THEME.nodeColors.evidence);
    });

    it('host and service are not the same color', () => {
      expect(DARK_THEME.nodeColors.host).not.toBe(DARK_THEME.nodeColors.service);
    });

    it('agent_run and llm_call are not the same color', () => {
      expect(DARK_THEME.nodeColors.agent_run).not.toBe(DARK_THEME.nodeColors.llm_call);
    });

    it('mission and finding have a luminance difference > 0.01', () => {
      const diff = Math.abs(
        hexLuminance(DARK_THEME.nodeColors.mission) -
        hexLuminance(DARK_THEME.nodeColors.finding)
      );
      expect(diff).toBeGreaterThan(0.01);
    });

    it('domain and host have a luminance difference > 0.01', () => {
      const diff = Math.abs(
        hexLuminance(DARK_THEME.nodeColors.domain) -
        hexLuminance(DARK_THEME.nodeColors.host)
      );
      expect(diff).toBeGreaterThan(0.01);
    });
  });

  describe('WCAG AA contrast — light theme node colors vs background', () => {
    const bg = LIGHT_THEME.background;
    const THRESHOLD = 4.5;

    const entityTypes: EntityType[] = [
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

    entityTypes.forEach((entityType) => {
      it(`${entityType} node color meets WCAG AA (≥${THRESHOLD}:1) vs light bg`, () => {
        const nodeColor = LIGHT_THEME.nodeColors[entityType];
        const ratio = contrastRatio(nodeColor, bg);
        expect(ratio).toBeGreaterThanOrEqual(THRESHOLD);
      });
    });
  });
});
