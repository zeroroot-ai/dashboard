/**
 * Layout engine tests.
 *
 * Asserts the external behavior of the pure layout functions on fixture graphs:
 * deterministic positions with the sane invariants each mode promises.
 */

import { describe, it, expect } from 'vitest';
import { computeLayout, computeDepths, getNodeTimestamp } from '../layout-engine';
import type { GraphNode, GraphEdge } from '@/src/types/graph';

function node(id: string, properties: Record<string, unknown> = {}): GraphNode {
  return { id, labels: ['Host'], properties };
}
function edge(id: string, source: string, target: string): GraphEdge {
  return { id, type: 'CONTAINS', source, target, properties: {} };
}

// A small DAG:  a → b, a → c, b → d
const NODES = [node('a'), node('b'), node('c'), node('d')];
const EDGES = [edge('e1', 'a', 'b'), edge('e2', 'a', 'c'), edge('e3', 'b', 'd')];

describe('computeDepths', () => {
  it('assigns root depth 0 and longest-path depth to descendants', () => {
    const d = computeDepths(NODES, EDGES);
    expect(d.get('a')).toBe(0);
    expect(d.get('b')).toBe(1);
    expect(d.get('c')).toBe(1);
    expect(d.get('d')).toBe(2);
  });

  it('does not hang or throw on cycles', () => {
    const cyc = [node('x'), node('y'), node('z')];
    const cycEdges = [edge('1', 'x', 'y'), edge('2', 'y', 'z'), edge('3', 'z', 'x')];
    const d = computeDepths(cyc, cycEdges);
    expect(d.size).toBe(3);
    for (const id of ['x', 'y', 'z']) expect(typeof d.get(id)).toBe('number');
  });
});

describe('computeLayout', () => {
  it('force mode defers to the simulation (null)', () => {
    expect(computeLayout(NODES, EDGES, 'force')).toBeNull();
  });

  it('is deterministic — identical inputs give identical output', () => {
    const a = computeLayout(NODES, EDGES, 'radial')!;
    const b = computeLayout(NODES, EDGES, 'radial')!;
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  describe('hierarchy', () => {
    it('places every child strictly below its parent (larger y)', () => {
      const pos = computeLayout(NODES, EDGES, 'hierarchy')!;
      for (const e of EDGES) {
        expect(pos.get(e.target)!.y).toBeGreaterThan(pos.get(e.source)!.y);
      }
    });
  });

  describe('radial', () => {
    it('places a single root at the center and depth-1 nodes on the first ring', () => {
      const pos = computeLayout(NODES, EDGES, 'radial')!;
      const root = pos.get('a')!;
      expect(Math.hypot(root.x, root.y)).toBeCloseTo(0, 5);
      // b and c are depth 1 → same nonzero radius from the origin
      const rb = Math.hypot(pos.get('b')!.x, pos.get('b')!.y);
      const rc = Math.hypot(pos.get('c')!.x, pos.get('c')!.y);
      expect(rb).toBeGreaterThan(0);
      expect(rb).toBeCloseTo(rc, 5);
      // d is depth 2 → farther out than depth 1
      const rd = Math.hypot(pos.get('d')!.x, pos.get('d')!.y);
      expect(rd).toBeGreaterThan(rb);
    });
  });

  describe('timeline', () => {
    it('orders nodes monotonically by timestamp along x', () => {
      const ts = [
        node('n3', { createdAt: 3000 }),
        node('n1', { createdAt: 1000 }),
        node('n2', { createdAt: 2000 }),
      ];
      const pos = computeLayout(ts, [], 'timeline')!;
      expect(pos.get('n1')!.x).toBeLessThan(pos.get('n2')!.x);
      expect(pos.get('n2')!.x).toBeLessThan(pos.get('n3')!.x);
    });

    it('parses ISO-string timestamps', () => {
      const ts = [
        node('late', { addedAt: '2026-01-02T00:00:00Z' }),
        node('early', { addedAt: '2026-01-01T00:00:00Z' }),
      ];
      const pos = computeLayout(ts, [], 'timeline')!;
      expect(pos.get('early')!.x).toBeLessThan(pos.get('late')!.x);
    });

    it('places timestamped nodes before those without', () => {
      const mixed = [node('none'), node('has', { createdAt: 500 })];
      const pos = computeLayout(mixed, [], 'timeline')!;
      expect(pos.get('has')!.x).toBeLessThan(pos.get('none')!.x);
    });
  });
});

describe('getNodeTimestamp', () => {
  it('returns null when no recognizable field is present', () => {
    expect(getNodeTimestamp(node('x', { foo: 'bar' }))).toBeNull();
  });
  it('reads numeric and ISO-string fields', () => {
    expect(getNodeTimestamp(node('x', { createdAt: 1234 }))).toBe(1234);
    expect(getNodeTimestamp(node('x', { timestamp: '2026-01-01T00:00:00Z' }))).toBe(
      Date.parse('2026-01-01T00:00:00Z')
    );
  });
});
