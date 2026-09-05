import { describe, it, expect } from 'vitest';
import { neighborhood, applyNodeOps, DEFAULT_NODE_OPS, type NodeOpsState } from '../node-ops';
import type { GraphNode, GraphEdge } from '@/src/types/graph';

function node(id: string): GraphNode {
  return { id, labels: ['Host'], properties: {} };
}
function edge(id: string, s: string, t: string): GraphEdge {
  return { id, type: 'CONTAINS', source: s, target: t, properties: {} };
}

// a - b - c - d  (path), plus a - e
const NODES = ['a', 'b', 'c', 'd', 'e'].map(node);
const EDGES = [
  edge('e1', 'a', 'b'),
  edge('e2', 'b', 'c'),
  edge('e3', 'c', 'd'),
  edge('e4', 'a', 'e'),
];

function ops(p: Partial<NodeOpsState>): NodeOpsState {
  return { ...DEFAULT_NODE_OPS, ...p };
}

describe('neighborhood', () => {
  it('depth 0 is just the root', () => {
    expect([...neighborhood(EDGES, 'a', 0)]).toEqual(['a']);
  });
  it('depth 1 is the root + direct neighbors', () => {
    expect([...neighborhood(EDGES, 'a', 1)].sort()).toEqual(['a', 'b', 'e']);
  });
  it('depth 2 reaches two hops', () => {
    expect([...neighborhood(EDGES, 'a', 2)].sort()).toEqual(['a', 'b', 'c', 'e']);
  });
});

describe('applyNodeOps', () => {
  it('default ops are the identity', () => {
    const r = applyNodeOps(NODES, EDGES, DEFAULT_NODE_OPS);
    expect(r.nodes).toHaveLength(5);
    expect(r.edges).toHaveLength(4);
  });

  it('hiding a node drops it and its incident edges', () => {
    const r = applyNodeOps(NODES, EDGES, ops({ hiddenNodeIds: ['b'] }));
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'c', 'd', 'e']);
    expect(r.edges.map((e) => e.id).sort()).toEqual(['e3', 'e4']); // e1,e2 touched b
  });

  it('isolate (focus depth 1) shows only the node + neighbors', () => {
    const r = applyNodeOps(NODES, EDGES, ops({ focusNodeId: 'a', focusDepth: 1 }));
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'e']);
  });

  it('expanding focus depth reveals more hops', () => {
    const r = applyNodeOps(NODES, EDGES, ops({ focusNodeId: 'a', focusDepth: 2 }));
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'e']);
  });

  it('hide composes with focus (hidden node blocks the path)', () => {
    // hiding b severs a→c; focusing a at depth 2 then only reaches e
    const r = applyNodeOps(NODES, EDGES, ops({ hiddenNodeIds: ['b'], focusNodeId: 'a', focusDepth: 2 }));
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['a', 'e']);
  });
});
