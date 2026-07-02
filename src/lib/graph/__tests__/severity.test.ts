import { describe, it, expect } from 'vitest';
import { severityWeight, nodeSeverity, SEVERITY_LEVELS } from '../severity';
import type { GraphNode } from '@/src/types/graph';

function node(labels: string[], properties: Record<string, unknown> = {}): GraphNode {
  return { id: 'n', labels, properties };
}

describe('severityWeight', () => {
  it('ranks critical highest and info lowest', () => {
    expect(severityWeight('critical')).toBe(1);
    expect(severityWeight('info')).toBeLessThan(severityWeight('high'));
    expect(severityWeight('critical')).toBeGreaterThan(severityWeight('medium'));
  });
  it('is case-insensitive and 0 for unknown/empty', () => {
    expect(severityWeight('HIGH')).toBe(severityWeight('high'));
    expect(severityWeight('bogus')).toBe(0);
    expect(severityWeight(null)).toBe(0);
    expect(severityWeight(undefined)).toBe(0);
  });
  it('weights increase monotonically by level (info→critical)', () => {
    const ascending = [...SEVERITY_LEVELS].reverse().map(severityWeight);
    for (let i = 1; i < ascending.length; i++) {
      expect(ascending[i]).toBeGreaterThan(ascending[i - 1]);
    }
  });
});

describe('nodeSeverity', () => {
  it('returns severity only for finding nodes', () => {
    expect(nodeSeverity(node(['Finding'], { severity: 'high' }))).toBe('high');
    expect(nodeSeverity(node(['Host'], { severity: 'high' }))).toBeNull();
  });
  it('returns null for findings without a recognized severity', () => {
    expect(nodeSeverity(node(['Finding'], {}))).toBeNull();
    expect(nodeSeverity(node(['Finding'], { severity: 'whatever' }))).toBeNull();
  });
  it('is case-insensitive', () => {
    expect(nodeSeverity(node(['Finding'], { severity: 'CRITICAL' }))).toBe('critical');
  });
});
