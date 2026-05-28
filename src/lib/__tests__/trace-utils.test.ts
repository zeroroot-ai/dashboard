import { describe, it, expect } from 'vitest';
import {
  buildTraceTree,
  extractMessages,
  aggregateTokenUsage,
  extractDecisions,
  formatTokenCount,
} from '@/src/lib/trace-utils';

// The Langfuse observation shape that trace-utils consumes. trace-utils
// redefines it locally (not exported), so we build structurally-compatible
// fixtures here. `obs()` fills the required fields with sane defaults so each
// test only specifies the bits it exercises.
type Level = 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
type ObsType = 'GENERATION' | 'SPAN' | 'EVENT';

interface Obs {
  id: string;
  traceId: string;
  type: ObsType;
  name: string;
  startTime: string;
  endTime?: string;
  parentObservationId?: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  level: Level;
  statusMessage?: string;
  modelParameters?: Record<string, unknown>;
}

function obs(partial: Partial<Obs> & { id: string }): Obs {
  return {
    traceId: 'trace-1',
    type: 'SPAN',
    name: 'node',
    startTime: '2026-05-28T10:00:00.000Z',
    level: 'DEFAULT',
    ...partial,
  };
}

describe('buildTraceTree', () => {
  it('nests children under their parent via parentObservationId', () => {
    const tree = buildTraceTree([
      obs({ id: 'root' }),
      obs({ id: 'child-a', parentObservationId: 'root' }),
      obs({ id: 'child-b', parentObservationId: 'root' }),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('root');
    expect(tree[0].children.map((c) => c.id).sort()).toEqual(['child-a', 'child-b']);
  });

  it('promotes orphan nodes (parent not present) to roots', () => {
    const tree = buildTraceTree([
      obs({ id: 'a' }),
      obs({ id: 'orphan', parentObservationId: 'does-not-exist' }),
    ]);

    expect(tree.map((n) => n.id).sort()).toEqual(['a', 'orphan']);
  });

  it('sorts children recursively by startTime ascending', () => {
    const tree = buildTraceTree([
      obs({ id: 'root', startTime: '2026-05-28T10:00:00.000Z' }),
      obs({ id: 'late', parentObservationId: 'root', startTime: '2026-05-28T10:00:03.000Z' }),
      obs({ id: 'early', parentObservationId: 'root', startTime: '2026-05-28T10:00:01.000Z' }),
      obs({ id: 'grandchild-2', parentObservationId: 'early', startTime: '2026-05-28T10:00:02.500Z' }),
      obs({ id: 'grandchild-1', parentObservationId: 'early', startTime: '2026-05-28T10:00:02.100Z' }),
    ]);

    expect(tree[0].children.map((c) => c.id)).toEqual(['early', 'late']);
    expect(tree[0].children[0].children.map((c) => c.id)).toEqual([
      'grandchild-1',
      'grandchild-2',
    ]);
  });

  it('maps observation type + name to the display node type', () => {
    const [generation, decision, mission, agent, tool, span, event] = buildTraceTree([
      obs({ id: '1', type: 'GENERATION', name: 'gen_ai.chat' }),
      obs({ id: '2', type: 'GENERATION', name: 'orchestrator decision' }),
      obs({ id: '3', type: 'SPAN', name: 'mission root' }),
      obs({ id: '4', type: 'SPAN', name: 'agent recon' }),
      obs({ id: '5', type: 'SPAN', name: 'tool nmap' }),
      obs({ id: '6', type: 'SPAN', name: 'misc work' }),
      obs({ id: '7', type: 'EVENT', name: 'log line' }),
    ]);

    expect(generation.type).toBe('generation');
    expect(decision.type).toBe('decision');
    expect(mission.type).toBe('mission');
    expect(agent.type).toBe('agent');
    expect(tool.type).toBe('tool');
    expect(span.type).toBe('span');
    expect(event.type).toBe('span');
  });

  it('marks ERROR-level nodes as errored and carries the status message', () => {
    const [node] = buildTraceTree([
      obs({ id: 'boom', level: 'ERROR', statusMessage: 'rate limited' }),
    ]);

    expect(node.status).toBe('error');
    expect(node.errorMessage).toBe('rate limited');
  });

  it('derives token counts only when prompt/completion are present', () => {
    const [withTokens, withoutTokens] = buildTraceTree([
      obs({ id: 'gen', promptTokens: 100, completionTokens: 40 }),
      obs({ id: 'plain' }),
    ]);

    expect(withTokens.tokens).toEqual({ input: 100, output: 40 });
    expect(withoutTokens.tokens).toBeUndefined();
  });

  it('computes durationMs from endTime, defaulting to 0 when open-ended', () => {
    const [closed, open] = buildTraceTree([
      obs({
        id: 'closed',
        startTime: '2026-05-28T10:00:00.000Z',
        endTime: '2026-05-28T10:00:02.500Z',
      }),
      obs({ id: 'open', startTime: '2026-05-28T10:00:00.000Z' }),
    ]);

    expect(closed.durationMs).toBe(2500);
    expect(open.durationMs).toBe(0);
  });
});

describe('extractMessages', () => {
  it('extracts OpenAI-style [{role, content}] input messages', () => {
    const messages = extractMessages(
      obs({
        id: 'g',
        type: 'GENERATION',
        input: [
          { role: 'system', content: 'You are a pentester.' },
          { role: 'user', content: 'Scan the host.' },
        ],
      }),
    );

    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[1].content).toBe('Scan the host.');
  });

  it('extracts wrapped { messages: [...] } input', () => {
    const messages = extractMessages(
      obs({
        id: 'g',
        type: 'GENERATION',
        input: { messages: [{ role: 'user', content: 'hello' }] },
      }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'hello' });
  });

  it('appends a string output as an assistant message', () => {
    const messages = extractMessages(
      obs({ id: 'g', type: 'GENERATION', output: 'Done — 12 ports open.' }),
    );

    expect(messages).toEqual([{ role: 'assistant', content: 'Done — 12 ports open.' }]);
  });

  it('parses an object output that carries a role', () => {
    const messages = extractMessages(
      obs({
        id: 'g',
        type: 'GENERATION',
        output: { role: 'assistant', content: 'response text' },
      }),
    );

    expect(messages).toEqual([{ role: 'assistant', content: 'response text' }]);
  });

  it('normalizes Anthropic content blocks into text and tool calls', () => {
    const messages = extractMessages(
      obs({
        id: 'g',
        type: 'GENERATION',
        output: {
          content: [
            { type: 'text', text: 'Let me scan that.' },
            { type: 'tool_use', id: 'tu_1', name: 'nmap', input: { host: '10.0.0.1' } },
          ],
        },
      }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toBe('Let me scan that.');
    expect(messages[0].toolCalls).toEqual([
      { id: 'tu_1', name: 'nmap', arguments: JSON.stringify({ host: '10.0.0.1' }) },
    ]);
  });

  it('extracts OpenAI tool_calls from a message', () => {
    const messages = extractMessages(
      obs({
        id: 'g',
        type: 'GENERATION',
        input: [
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'call_1', function: { name: 'lookup', arguments: '{"q":"x"}' } },
            ],
          },
        ],
      }),
    );

    expect(messages[0].toolCalls).toEqual([
      { id: 'call_1', name: 'lookup', arguments: '{"q":"x"}' },
    ]);
  });

  it('returns an empty array when content logging is disabled (null input/output)', () => {
    expect(extractMessages(obs({ id: 'g', type: 'GENERATION' }))).toEqual([]);
  });
});

describe('aggregateTokenUsage', () => {
  it('ignores non-GENERATION observations', () => {
    const summary = aggregateTokenUsage([
      obs({ id: 's', type: 'SPAN', promptTokens: 999, completionTokens: 999 }),
    ]);

    expect(summary.llmCallCount).toBe(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.byModel).toEqual([]);
    expect(summary.byAgent).toEqual([]);
  });

  it('rolls up totals and call counts across generations', () => {
    const summary = aggregateTokenUsage([
      obs({ id: '1', type: 'GENERATION', model: 'gpt-4o', promptTokens: 100, completionTokens: 50, totalTokens: 150 }),
      obs({ id: '2', type: 'GENERATION', model: 'gpt-4o', promptTokens: 200, completionTokens: 80, totalTokens: 280 }),
    ]);

    expect(summary.llmCallCount).toBe(2);
    expect(summary.inputTokens).toBe(300);
    expect(summary.outputTokens).toBe(130);
    expect(summary.totalTokens).toBe(430);
  });

  it('falls back to prompt+completion when totalTokens is absent', () => {
    const summary = aggregateTokenUsage([
      obs({ id: '1', type: 'GENERATION', model: 'gpt-4o', promptTokens: 10, completionTokens: 5 }),
    ]);

    expect(summary.totalTokens).toBe(15);
  });

  it('groups by agent using gibson.agent.name, defaulting to orchestrator', () => {
    const summary = aggregateTokenUsage([
      obs({ id: '1', type: 'GENERATION', model: 'gpt-4o', promptTokens: 10, completionTokens: 5, metadata: { 'gibson.agent.name': 'recon' } }),
      obs({ id: '2', type: 'GENERATION', model: 'gpt-4o', promptTokens: 20, completionTokens: 5, metadata: { 'gibson.agent.name': 'recon' } }),
      obs({ id: '3', type: 'GENERATION', model: 'gpt-4o', promptTokens: 7, completionTokens: 3 }),
    ]);

    const byAgent = Object.fromEntries(summary.byAgent.map((a) => [a.agentName, a]));
    expect(byAgent.recon.callCount).toBe(2);
    expect(byAgent.recon.inputTokens).toBe(30);
    expect(byAgent.orchestrator.callCount).toBe(1);
    expect(byAgent.orchestrator.inputTokens).toBe(7);
  });

  it('groups by model and estimates cost for known models, zero for unknown', () => {
    const summary = aggregateTokenUsage([
      obs({ id: '1', type: 'GENERATION', model: 'claude-sonnet-4', promptTokens: 1_000_000, completionTokens: 1_000_000 }),
      obs({ id: '2', type: 'GENERATION', model: 'some-unlisted-model', promptTokens: 1_000_000, completionTokens: 1_000_000 }),
    ]);

    const byModel = Object.fromEntries(summary.byModel.map((m) => [m.model, m]));
    // claude-sonnet-4 priced at [3, 15] per 1M tokens → 1M in + 1M out = $18.
    expect(byModel['claude-sonnet-4'].estimatedCostUsd).toBeCloseTo(18, 5);
    expect(byModel['some-unlisted-model'].estimatedCostUsd).toBe(0);
    // Total cost is the sum of per-model estimates.
    expect(summary.estimatedCostUsd).toBeCloseTo(18, 5);
  });
});

describe('extractDecisions', () => {
  it('keeps only matching GENERATION observations and sorts by timestamp', () => {
    const decisions = extractDecisions([
      obs({ id: 'd2', type: 'GENERATION', name: 'orchestrator decision', startTime: '2026-05-28T10:00:05.000Z' }),
      obs({ id: 'd1', type: 'GENERATION', name: 'gen_ai.chat', startTime: '2026-05-28T10:00:01.000Z' }),
      obs({ id: 'skip-span', type: 'SPAN', name: 'orchestrator decision' }),
      obs({ id: 'skip-name', type: 'GENERATION', name: 'unrelated generation' }),
    ]);

    expect(decisions.map((d) => d.id)).toEqual(['d1', 'd2']);
  });

  it('extracts orchestrator metadata with sensible defaults', () => {
    const [withMeta, withoutMeta] = extractDecisions([
      obs({
        id: 'a',
        type: 'GENERATION',
        name: 'decision',
        startTime: '2026-05-28T10:00:01.000Z',
        model: 'gpt-4o',
        metadata: {
          'orchestrator.action': 'dispatch',
          'orchestrator.target_agent': 'recon',
          'orchestrator.confidence': 0.9,
          'orchestrator.reasoning': 'recon first',
        },
      }),
      obs({ id: 'b', type: 'GENERATION', name: 'decision', startTime: '2026-05-28T10:00:02.000Z' }),
    ]);

    expect(withMeta).toMatchObject({
      action: 'dispatch',
      targetAgent: 'recon',
      confidence: 0.9,
      reasoning: 'recon first',
      model: 'gpt-4o',
    });
    expect(withoutMeta).toMatchObject({
      action: 'llm_call',
      confidence: 1,
      reasoning: '',
      model: 'unknown',
    });
  });

  it('reports contentAvailable based on presence of input/output', () => {
    const [hasContent, noContent] = extractDecisions([
      obs({ id: 'a', type: 'GENERATION', name: 'decision', startTime: '2026-05-28T10:00:01.000Z', input: [{ role: 'user', content: 'x' }] }),
      obs({ id: 'b', type: 'GENERATION', name: 'decision', startTime: '2026-05-28T10:00:02.000Z' }),
    ]);

    expect(hasContent.contentAvailable).toBe(true);
    expect(noContent.contentAvailable).toBe(false);
  });

  it('flags error status from ERROR level', () => {
    const [decision] = extractDecisions([
      obs({ id: 'a', type: 'GENERATION', name: 'decision', level: 'ERROR', statusMessage: 'context overflow' }),
    ]);

    expect(decision.status).toBe('error');
    expect(decision.errorMessage).toBe('context overflow');
  });
});

describe('formatTokenCount', () => {
  it('formats counts across magnitude boundaries', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(12_432)).toBe('12.4k');
    expect(formatTokenCount(150_000)).toBe('150k');
    expect(formatTokenCount(1_200_000)).toBe('1.2M');
  });
});
