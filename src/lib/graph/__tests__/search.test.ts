import { describe, it, expect } from 'vitest';
import { matchNodes, getNodeDisplayName } from '../search';
import type { GraphNode } from '@/src/types/graph';

function node(id: string, name?: string): GraphNode {
  return { id, labels: ['Host'], properties: name ? { name } : {} };
}

const NODES = [
  node('1', 'web-server-01'),
  node('2', 'web-server-02'),
  node('3', 'db-primary'),
  node('host-xyz'), // no name → matches by id
];

describe('getNodeDisplayName', () => {
  it('prefers the name property, falls back to id', () => {
    expect(getNodeDisplayName(node('1', 'alpha'))).toBe('alpha');
    expect(getNodeDisplayName(node('bare'))).toBe('bare');
  });
});

describe('matchNodes', () => {
  it('returns nothing for an empty query', () => {
    expect(matchNodes(NODES, '')).toEqual([]);
    expect(matchNodes(NODES, '   ')).toEqual([]);
  });

  it('matches by name substring, case-insensitive', () => {
    const r = matchNodes(NODES, 'WEB');
    expect(r.map((n) => n.id).sort()).toEqual(['1', '2']);
  });

  it('matches by id when there is no name', () => {
    const r = matchNodes(NODES, 'xyz');
    expect(r.map((n) => n.id)).toEqual(['host-xyz']);
  });

  it('ranks earlier/prefix matches before later ones', () => {
    const nodes = [node('a', 'xx-target'), node('b', 'target-yy')];
    const r = matchNodes(nodes, 'target');
    expect(r[0].id).toBe('b'); // prefix match ranks first
  });

  it('honors the result limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => node(String(i), `svc-${i}`));
    expect(matchNodes(many, 'svc', 5)).toHaveLength(5);
  });
});
