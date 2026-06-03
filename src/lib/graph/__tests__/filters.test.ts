/**
 * Graph filter tests — behavioral assertions on the visible subset.
 */

import { describe, it, expect } from 'vitest';
import {
  applyGraphFilters,
  availableNodeTypes,
  availableRelationshipTypes,
  DEFAULT_GRAPH_FILTERS,
  type GraphFilterState,
} from '../filters';
import type { GraphNode, GraphEdge } from '@/src/types/graph';

function node(id: string, label: string, properties: Record<string, unknown> = {}): GraphNode {
  return { id, labels: [label], properties };
}
function edge(id: string, type: string, source: string, target: string): GraphEdge {
  return { id, type, source, target, properties: {} };
}

// mission → host → finding(high); plus a service off the host
const NODES = [
  node('m', 'Mission'),
  node('h', 'Host'),
  node('f', 'Finding', { severity: 'high' }),
  node('s', 'Service'),
];
const EDGES = [
  edge('e1', 'CONTAINS', 'm', 'h'),
  edge('e2', 'AFFECTS', 'h', 'f'),
  edge('e3', 'RUNS_SERVICE', 'h', 's'),
];

function withFilters(p: Partial<GraphFilterState>): GraphFilterState {
  return { ...DEFAULT_GRAPH_FILTERS, ...p };
}

describe('availableNodeTypes / availableRelationshipTypes', () => {
  it('reports the distinct types present, sorted', () => {
    expect(availableNodeTypes(NODES)).toEqual(['finding', 'host', 'mission', 'service']);
    expect(availableRelationshipTypes(EDGES)).toEqual(['AFFECTS', 'CONTAINS', 'RUNS_SERVICE']);
  });
});

describe('applyGraphFilters', () => {
  it('default filters are the identity (everything visible)', () => {
    const r = applyGraphFilters(NODES, EDGES, DEFAULT_GRAPH_FILTERS);
    expect(r.nodes).toHaveLength(4);
    expect(r.edges).toHaveLength(3);
  });

  it('hiding a node type removes those nodes and their edges', () => {
    const r = applyGraphFilters(NODES, EDGES, withFilters({ hiddenNodeTypes: ['service'] }));
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['f', 'h', 'm']);
    // the RUNS_SERVICE edge to the removed service is gone
    expect(r.edges.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('hiding a relationship type drops those edges only', () => {
    const r = applyGraphFilters(NODES, EDGES, withFilters({ hiddenRelationshipTypes: ['AFFECTS'] }));
    expect(r.nodes).toHaveLength(4); // nodes stay
    expect(r.edges.map((e) => e.id).sort()).toEqual(['e1', 'e3']);
  });

  it('severity floor hides findings below the threshold', () => {
    const nodes = [node('f1', 'Finding', { severity: 'low' }), node('f2', 'Finding', { severity: 'critical' })];
    const r = applyGraphFilters(nodes, [], withFilters({ severityFloor: 'high' }));
    expect(r.nodes.map((n) => n.id)).toEqual(['f2']);
  });

  it('severity floor does not affect non-finding nodes', () => {
    const r = applyGraphFilters(NODES, EDGES, withFilters({ severityFloor: 'critical' }));
    // host/mission/service remain; only the 'high' finding is dropped
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['h', 'm', 's']);
  });

  it('depth limits hops from the mission root', () => {
    // depth 1 from mission keeps mission + its direct neighbor (host) only
    const r = applyGraphFilters(NODES, EDGES, withFilters({ depth: 1 }));
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['h', 'm']);
    // depth 2 reaches finding + service
    const r2 = applyGraphFilters(NODES, EDGES, withFilters({ depth: 2 }));
    expect(r2.nodes.map((n) => n.id).sort()).toEqual(['f', 'h', 'm', 's']);
  });
});
