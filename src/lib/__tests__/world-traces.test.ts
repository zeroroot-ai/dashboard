import { describe, it, expect } from 'vitest';
import {
  adaptCallView,
  adaptCallDetail,
  groupCallsIntoRuns,
  aggregateCalls,
  estimateCallCostUsd,
  formatUsd,
  formatTokenCount,
} from '@/src/lib/world-traces';
import type { LlmCallSummary } from '@/src/types/trace';

function summary(over: Partial<LlmCallSummary> = {}): LlmCallSummary {
  const promptTokens = over.promptTokens ?? 100;
  const completionTokens = over.completionTokens ?? 40;
  return {
    callId: 'c1',
    runId: 'run-1',
    model: 'claude-opus-4',
    scopeId: 's1',
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    ...over,
  };
}

describe('adaptCallView', () => {
  it('maps proto fields and derives totalTokens', () => {
    const out = adaptCallView({
      callId: 'c1',
      runId: 'r1',
      model: 'm',
      scopeId: 's',
      promptTokens: 30,
      completionTokens: 12,
    } as never);
    expect(out).toMatchObject({ callId: 'c1', totalTokens: 42 });
  });
});

describe('adaptCallDetail', () => {
  it('maps the transcript and normalises unknown roles to user', () => {
    const out = adaptCallDetail({
      callId: 'c1',
      runId: 'r1',
      model: 'm',
      scopeId: 's',
      promptTokens: 10,
      completionTokens: 5,
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'weird', content: 'x' },
      ],
      completion: 'done',
    } as never);
    expect(out.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(out.messages[1].role).toBe('user');
    expect(out.completion).toBe('done');
    expect(out.totalTokens).toBe(15);
  });
});

describe('groupCallsIntoRuns', () => {
  it('groups by runId in first-appearance order', () => {
    const runs = groupCallsIntoRuns([
      summary({ callId: 'a', runId: 'r1' }),
      summary({ callId: 'b', runId: 'r2' }),
      summary({ callId: 'c', runId: 'r1' }),
    ]);
    expect(runs.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(runs[0].callCount).toBe(2);
    expect(runs[0].totalTokens).toBe(280);
  });

  it('collapses empty run ids into one ungrouped run', () => {
    const runs = groupCallsIntoRuns([
      summary({ callId: 'a', runId: '' }),
      summary({ callId: 'b', runId: '' }),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: '', label: 'Ungrouped calls', callCount: 2 });
  });

  it('collects the distinct models used in a run', () => {
    const runs = groupCallsIntoRuns([
      summary({ callId: 'a', runId: 'r1', model: 'gpt-4o' }),
      summary({ callId: 'b', runId: 'r1', model: 'claude-opus-4' }),
      summary({ callId: 'c', runId: 'r1', model: 'gpt-4o' }),
    ]);
    expect(runs[0].models.sort()).toEqual(['claude-opus-4', 'gpt-4o']);
  });
});

describe('aggregateCalls', () => {
  it('rolls up tokens by model', () => {
    const ts = aggregateCalls([
      summary({ model: 'gpt-4o', promptTokens: 100, completionTokens: 40 }),
      summary({ model: 'gpt-4o', promptTokens: 50, completionTokens: 10 }),
      summary({ model: 'claude-opus-4', promptTokens: 10, completionTokens: 5 }),
    ]);
    expect(ts.llmCallCount).toBe(3);
    expect(ts.inputTokens).toBe(160);
    expect(ts.outputTokens).toBe(55);
    expect(ts.totalTokens).toBe(215);
    const gpt = ts.byModel.find((m) => m.model === 'gpt-4o')!;
    expect(gpt.callCount).toBe(2);
    expect(gpt.totalTokens).toBe(200);
  });

  it('labels an empty model as "unknown"', () => {
    const ts = aggregateCalls([summary({ model: '' })]);
    expect(ts.byModel[0].model).toBe('unknown');
  });
});

describe('estimateCallCostUsd', () => {
  it('prices a known model from the table', () => {
    // claude-opus-4: [15, 75] per 1M → 1M in + 1M out = 15 + 75 = 90.
    expect(estimateCallCostUsd('claude-opus-4', 1_000_000, 1_000_000)).toBeCloseTo(90);
  });
  it('returns 0 for unknown models', () => {
    expect(estimateCallCostUsd('mystery-model', 1000, 1000)).toBe(0);
  });
});

describe('formatUsd', () => {
  it('formats sub-cent, zero, and dollar amounts', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.004)).toBe('<$0.01');
    expect(formatUsd(1.2345)).toBe('$1.23');
  });
});

describe('formatTokenCount', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(500)).toBe('500');
    expect(formatTokenCount(12432)).toBe('12.4k');
    expect(formatTokenCount(1234567)).toBe('1.2M');
  });
});
