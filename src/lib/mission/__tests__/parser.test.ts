/**
 * Mission YAML Parser Tests
 *
 * Unit tests for YAML parsing and serialization utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  parseYAML,
  serializeYAML,
  yamlToState,
  stateToYAML,
  mergeChangesIntoYAML,
  extractYAMLSection,
} from '../parser';

// Helper to parse YAML with a permissive record type for tests
function parseYAMLAsRecord(yaml: string) {
  return parseYAML<Record<string, unknown>>(yaml);
}

describe('parseYAML', () => {
  it('should parse valid YAML', () => {
    const yaml = `
name: test-mission
description: A test mission
tags:
  - security
  - api
`;
    const result = parseYAMLAsRecord(yaml);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.name).toBe('test-mission');
    expect(result.data?.description).toBe('A test mission');
    expect(result.data?.tags).toEqual(['security', 'api']);
  });

  it('should return error for invalid YAML', () => {
    const yaml = `
name: test
  invalid-indent: value
`;
    const result = parseYAML(yaml);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should handle empty YAML', () => {
    const result = parseYAML('');

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it('should parse nested structures', () => {
    const yaml = `
scope:
  seeds:
    - https://example.com
  include:
    - "*.example.com/*"
  maxDepth: 5
`;
    const result = parseYAMLAsRecord(yaml);

    expect(result.success).toBe(true);
    const scope = result.data?.scope as Record<string, unknown> | undefined;
    expect((scope?.seeds as string[] | undefined)).toContain('https://example.com');
    expect(scope?.maxDepth).toBe(5);
  });
});

describe('serializeYAML', () => {
  it('should serialize object to YAML', () => {
    const data = {
      name: 'test-mission',
      description: 'A test mission',
      tags: ['security', 'api'],
    };

    const yaml = serializeYAML(data);

    expect(yaml).toContain('name: test-mission');
    expect(yaml).toContain('description: A test mission');
    expect(yaml).toContain('- security');
    expect(yaml).toContain('- api');
  });

  it('should handle nested objects', () => {
    const data = {
      scope: {
        seeds: ['https://example.com'],
        maxDepth: 3,
      },
    };

    const yaml = serializeYAML(data);

    expect(yaml).toContain('scope:');
    expect(yaml).toContain('seeds:');
    expect(yaml).toContain('- https://example.com');
    expect(yaml).toContain('maxDepth: 3');
  });

  it('should handle empty objects', () => {
    const yaml = serializeYAML({});
    expect(yaml).toBe('{}');
  });

  it('should use specified indentation', () => {
    const data = {
      scope: {
        seeds: ['test'],
      },
    };

    const yaml = serializeYAML(data, { indent: 4 });
    expect(yaml).toContain('    seeds:');
  });
});

describe('yamlToState', () => {
  it('should convert YAML to mission state', () => {
    const yaml = `
name: my-mission
description: Description here
tags:
  - tag1
  - tag2
priority: high

scope:
  seeds:
    - https://example.com
  expansionMode: subdomain
  maxDepth: 3

guardrails:
  maxTokensPerCall: 50000
  maxTotalTokens: 500000
`;

    const result = yamlToState(yaml);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.metadata?.name).toBe('my-mission');
    expect(result.data?.metadata?.tags).toEqual(['tag1', 'tag2']);
    expect(result.data?.metadata?.priority).toBe('high');
    expect(result.data?.scope?.expansionMode).toBe('subdomain');
    expect(result.data?.guardrails?.maxTokensPerCall).toBe(50000);
  });

  it('should handle mission steps', () => {
    const yaml = `
name: mission-test
mission:
  - agent: recon-agent
    task: Perform reconnaissance
  - agent: vulnerability-scanner
    task: Scan for vulnerabilities
`;

    const result = yamlToState(yaml);

    expect(result.success).toBe(true);
    expect(result.data?.mission?.steps).toHaveLength(2);
  });

  it('should return error for invalid YAML', () => {
    const yaml = `
name: test
  bad-indent: value
`;

    const result = yamlToState(yaml);
    expect(result.success).toBe(false);
  });

  it('should handle partial/minimal YAML', () => {
    const yaml = 'name: minimal-mission';

    const result = yamlToState(yaml);

    expect(result.success).toBe(true);
    expect(result.data?.metadata?.name).toBe('minimal-mission');
  });
});

describe('stateToYAML', () => {
  it('should convert state to YAML', () => {
    const state = {
      metadata: {
        name: 'test-mission',
        description: 'Test description',
        tags: ['tag1'],
        priority: 'normal' as const,
        maxDuration: null,
        maxCost: null,
        severityThreshold: null,
        reportFormats: ['json' as const],
      },
      scope: {
        seeds: [
          { id: '1', type: 'url' as const, value: 'https://example.com', isValid: true },
        ],
        include: [],
        exclude: [],
        maxDepth: 3,
        expansionMode: 'strict' as const,
        followRedirects: true,
      },
    };

    const yaml = stateToYAML(state);

    expect(yaml).toContain('name: test-mission');
    expect(yaml).toContain('description: Test description');
    expect(yaml).toContain('- tag1');
    expect(yaml).toContain('https://example.com');
  });

  it('should exclude empty sections', () => {
    const state = {
      metadata: {
        name: 'minimal',
        description: '',
        tags: [],
        priority: 'normal' as const,
        maxDuration: null,
        maxCost: null,
        severityThreshold: null,
        reportFormats: [],
      },
    };

    const yaml = stateToYAML(state);

    expect(yaml).toContain('name: minimal');
    // Empty tags should not create empty array
  });

  it('should handle mission steps', () => {
    const state = {
      metadata: {
        name: 'mission-test',
        description: '',
        tags: [],
        priority: 'normal' as const,
        maxDuration: null,
        maxCost: null,
        severityThreshold: null,
        reportFormats: [],
      },
      mission: {
        steps: [
          {
            id: 'step-1',
            name: 'Recon',
            type: 'agent' as const,
            config: { type: 'agent' as const, agentId: 'recon-agent', task: 'Scan target' },
          },
        ],
        errorHandling: 'continue' as const,
      },
    };

    const yaml = stateToYAML(state);

    expect(yaml).toContain('mission:');
    expect(yaml).toContain('agent: recon-agent');
    expect(yaml).toContain('task: Scan target');
  });
});

describe('mergeChangesIntoYAML', () => {
  it('should merge partial changes into existing YAML', () => {
    const originalYaml = `
name: original-name
description: Original description
tags:
  - tag1
`;

    const changes = {
      name: 'new-name',
    };

    const result = mergeChangesIntoYAML(originalYaml, changes);

    expect(result.success).toBe(true);
    expect(result.yaml).toContain('new-name');
    // Should preserve other fields
    expect(result.yaml).toContain('description');
    expect(result.yaml).toContain('tag1');
  });

  it('should add new fields', () => {
    const originalYaml = 'name: test';

    const changes = {
      description: 'New description',
    };

    const result = mergeChangesIntoYAML(originalYaml, changes);

    expect(result.success).toBe(true);
    expect(result.yaml).toContain('name: test');
    expect(result.yaml).toContain('description: New description');
  });

  it('should handle nested changes', () => {
    const originalYaml = `
name: test
scope:
  seeds:
    - https://example.com
  maxDepth: 3
`;

    const changes = {
      scope: {
        maxDepth: 5,
      },
    };

    const result = mergeChangesIntoYAML(originalYaml, changes);

    expect(result.success).toBe(true);
    expect(result.yaml).toContain('maxDepth: 5');
    // Should preserve seeds
    expect(result.yaml).toContain('https://example.com');
  });

  it('should handle invalid original YAML', () => {
    const originalYaml = `
name: test
  bad: indent
`;

    const changes = { name: 'new' };
    const result = mergeChangesIntoYAML(originalYaml, changes);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('extractYAMLSection', () => {
  it('should extract a specific section', () => {
    const yaml = `
name: test
scope:
  seeds:
    - https://example.com
  maxDepth: 3
guardrails:
  maxTokens: 100000
`;

    const scopeSection = extractYAMLSection(yaml, 'scope');

    expect(scopeSection).toBeDefined();
    expect(scopeSection?.seeds).toContain('https://example.com');
    expect(scopeSection?.maxDepth).toBe(3);
  });

  it('should return undefined for missing section', () => {
    const yaml = 'name: test';

    const result = extractYAMLSection(yaml, 'scope');

    expect(result).toBeUndefined();
  });

  it('should handle nested path', () => {
    const yaml = `
guardrails:
  rateLimits:
    requestsPerMinute: 60
    requestsPerHour: 1000
`;

    // Note: This tests the specific path extraction if implemented
    const guardrails = extractYAMLSection(yaml, 'guardrails');
    const rateLimits = guardrails?.rateLimits as Record<string, unknown> | undefined;

    expect(guardrails).toBeDefined();
    expect(rateLimits?.requestsPerMinute).toBe(60);
  });
});

describe('Round-trip conversion', () => {
  it('should maintain data integrity through parse-serialize cycle', () => {
    const originalData = {
      name: 'round-trip-test',
      description: 'Testing round-trip',
      tags: ['tag1', 'tag2'],
      scope: {
        seeds: ['https://example.com'],
        maxDepth: 5,
      },
      guardrails: {
        maxTokensPerCall: 50000,
      },
    };

    const yaml = serializeYAML(originalData);
    const parsed = parseYAMLAsRecord(yaml);

    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBe(originalData.name);
    expect(parsed.data?.description).toBe(originalData.description);
    expect(parsed.data?.tags).toEqual(originalData.tags);
    const parsedScope = parsed.data?.scope as Record<string, unknown> | undefined;
    expect(parsedScope?.maxDepth).toBe(originalData.scope.maxDepth);
  });

  it('should maintain state through state-yaml-state cycle', () => {
    const originalState = {
      metadata: {
        name: 'cycle-test',
        description: 'Testing cycle',
        tags: ['test'],
        priority: 'high' as const,
        maxDuration: 3600,
        maxCost: null,
        severityThreshold: 'medium' as const,
        reportFormats: ['json' as const, 'html' as const],
      },
      scope: {
        seeds: [
          { id: '1', type: 'url' as const, value: 'https://test.com', isValid: true },
        ],
        include: [],
        exclude: [],
        maxDepth: 4,
        expansionMode: 'subdomain' as const,
        followRedirects: true,
      },
    };

    const yaml = stateToYAML(originalState);
    const parsed = yamlToState(yaml);

    expect(parsed.success).toBe(true);
    expect(parsed.data?.metadata?.name).toBe(originalState.metadata.name);
    expect(parsed.data?.metadata?.priority).toBe(originalState.metadata.priority);
    expect(parsed.data?.scope?.maxDepth).toBe(originalState.scope.maxDepth);
  });
});
