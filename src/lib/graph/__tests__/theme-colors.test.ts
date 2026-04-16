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

    it('should have valid background color', () => {
      expect(DARK_THEME.background).toMatch(/^#[0-9a-f]{6}$/i);
      expect(DARK_THEME.background).toBe('#0a0a08');
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
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
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

      // Both should have same relationship type keys
      expect(Object.keys(DARK_THEME.edgeColors).sort()).toEqual(
        Object.keys(LIGHT_THEME.edgeColors).sort()
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
});
