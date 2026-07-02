import { describe, it, expect } from 'vitest';
import { toGraphExportJSON } from '../export';
import type { GraphNode, GraphEdge } from '@/src/types/graph';

const NODES: GraphNode[] = [
  { id: 'a', labels: ['Host'], properties: { name: 'web-01', ip: '10.0.0.1' } },
  { id: 'b', labels: ['Finding'], properties: { severity: 'high' } },
];
const EDGES: GraphEdge[] = [
  { id: 'e1', type: 'AFFECTS', source: 'a', target: 'b', properties: {} },
];

describe('toGraphExportJSON', () => {
  it('serializes exactly the given (visible) nodes and edges', () => {
    const out = toGraphExportJSON(NODES, EDGES, '2026-01-01T00:00:00.000Z');
    expect(out.exportedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(out.nodeCount).toBe(2);
    expect(out.edgeCount).toBe(1);
    expect(out.nodes).toEqual([
      { id: 'a', labels: ['Host'], properties: { name: 'web-01', ip: '10.0.0.1' } },
      { id: 'b', labels: ['Finding'], properties: { severity: 'high' } },
    ]);
    expect(out.edges).toEqual([
      { id: 'e1', type: 'AFFECTS', source: 'a', target: 'b', properties: {} },
    ]);
  });

  it('round-trips through JSON.stringify/parse', () => {
    const out = toGraphExportJSON(NODES, EDGES, 'x');
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it('handles an empty view', () => {
    const out = toGraphExportJSON([], [], 'x');
    expect(out.nodeCount).toBe(0);
    expect(out.edges).toEqual([]);
  });
});
