/**
 * Unit tests for {@link GibsonLLMAdapter}.
 *
 * The adapter is a pure translation shim between Vercel AI SDK shapes
 * and the Gibson daemon's `ExecuteLLM` RPC. These tests mock the daemon
 * client functions and assert every direction of the translation table
 * in spec 25 §5.
 *
 * ADR-0037: StreamLLM was removed from TenantService. doStream is now
 * implemented by wrapping ExecuteLLM in a ReadableStream. The streaming
 * tests assert the correct sequence of LanguageModelV2StreamPart values
 * emitted from a single non-streaming response.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  GibsonLLMAdapter,
  daemonResponseToVercelContent,
  daemonResponseToVercelStreamParts,
  mapFinishReason,
  mapUsage,
  vercelPromptToDaemonMessages,
  vercelResponseFormatToDaemon,
  vercelToolsToDaemonToolDefs,
} from './gibson-llm-adapter';

// Must be declared BEFORE the vi.mock call because the factory is hoisted.
const executeLLMMock = vi.fn();

vi.mock('@/src/lib/gibson-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/gibson-client')>();
  return {
    ...actual,
    executeLLM: (...args: unknown[]) => executeLLMMock(...args),
  };
});

import type { DaemonExecuteLLMResponse } from '@/src/lib/gibson-client';

beforeEach(() => {
  executeLLMMock.mockReset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userTextPrompt(text: string) {
  return [{ role: 'user' as const, content: [{ type: 'text' as const, text }] }];
}

async function readAll<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const out: T[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value !== undefined) out.push(value);
  }
  return out;
}

function makeExecuteResponse(overrides: Partial<DaemonExecuteLLMResponse> = {}): DaemonExecuteLLMResponse {
  return {
    content: 'hello world',
    toolCalls: [],
    finishReason: 'stop',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// doGenerate
// ---------------------------------------------------------------------------

describe('GibsonLLMAdapter.doGenerate', () => {
  it('forwards the request and maps the response', async () => {
    executeLLMMock.mockResolvedValueOnce(makeExecuteResponse());
    const adapter = new GibsonLLMAdapter('anthropic', 'user-1', 'tenant-1');

    const result = await adapter.doGenerate({
      prompt: userTextPrompt('hi'),
      temperature: 0.3,
      maxOutputTokens: 100,
      topP: 0.8,
      stopSequences: ['\n\n'],
    });

    // (a) executeLLM was called with correctly-mapped ExecuteLLMParams
    expect(executeLLMMock).toHaveBeenCalledTimes(1);
    const [params, userId, tenantId] = executeLLMMock.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(tenantId).toBe('tenant-1');
    expect(params.providerName).toBe('anthropic');
    expect(params.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(params.temperature).toBe(0.3);
    expect(params.maxTokens).toBe(100);
    expect(params.topP).toBe(0.8);
    expect(params.stop).toEqual(['\n\n']);

    // (b) Returned content/finishReason/usage match the mapping
    expect(result.content).toEqual([{ type: 'text', text: 'hello world' }]);
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(result.warnings).toEqual([]);
  });

  it('maps tool-call responses', async () => {
    executeLLMMock.mockResolvedValueOnce(
      makeExecuteResponse({
        content: '',
        toolCalls: [{ id: 'abc', name: 'get_weather', arguments: '{"city":"SF"}' }],
        finishReason: 'tool_calls',
      }),
    );
    const adapter = new GibsonLLMAdapter('openai');

    const result = await adapter.doGenerate({ prompt: userTextPrompt('what is the weather?') });

    expect(result.finishReason).toBe('tool-calls');
    expect(result.content).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'abc',
        toolName: 'get_weather',
        input: '{"city":"SF"}',
      },
    ]);
  });

  it('drops non-text content parts with a warning', async () => {
    executeLLMMock.mockResolvedValueOnce(makeExecuteResponse());
    const adapter = new GibsonLLMAdapter('anthropic');

    const result = await adapter.doGenerate({
      prompt: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this? ' },
            {
              type: 'file',
              data: 'aGVsbG8=',
              mediaType: 'image/png',
            },
          ],
        },
      ],
    });

    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0].type).toBe('other');
    expect(executeLLMMock.mock.calls[0][0].messages).toEqual([
      { role: 'user', content: 'what is this? ' },
    ]);
  });

  it('translates responseFormat with a JSON schema to json_schema', async () => {
    executeLLMMock.mockResolvedValueOnce(makeExecuteResponse());
    const adapter = new GibsonLLMAdapter('openai');

    await adapter.doGenerate({
      prompt: userTextPrompt('give me JSON'),
      responseFormat: {
        type: 'json',
        schema: { type: 'object', properties: { x: { type: 'number' } } },
      },
    });

    const params = executeLLMMock.mock.calls[0][0];
    expect(params.responseFormat).toEqual({
      type: 'json_schema',
      name: undefined,
      schemaJson: '{"type":"object","properties":{"x":{"type":"number"}}}',
      strict: false,
    });
  });

  it('translates responseFormat without a schema to json_object', async () => {
    executeLLMMock.mockResolvedValueOnce(makeExecuteResponse());
    const adapter = new GibsonLLMAdapter('openai');

    await adapter.doGenerate({
      prompt: userTextPrompt('give me JSON'),
      responseFormat: { type: 'json' },
    });

    expect(executeLLMMock.mock.calls[0][0].responseFormat).toEqual({ type: 'json_object' });
  });

  it('maps function tools and drops provider-defined tools with a warning', async () => {
    executeLLMMock.mockResolvedValueOnce(makeExecuteResponse());
    const adapter = new GibsonLLMAdapter('anthropic');

    const result = await adapter.doGenerate({
      prompt: userTextPrompt('hi'),
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'look up weather',
          inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
        },
        {
          type: 'provider-defined',
          id: 'anthropic.computer',
          name: 'computer',
          args: {},
        },
      ],
    });

    const params = executeLLMMock.mock.calls[0][0];
    expect(params.tools).toEqual([
      {
        name: 'get_weather',
        description: 'look up weather',
        parametersJson: '{"type":"object","properties":{"city":{"type":"string"}}}',
      },
    ]);
    expect(result.warnings.some((w) => w.type === 'unsupported-tool')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// doStream (ADR-0037: non-incremental, wraps ExecuteLLM in a ReadableStream)
// ---------------------------------------------------------------------------

describe('GibsonLLMAdapter.doStream', () => {
  it('emits text-delta, then finish from a single ExecuteLLM response', async () => {
    executeLLMMock.mockResolvedValueOnce(
      makeExecuteResponse({
        content: 'hello world',
        finishReason: 'stop',
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      }),
    );

    const adapter = new GibsonLLMAdapter('anthropic');
    const { stream, warnings } = await adapter.doStream({ prompt: userTextPrompt('hi') });

    expect(warnings).toEqual([]);
    const parts = await readAll(stream);
    expect(parts).toEqual([
      { type: 'text-delta', id: '0', delta: 'hello world' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      },
    ]);
  });

  it('emits tool-input-start + tool-input-delta for each tool call', async () => {
    executeLLMMock.mockResolvedValueOnce(
      makeExecuteResponse({
        content: '',
        toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: '{"city":"SF"}' }],
        finishReason: 'tool_calls',
        usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
      }),
    );

    const adapter = new GibsonLLMAdapter('openai');
    const { stream } = await adapter.doStream({ prompt: userTextPrompt('weather?') });

    const parts = await readAll(stream);
    expect(parts).toEqual([
      { type: 'tool-input-start', id: 'call_1', toolName: 'get_weather' },
      { type: 'tool-input-delta', id: 'call_1', delta: '{"city":"SF"}' },
      {
        type: 'finish',
        finishReason: 'tool-calls',
        usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
      },
    ]);
  });

  it('emits only finish when content and tool calls are empty', async () => {
    executeLLMMock.mockResolvedValueOnce(
      makeExecuteResponse({
        content: '',
        toolCalls: [],
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
      }),
    );

    const adapter = new GibsonLLMAdapter('anthropic');
    const { stream } = await adapter.doStream({ prompt: userTextPrompt('hi') });

    const parts = await readAll(stream);
    expect(parts).toEqual([
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Pure translation helpers
// ---------------------------------------------------------------------------

describe('mapFinishReason', () => {
  it.each([
    ['stop', 'stop'],
    ['length', 'length'],
    ['tool_calls', 'tool-calls'],
    ['content_filter', 'content-filter'],
    ['something-weird', 'other'],
  ])('maps %s to %s', (input, expected) => {
    expect(mapFinishReason(input)).toBe(expected);
  });
});

describe('mapUsage', () => {
  it('passes through defined values', () => {
    expect(mapUsage({ inputTokens: 1, outputTokens: 2, totalTokens: 3 })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    });
  });

  it('returns all-undefined for missing usage', () => {
    expect(mapUsage(undefined)).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    });
  });
});

describe('daemonResponseToVercelContent', () => {
  it('returns only tool-call parts when content is empty', () => {
    const content = daemonResponseToVercelContent({
      content: '',
      toolCalls: [{ id: 'id1', name: 'f', arguments: '{"a":1}' }],
      finishReason: 'tool_calls',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    expect(content).toEqual([
      { type: 'tool-call', toolCallId: 'id1', toolName: 'f', input: '{"a":1}' },
    ]);
  });

  it('emits text + tool-call', () => {
    const content = daemonResponseToVercelContent({
      content: 'thinking...',
      toolCalls: [{ id: 'x', name: 'f', arguments: '{}' }],
      finishReason: 'tool_calls',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: 'text', text: 'thinking...' });
  });
});

describe('daemonResponseToVercelStreamParts', () => {
  it('emits text-delta followed by finish for text-only response', () => {
    const parts = daemonResponseToVercelStreamParts({
      content: 'hello',
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    });
    expect(parts).toEqual([
      { type: 'text-delta', id: '0', delta: 'hello' },
      { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
    ]);
  });

  it('emits tool-input-start + tool-input-delta + finish for tool-call response', () => {
    const parts = daemonResponseToVercelStreamParts({
      content: '',
      toolCalls: [{ id: 'c1', name: 'search', arguments: '{"q":"test"}' }],
      finishReason: 'tool_calls',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    expect(parts[0]).toEqual({ type: 'tool-input-start', id: 'c1', toolName: 'search' });
    expect(parts[1]).toEqual({ type: 'tool-input-delta', id: 'c1', delta: '{"q":"test"}' });
    expect(parts[2].type).toBe('finish');
  });

  it('always emits a finish part as the last element', () => {
    const parts = daemonResponseToVercelStreamParts({
      content: '',
      toolCalls: [],
      finishReason: 'length',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('finish');
  });
});

describe('vercelResponseFormatToDaemon', () => {
  it('returns undefined for text / missing', () => {
    expect(vercelResponseFormatToDaemon(undefined)).toBeUndefined();
    expect(vercelResponseFormatToDaemon({ type: 'text' })).toBeUndefined();
  });

  it('maps JSON with schema to json_schema', () => {
    const out = vercelResponseFormatToDaemon({
      type: 'json',
      name: 'Answer',
      schema: { type: 'object' },
    });
    expect(out).toEqual({
      type: 'json_schema',
      name: 'Answer',
      schemaJson: '{"type":"object"}',
      strict: false,
    });
  });

  it('maps JSON without schema to json_object', () => {
    expect(vercelResponseFormatToDaemon({ type: 'json' })).toEqual({ type: 'json_object' });
  });
});

describe('vercelToolsToDaemonToolDefs', () => {
  it('returns [] for undefined', () => {
    expect(vercelToolsToDaemonToolDefs(undefined, [])).toEqual([]);
  });

  it('JSON-encodes the input schema', () => {
    const warnings: Array<{ type: string }> = [];
    const out = vercelToolsToDaemonToolDefs(
      [
        {
          type: 'function',
          name: 'get_weather',
          description: 'look up weather',
          inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
      warnings as never,
    );
    expect(out[0].parametersJson).toBe(
      '{"type":"object","properties":{"city":{"type":"string"}}}',
    );
  });
});

describe('vercelPromptToDaemonMessages', () => {
  it('concatenates text parts and drops images with a warning', () => {
    const warnings: Array<{ type: string }> = [];
    const messages = vercelPromptToDaemonMessages(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'hello ' },
            { type: 'file', data: 'abc', mediaType: 'image/png' },
            { type: 'text', text: 'world' },
          ],
        },
      ],
      warnings as never,
    );
    expect(messages).toEqual([{ role: 'user', content: 'hello world' }]);
    expect(warnings.some((w) => w.type === 'other')).toBe(true);
  });

  it('carries assistant tool-call parts into toolCalls', () => {
    const warnings: Array<{ type: string }> = [];
    const messages = vercelPromptToDaemonMessages(
      [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will call a tool.' },
            {
              type: 'tool-call',
              toolCallId: 'call_1',
              toolName: 'get_weather',
              input: { city: 'SF' },
            },
          ],
        },
      ],
      warnings as never,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toBe('I will call a tool.');
    expect(messages[0].toolCalls).toEqual([
      { id: 'call_1', name: 'get_weather', arguments: '{"city":"SF"}' },
    ]);
  });

  it('maps tool messages one-per-result', () => {
    const warnings: Array<{ type: string }> = [];
    const messages = vercelPromptToDaemonMessages(
      [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_1',
              toolName: 'get_weather',
              output: { type: 'text', value: '72F' },
            },
          ],
        },
      ],
      warnings as never,
    );
    expect(messages[0].role).toBe('tool');
    expect(messages[0].toolResults?.[0].toolCallId).toBe('call_1');
    expect(messages[0].toolResults?.[0].content).toBe('72F');
  });
});
