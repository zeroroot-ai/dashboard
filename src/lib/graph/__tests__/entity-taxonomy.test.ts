import { describe, it, expect } from 'vitest';
import {
  getEntityColor,
  getRelationshipDashPattern,
  getSeverityColor,
  parseEntityType,
  getAllEntityTypes,
  getAllRelationshipTypes,
  DASH_PATTERN_VALUES,
  type EntityType,
  type RelationshipType,
  type Severity,
  type DashPattern,
} from '../entity-taxonomy';

describe('entity-taxonomy', () => {
  describe('getEntityColor', () => {
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

    it('should return valid colors for all 16 entity types in dark theme', () => {
      allEntityTypes.forEach((entityType) => {
        const color = getEntityColor(entityType, 'dark');

        // Should return a hex color string
        expect(color).toBeDefined();
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    it('should return valid colors for all 16 entity types in light theme', () => {
      allEntityTypes.forEach((entityType) => {
        const color = getEntityColor(entityType, 'light');

        // Should return a hex color string
        expect(color).toBeDefined();
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    it('should return different colors for dark vs light theme', () => {
      // Test a few key entity types
      const testTypes: EntityType[] = ['mission', 'domain', 'finding'];

      testTypes.forEach((entityType) => {
        const darkColor = getEntityColor(entityType, 'dark');
        const lightColor = getEntityColor(entityType, 'light');

        // Colors should be different between themes
        expect(darkColor).not.toBe(lightColor);
      });
    });

    it('should return expected colors for specific entity types', () => {
      // Dark theme samples
      expect(getEntityColor('mission', 'dark')).toBe('#ffb000');
      expect(getEntityColor('domain', 'dark')).toBe('#00bfff');
      expect(getEntityColor('finding', 'dark')).toBe('#ff6b6b');

      // Light theme samples
      expect(getEntityColor('mission', 'light')).toBe('#b8860b');
      expect(getEntityColor('domain', 'light')).toBe('#0077b6');
      expect(getEntityColor('finding', 'light')).toBe('#c62828');
    });
  });

  describe('getRelationshipDashPattern', () => {
    const allRelationshipTypes: RelationshipType[] = [
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
      'PART_OF',
      'EXECUTES',
    ];

    it('should return valid dash patterns for all 17 relationship types', () => {
      allRelationshipTypes.forEach((relationshipType) => {
        const result = getRelationshipDashPattern(relationshipType);

        // Should return object with pattern and dashArray
        expect(result).toBeDefined();
        expect(result.pattern).toBeDefined();
        expect(result.dashArray).toBeDefined();
        expect(Array.isArray(result.dashArray)).toBe(true);

        // Pattern should be one of the valid types
        expect(['solid', 'short-dash', 'long-dash', 'dot-dash']).toContain(result.pattern);
      });
    });

    it('should map structural relationships to solid pattern', () => {
      const structuralRelationships: RelationshipType[] = [
        'HAS_SUBDOMAIN',
        'HAS_PORT',
        'RUNS_SERVICE',
        'HAS_ENDPOINT',
        'HAS_EVIDENCE',
      ];

      structuralRelationships.forEach((relType) => {
        const result = getRelationshipDashPattern(relType);
        expect(result.pattern).toBe('solid');
        expect(result.dashArray).toEqual([]);
      });
    });

    it('should map discovery relationships to short-dash pattern', () => {
      const discoveryRelationships: RelationshipType[] = [
        'DISCOVERED',
        'AFFECTS',
        'BELONGS_TO',
        'RESOLVES_TO',
      ];

      discoveryRelationships.forEach((relType) => {
        const result = getRelationshipDashPattern(relType);
        expect(result.pattern).toBe('short-dash');
        expect(result.dashArray).toEqual([4, 4]);
      });
    });

    it('should map execution relationships to long-dash pattern', () => {
      const executionRelationships: RelationshipType[] = [
        'USED_TOOL',
        'DELEGATED_TO',
      ];

      executionRelationships.forEach((relType) => {
        const result = getRelationshipDashPattern(relType);
        expect(result.pattern).toBe('long-dash');
        expect(result.dashArray).toEqual([12, 6]);
      });
    });

    it('should map cross-entity relationships to dot-dash pattern', () => {
      const crossEntityRelationships: RelationshipType[] = [
        'USES_TECHNOLOGY',
        'SERVES_CERTIFICATE',
        'USES_TECHNIQUE',
        'LEADS_TO',
        'PART_OF',
        'EXECUTES',
      ];

      crossEntityRelationships.forEach((relType) => {
        const result = getRelationshipDashPattern(relType);
        expect(result.pattern).toBe('dot-dash');
        expect(result.dashArray).toEqual([2, 4, 8, 4]);
      });
    });
  });

  describe('DASH_PATTERN_VALUES', () => {
    it('should define all 4 dash patterns', () => {
      const patterns: DashPattern[] = ['solid', 'short-dash', 'long-dash', 'dot-dash'];

      patterns.forEach((pattern) => {
        expect(DASH_PATTERN_VALUES[pattern]).toBeDefined();
        expect(Array.isArray(DASH_PATTERN_VALUES[pattern])).toBe(true);
      });
    });

    it('should have correct dash array values', () => {
      expect(DASH_PATTERN_VALUES.solid).toEqual([]);
      expect(DASH_PATTERN_VALUES['short-dash']).toEqual([4, 4]);
      expect(DASH_PATTERN_VALUES['long-dash']).toEqual([12, 6]);
      expect(DASH_PATTERN_VALUES['dot-dash']).toEqual([2, 4, 8, 4]);
    });
  });

  describe('getSeverityColor', () => {
    const allSeverities: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

    it('should return valid colors for all severity levels in dark theme', () => {
      allSeverities.forEach((severity) => {
        const color = getSeverityColor(severity, 'dark');

        // Should return a hex color string
        expect(color).toBeDefined();
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    it('should return valid colors for all severity levels in light theme', () => {
      allSeverities.forEach((severity) => {
        const color = getSeverityColor(severity, 'light');

        // Should return a hex color string
        expect(color).toBeDefined();
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    it('should return expected colors for each severity level', () => {
      // Dark theme
      expect(getSeverityColor('critical', 'dark')).toBe('#ff4444');
      expect(getSeverityColor('high', 'dark')).toBe('#ff8c00');
      expect(getSeverityColor('medium', 'dark')).toBe('#ffb000');
      expect(getSeverityColor('low', 'dark')).toBe('#6b8aab');
      expect(getSeverityColor('info', 'dark')).toBe('#6b7280');

      // Light theme
      expect(getSeverityColor('critical', 'light')).toBe('#c82828');
      expect(getSeverityColor('high', 'light')).toBe('#d35400');
      expect(getSeverityColor('medium', 'light')).toBe('#b8860b');
      expect(getSeverityColor('low', 'light')).toBe('#4a6fa5');
      expect(getSeverityColor('info', 'light')).toBe('#6b7280');
    });

    it('should return different colors for dark vs light theme (except info)', () => {
      const testSeverities: Severity[] = ['critical', 'high', 'medium', 'low'];

      testSeverities.forEach((severity) => {
        const darkColor = getSeverityColor(severity, 'dark');
        const lightColor = getSeverityColor(severity, 'light');

        // Colors should be different between themes
        expect(darkColor).not.toBe(lightColor);
      });

      // Info color is the same in both themes
      expect(getSeverityColor('info', 'dark')).toBe(getSeverityColor('info', 'light'));
    });
  });

  describe('parseEntityType', () => {
    it('should parse exact lowercase entity type from labels', () => {
      expect(parseEntityType(['mission'])).toBe('mission');
      expect(parseEntityType(['domain'])).toBe('domain');
      expect(parseEntityType(['finding'])).toBe('finding');
    });

    it('should parse entity type with mixed case', () => {
      expect(parseEntityType(['Mission'])).toBe('mission');
      expect(parseEntityType(['DOMAIN'])).toBe('domain');
      expect(parseEntityType(['Finding'])).toBe('finding');
    });

    it('should parse entity type with underscores', () => {
      expect(parseEntityType(['mission_run'])).toBe('mission_run');
      expect(parseEntityType(['agent_run'])).toBe('agent_run');
      expect(parseEntityType(['tool_execution'])).toBe('tool_execution');
    });

    it('should parse entity type with spaces (normalized to underscores)', () => {
      expect(parseEntityType(['mission run'])).toBe('mission_run');
      expect(parseEntityType(['agent run'])).toBe('agent_run');
      expect(parseEntityType(['tool execution'])).toBe('tool_execution');
    });

    it('should return first matching entity type from multiple labels', () => {
      expect(parseEntityType(['Active', 'Mission', 'Running'])).toBe('mission');
      expect(parseEntityType(['Node', 'Domain', 'DNS'])).toBe('domain');
    });

    it('should prioritize earlier labels when multiple entity types present', () => {
      // 'mission' appears before 'domain', should return 'mission'
      expect(parseEntityType(['mission', 'domain'])).toBe('mission');

      // 'host' appears before 'domain', should return 'host'
      expect(parseEntityType(['host', 'domain'])).toBe('host');
    });

    it('should return "host" as default for unrecognized labels', () => {
      expect(parseEntityType(['Unknown'])).toBe('host');
      expect(parseEntityType(['CustomType'])).toBe('host');
      expect(parseEntityType(['RandomLabel'])).toBe('host');
      expect(parseEntityType([])).toBe('host');
    });

    it('should handle edge cases', () => {
      // Empty array
      expect(parseEntityType([])).toBe('host');

      // Array with empty strings
      expect(parseEntityType(['', '', ''])).toBe('host');

      // Array with non-matching labels
      expect(parseEntityType(['foo', 'bar', 'baz'])).toBe('host');
    });

    it('should handle all valid entity types', () => {
      const validTypes: EntityType[] = [
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

      validTypes.forEach((entityType) => {
        expect(parseEntityType([entityType])).toBe(entityType);
      });
    });
  });

  describe('getAllEntityTypes', () => {
    it('should return array of all 16 entity types', () => {
      const allTypes = getAllEntityTypes();

      expect(Array.isArray(allTypes)).toBe(true);
      expect(allTypes.length).toBe(16);
    });

    it('should include all expected entity types', () => {
      const allTypes = getAllEntityTypes();

      const expectedTypes: EntityType[] = [
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

      expectedTypes.forEach((type) => {
        expect(allTypes).toContain(type);
      });
    });
  });

  describe('getAllRelationshipTypes', () => {
    it('should return array of all 17 relationship types', () => {
      const allTypes = getAllRelationshipTypes();

      expect(Array.isArray(allTypes)).toBe(true);
      expect(allTypes.length).toBe(17);
    });

    it('should include all expected relationship types', () => {
      const allTypes = getAllRelationshipTypes();

      const expectedTypes: RelationshipType[] = [
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
        'PART_OF',
        'EXECUTES',
      ];

      expectedTypes.forEach((type) => {
        expect(allTypes).toContain(type);
      });
    });
  });
});
