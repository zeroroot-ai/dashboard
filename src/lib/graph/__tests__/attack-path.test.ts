import { describe, it, expect } from 'vitest';
import { attackPathSets, ATTACK_RELATIONSHIPS } from '../attack-path';
import type { GraphEdge } from '@/src/types/graph';

function edge(id: string, type: string, s: string, t: string): GraphEdge {
  return { id, type, source: s, target: t, properties: {} };
}

describe('attackPathSets', () => {
  it('selects only attack-relationship edges and their endpoints', () => {
    const edges = [
      edge('e1', 'CONTAINS', 'host', 'svc'),
      edge('e2', 'EXPLOITS', 'attacker', 'host'),
      edge('e3', 'LEADS_TO', 'host', 'db'),
      edge('e4', 'RUNS_SERVICE', 'host', 'svc'),
    ];
    const r = attackPathSets(edges);
    expect(r.edge_ids.sort()).toEqual(['e2', 'e3']);
    expect(r.node_ids.sort()).toEqual(['attacker', 'db', 'host']);
  });

  it('returns empty sets when there are no attack edges', () => {
    const r = attackPathSets([edge('e1', 'CONTAINS', 'a', 'b')]);
    expect(r.edge_ids).toEqual([]);
    expect(r.node_ids).toEqual([]);
  });

  it('recognizes the documented attack relationship types', () => {
    for (const t of ATTACK_RELATIONSHIPS) {
      const r = attackPathSets([edge('x', t, 'a', 'b')]);
      expect(r.edge_ids).toEqual(['x']);
    }
  });
});
