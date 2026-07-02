import { describe, it, expect } from 'vitest';
import { isRunning, runningNodeIds, edgeIsLive } from '../live';
import type { GraphNode, GraphEdge } from '@/src/types/graph';

function node(id: string, status?: string): GraphNode {
  return { id, labels: ['Agent'], properties: status ? { status } : {} };
}
function edge(id: string, s: string, t: string): GraphEdge {
  return { id, type: 'USED_TOOL', source: s, target: t, properties: {} };
}

describe('isRunning', () => {
  it('is true only for running status (case-insensitive)', () => {
    expect(isRunning(node('a', 'running'))).toBe(true);
    expect(isRunning(node('a', 'RUNNING'))).toBe(true);
    expect(isRunning(node('a', 'completed'))).toBe(false);
    expect(isRunning(node('a'))).toBe(false);
  });
});

describe('runningNodeIds', () => {
  it('collects the running node ids', () => {
    const ids = runningNodeIds([node('a', 'running'), node('b', 'completed'), node('c', 'running')]);
    expect([...ids].sort()).toEqual(['a', 'c']);
  });
});

describe('edgeIsLive', () => {
  it('is true when either endpoint is running', () => {
    const running = new Set(['a']);
    expect(edgeIsLive(edge('e', 'a', 'b'), running)).toBe(true);
    expect(edgeIsLive(edge('e', 'b', 'a'), running)).toBe(true);
    expect(edgeIsLive(edge('e', 'b', 'c'), running)).toBe(false);
  });
});
