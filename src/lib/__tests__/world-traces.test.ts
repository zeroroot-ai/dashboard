// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from 'vitest';
import {
  adaptCallView,
  adaptCallDetail,
  parseModelCallItem,
  formatModelCallCost,
  groupCallsIntoRuns,
  aggregateCalls,
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

describe('parseModelCallItem', () => {
  it('reads a message whose content is a list of parts', () => {
    expect(
      parseModelCallItem(
        '{"content":[{"text":"be brief","type":"input_text"}],"role":"system","type":"message"}',
      ),
    ).toEqual({ kind: 'message', role: 'system', text: 'be brief' });
  });

  it('reads a message whose content is a string', () => {
    expect(parseModelCallItem('{"type":"message","role":"user","content":"hello"}')).toEqual({
      kind: 'message',
      role: 'user',
      text: 'hello',
    });
  });

  it('reads a reasoning item from its summary', () => {
    expect(
      parseModelCallItem('{"summary":[{"text":"hmm","type":"summary_text"}],"type":"reasoning"}'),
    ).toEqual({ kind: 'reasoning', text: 'hmm' });
  });

  it('reads a function call and its output', () => {
    expect(
      parseModelCallItem(
        '{"type":"function_call","call_id":"t1","name":"nmap","arguments":"{\\"host\\":\\"a\\"}"}',
      ),
    ).toEqual({ kind: 'function_call', name: 'nmap', callId: 't1', arguments: '{"host":"a"}' });
    expect(
      parseModelCallItem('{"call_id":"t1","output":"plain","type":"function_call_output"}'),
    ).toEqual({ kind: 'function_call_output', callId: 't1', output: 'plain' });
  });

  it('keeps an item of an unknown type as raw JSON', () => {
    const out = parseModelCallItem('{"type":"web_search_call","id":"w1"}');
    expect(out.kind).toBe('unknown');
    expect(out.kind === 'unknown' && JSON.parse(out.json)).toEqual({
      type: 'web_search_call',
      id: 'w1',
    });
  });

  it('shows a JSON string item as text (a purged call)', () => {
    expect(parseModelCallItem('"<purged text>"')).toEqual({ kind: 'text', text: '<purged text>' });
  });

  it('shows a JSON text that does not parse as raw text', () => {
    expect(parseModelCallItem('{"type":"message", broken')).toEqual({
      kind: 'text',
      text: '{"type":"message", broken',
    });
  });

  it('keeps a JSON value that is not an object as raw JSON', () => {
    expect(parseModelCallItem('[1,2]')).toEqual({ kind: 'unknown', json: '[1,2]' });
  });
});

describe('adaptCallDetail', () => {
  it('maps the metadata, the cache tokens and both item lists', () => {
    const out = adaptCallDetail({
      callId: 'c1',
      runId: 'r1',
      model: 'gpt-4o',
      scopeId: 's',
      promptTokens: 10,
      completionTokens: 5,
      requestItems: ['{"type":"message","role":"user","content":"scan it"}'],
      outputItems: ['{"type":"message","role":"assistant","content":"done"}'],
      provider: 'openai',
      httpStatus: 200,
      cacheReadTokens: 7,
      cacheWriteTokens: 3,
      cost: '0.0021',
      errorText: '',
    } as never);
    expect(out.totalTokens).toBe(15);
    expect(out.provider).toBe('openai');
    expect(out.httpStatus).toBe(200);
    expect(out.failed).toBe(false);
    expect(out.cacheReadTokens).toBe(7);
    expect(out.cacheWriteTokens).toBe(3);
    expect(out.cost).toBe('0.0021');
    expect(out.requestItems).toEqual([{ kind: 'message', role: 'user', text: 'scan it' }]);
    expect(out.outputItems).toEqual([{ kind: 'message', role: 'assistant', text: 'done' }]);
  });

  it('marks a model call with an HTTP status of 400 or more as failed', () => {
    const out = adaptCallDetail({
      callId: 'c2',
      runId: '',
      model: 'm',
      scopeId: 's',
      promptTokens: 0,
      completionTokens: 0,
      requestItems: ['{"type":"message","role":"user","content":"hi"}'],
      outputItems: [],
      provider: '',
      httpStatus: 404,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: '',
      errorText: 'route not found',
    } as never);
    expect(out.failed).toBe(true);
    expect(out.errorText).toBe('route not found');
    expect(out.outputItems).toEqual([]);
  });
});

describe('adaptCallDetail with an error and no HTTP status', () => {
  const base = {
    callId: 'c3',
    runId: '',
    model: 'm',
    scopeId: 's',
    promptTokens: 0,
    completionTokens: 0,
    requestItems: [],
    outputItems: [],
    provider: '',
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: '',
  };

  it('marks a model call with an error text and a status of 0 as failed', () => {
    const out = adaptCallDetail({ ...base, httpStatus: 0, errorText: 'connection reset' } as never);
    expect(out.failed).toBe(true);
  });

  it('marks a model call with an error text and a status of 200 as failed', () => {
    const out = adaptCallDetail({ ...base, httpStatus: 200, errorText: 'stream cut' } as never);
    expect(out.failed).toBe(true);
  });

  it('does not mark a model call with no error text and a status of 0 as failed', () => {
    const out = adaptCallDetail({ ...base, httpStatus: 0, errorText: '' } as never);
    expect(out.failed).toBe(false);
  });
});

describe('formatModelCallCost', () => {
  it('shows "Unknown" for an empty cost, never a zero', () => {
    expect(formatModelCallCost('')).toBe('Unknown');
  });
  it('shows a cost in US dollars', () => {
    expect(formatModelCallCost('0.0021')).toBe('$0.0021');
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

describe('the summaries hold no cost', () => {
  it('gives a run and a token summary no cost field, for a model that had a price', () => {
    const calls = [summary({ model: 'claude-opus-4', promptTokens: 1_000_000, completionTokens: 1_000_000 })];
    const run = groupCallsIntoRuns(calls)[0];
    const ts = aggregateCalls(calls);
    for (const value of [run, ts, ts.byModel[0]]) {
      expect(Object.keys(value).filter((k) => /cost|usd|price/i.test(k))).toEqual([]);
    }
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
