import { describe, it, expect } from 'vitest';
import { diffFrames, type Frame } from '@/components/gibson/brain/frame-diff';
import {
  llmCallIdForEvent,
  isDecisionEvent,
} from '@/components/gibson/brain/llm-tick';

const host = (scopeId: string, address: string, attention = 0.5): Frame['hosts'][number] => ({
  scopeId,
  address,
  openPorts: [22, 443],
  juicy: 0.7,
  attention,
  surprise: '',
});

const finding = (id: string, scopeId: string, address: string): Frame['findings'][number] => ({
  id,
  title: `finding ${id}`,
  scopeId,
  address,
  severity: 'high',
});

const mission = (id: string, status = 'running'): Frame['missions'][number] => ({
  id,
  goal: `goal ${id}`,
  status,
  reason: '',
});

const EMPTY: Frame = { missions: [], hosts: [], findings: [] };

describe('diffFrames', () => {
  it('reports an added host as the changed-entity set, and highlights its node', () => {
    const after: Frame = { missions: [], hosts: [host('s1', '10.0.0.1')], findings: [] };
    const diff = diffFrames(EMPTY, after);

    expect(diff.entities).toEqual([
      { id: 'host:s1/10.0.0.1', kind: 'host', label: '10.0.0.1', change: 'added' },
    ]);
    expect(diff.highlightNodeIds).toEqual(['host:s1/10.0.0.1']);
    expect(diff.highlightEdgeIds).toEqual([]);
  });

  it('highlights an introduced AFFECTS edge when a finding lands on a known host', () => {
    const before: Frame = { missions: [], hosts: [host('s1', '10.0.0.1')], findings: [] };
    const after: Frame = {
      missions: [],
      hosts: [host('s1', '10.0.0.1')],
      findings: [finding('f1', 's1', '10.0.0.1')],
    };
    const diff = diffFrames(before, after);

    expect(diff.entities).toEqual([
      { id: 'finding:f1', kind: 'finding', label: 'finding f1', change: 'added' },
    ]);
    expect(diff.highlightNodeIds).toEqual(['finding:f1']);
    expect(diff.highlightEdgeIds).toEqual(['affects:f1']);
  });

  it('detects a property change (host attention) as a changed entity', () => {
    const before: Frame = { missions: [], hosts: [host('s1', '10.0.0.1', 0.1)], findings: [] };
    const after: Frame = { missions: [], hosts: [host('s1', '10.0.0.1', 0.9)], findings: [] };
    const diff = diffFrames(before, after);

    expect(diff.entities).toEqual([
      { id: 'host:s1/10.0.0.1', kind: 'host', label: '10.0.0.1', change: 'changed' },
    ]);
    expect(diff.highlightNodeIds).toEqual(['host:s1/10.0.0.1']);
  });

  it('reports a removed mission but never highlights it (absent from the after-frame)', () => {
    const before: Frame = { missions: [mission('m1')], hosts: [], findings: [] };
    const diff = diffFrames(before, EMPTY);

    expect(diff.entities).toEqual([
      { id: 'mission:m1', kind: 'mission', label: 'goal m1', change: 'removed' },
    ]);
    expect(diff.highlightNodeIds).toEqual([]);
  });

  it('degrades gracefully at seq 0: empty before-frame yields all-added', () => {
    const after: Frame = {
      missions: [mission('m1')],
      hosts: [host('s1', '10.0.0.1')],
      findings: [],
    };
    const diff = diffFrames(EMPTY, after);
    expect(diff.entities.map((e) => e.change)).toEqual(['added', 'added']);
    expect(diff.highlightNodeIds.sort()).toEqual(['host:s1/10.0.0.1', 'mission:m1']);
  });

  it('degrades gracefully on a tick with no entity change: empty diff', () => {
    const frame: Frame = {
      missions: [mission('m1')],
      hosts: [host('s1', '10.0.0.1')],
      findings: [],
    };
    const diff = diffFrames(frame, frame);
    expect(diff.entities).toEqual([]);
    expect(diff.highlightNodeIds).toEqual([]);
    expect(diff.highlightEdgeIds).toEqual([]);
  });

  it('orders the changed set added → changed → removed', () => {
    const before: Frame = {
      missions: [mission('gone')],
      hosts: [host('s1', '10.0.0.1', 0.1)],
      findings: [],
    };
    const after: Frame = {
      missions: [],
      hosts: [host('s1', '10.0.0.1', 0.9)],
      findings: [finding('new', 's1', '10.0.0.1')],
    };
    const diff = diffFrames(before, after);
    expect(diff.entities.map((e) => e.change)).toEqual(['added', 'changed', 'removed']);
  });
});

describe('llmCallIdForEvent', () => {
  it('extracts CallID from an llm_call.observed summary (Go %+v form)', () => {
    expect(
      llmCallIdForEvent({
        seq: 4,
        kind: 'llm_call.observed',
        summary: '{CallID:c-42 RunID:r1 Model:gpt-4 PromptTokens:10 CompletionTokens:5}',
      }),
    ).toBe('c-42');
  });

  it('returns null for a non-LLM tick', () => {
    expect(
      llmCallIdForEvent({ seq: 1, kind: 'host.observed', summary: '{Address:10.0.0.1}' }),
    ).toBeNull();
  });

  it('returns null when an LLM tick has an empty CallID', () => {
    expect(
      llmCallIdForEvent({ seq: 2, kind: 'llm_call.observed', summary: '{CallID: RunID:r1}' }),
    ).toBeNull();
  });
});

describe('isDecisionEvent', () => {
  it('matches decision.* kinds', () => {
    expect(isDecisionEvent({ seq: 0, kind: 'decision.completed', summary: '' })).toBe(true);
    expect(isDecisionEvent({ seq: 0, kind: 'llm_call.observed', summary: '' })).toBe(false);
  });
});
