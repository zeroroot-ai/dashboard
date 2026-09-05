import { describe, it, expect } from 'vitest';
import {
  worldToGraph,
  type WorldGraphHost,
  type WorldGraphFinding,
} from '@/components/gibson/brain/WorldGraph';

const host = (scopeId: string, address: string): WorldGraphHost => ({
  scopeId,
  address,
  openPorts: [22, 443],
  juicy: 0.7,
  attention: 0.5,
  surprise: '',
});

const finding = (
  id: string,
  scopeId: string,
  address: string,
): WorldGraphFinding => ({
  id,
  title: `finding ${id}`,
  scopeId,
  address,
  severity: 'high',
});

describe('worldToGraph', () => {
  it('emits a node per mission, host, and finding', () => {
    const { nodes } = worldToGraph(
      [{ id: 'm1', goal: 'pwn', status: 'running', reason: '' }],
      [host('s1', '10.0.0.1')],
      [finding('f1', 's1', '10.0.0.1')],
    );
    expect(nodes.map((n) => n.id).sort()).toEqual([
      'finding:f1',
      'host:s1/10.0.0.1',
      'mission:m1',
    ]);
  });

  it('links a finding to the host it affects (same scope + address)', () => {
    const { edges } = worldToGraph(
      [],
      [host('s1', '10.0.0.1')],
      [finding('f1', 's1', '10.0.0.1')],
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: 'AFFECTS',
      source: 'finding:f1',
      target: 'host:s1/10.0.0.1',
    });
  });

  it('does not link a finding when its host is absent in the frame', () => {
    // Replay frame folded before the host was observed: no dangling edge.
    const { edges } = worldToGraph([], [], [finding('f1', 's1', '10.0.0.1')]);
    expect(edges).toHaveLength(0);
  });

  it('does not cross scopes: same address in a different scope is a different host', () => {
    const { edges } = worldToGraph(
      [],
      [host('s2', '10.0.0.1')],
      [finding('f1', 's1', '10.0.0.1')],
    );
    expect(edges).toHaveLength(0);
  });
});
