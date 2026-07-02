import { describe, it, expect } from 'vitest';
import { timelineBounds, filterByTime } from '../timeline';
import type { GraphNode, GraphEdge } from '@/src/types/graph';

function node(id: string, createdAt?: number): GraphNode {
  return { id, labels: ['Host'], properties: createdAt != null ? { createdAt } : {} };
}
function edge(id: string, s: string, t: string): GraphEdge {
  return { id, type: 'CONTAINS', source: s, target: t, properties: {} };
}

const NODES = [node('a', 1000), node('b', 2000), node('c', 3000), node('anchor')];
const EDGES = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'anchor', 'a')];

describe('timelineBounds', () => {
  it('returns the min/max timestamp present', () => {
    expect(timelineBounds(NODES)).toEqual({ min: 1000, max: 3000 });
  });
  it('returns null when no node has a timestamp', () => {
    expect(timelineBounds([node('x')])).toBeNull();
  });
});

describe('filterByTime', () => {
  it('reveals nodes up to the cutoff (plus timeless anchors)', () => {
    const r = filterByTime(NODES, EDGES, 2000);
    // a(1000), b(2000) in; c(3000) out; anchor (timeless) always in
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'anchor', 'b']);
  });
  it('keeps only edges between visible nodes', () => {
    const r = filterByTime(NODES, EDGES, 1000);
    // visible: a, anchor → only e3 (anchor-a) survives
    expect(r.edges.map((e) => e.id)).toEqual(['e3']);
  });
  it('at max cutoff the whole graph is visible', () => {
    const r = filterByTime(NODES, EDGES, 3000);
    expect(r.nodes).toHaveLength(4);
    expect(r.edges).toHaveLength(3);
  });
});
