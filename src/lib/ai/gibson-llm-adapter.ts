/**
 * GibsonLLMAdapter — Vercel AI SDK LanguageModelV2 implementation that
 * proxies every call to the Gibson daemon over gRPC.
 *
 * Design: spec 25 (`25-daemon-driven-provider-config`) §5.
 *
 * This adapter is the ONLY way the dashboard talks to an LLM. Plaintext
 * credentials never enter the dashboard process: the daemon resolves the
 * tenant-scoped provider config, decrypts it in its own address space,
 * dispatches to langchaingo, and streams the response back. This file
 * must remain free of any direct provider SDK imports (`@ai-sdk/anthropic`,
 * `@anthropic-ai/sdk`, `openai`, etc.); a static-analysis guard enforces
 * this at `npm run build` time.
 */
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from '@ai-sdk/provider';

import {
  executeLLM,
  type DaemonExecuteLLMResponse,
  type DaemonLLMToolCall,
  type DaemonLLMToolDef,
  type DaemonLLMUsage,
  type DaemonResponseFormat,
  type ExecuteLLMParams,
  type LLMMessage as DaemonLLMMessage,
} from '@/src/lib/gibson-client';

/**
 * Single stable ID used for text-delta parts emitted by the adapter.
 *
 * Vercel AI SDK v2 groups text-delta stream parts by their `id` so
 * consumers can reassemble a multi-segment output. The Gibson daemon
 * emits a single logical text stream per call — one ID is sufficient.
 */
const TEXT_PART_ID = '0';

// ---------------------------------------------------------------------------
// Adapter class
// ---------------------------------------------------------------------------

export class GibsonLLMAdapter implements LanguageModelV2 {
  readonly specificationVersion = 'v2' as const;
  readonly provider = 'gibson';
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  constructor(
    private readonly providerName: string,
    private readonly userId?: string,
    private readonly tenantId?: string,
  ) {
    this.modelId = `gibson:${providerName}`;
  }

  async doGenerate(options: LanguageModelV2CallOptions): Promise<{
    content: LanguageModelV2Content[];
    finishReason: LanguageModelV2FinishReason;
    usage: LanguageModelV2Usage;
    warnings: LanguageModelV2CallWarning[];
  }> {
    const warnings: LanguageModelV2CallWarning[] = [];
    const params = this.buildExecParams(options, warnings);
    const resp = await executeLLM(params, this.userId, this.tenantId);
    return {
      content: daemonResponseToVercelContent(resp),
      finishReason: mapFinishReason(resp.finishReason),
      usage: mapUsage(resp.usage),
      warnings,
    };
  }

  async doStream(options: LanguageModelV2CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV2StreamPart>;
    warnings: LanguageModelV2CallWarning[];
  }> {
    // ADR-0037: StreamLLM was removed from TenantService. Implement doStream
    // using ExecuteLLM (non-streaming) and wrap the single response into a
    // ReadableStream so the Vercel AI SDK streaming contract is satisfied.
    // This produces a non-incremental stream: the full response is enqueued
    // in one shot after the daemon returns. A future streaming RPC will
    // restore incremental token delivery.
    const warnings: LanguageModelV2CallWarning[] = [];
    const params = this.buildExecParams(options, warnings);
    const resp = await executeLLM(params, this.userId, this.tenantId);

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      start(controller) {
        for (const part of daemonResponseToVercelStreamParts(resp)) {
          controller.enqueue(part);
        }
        controller.close();
      },
    });

    return { stream, warnings };
  }

  /**
   * Assembles the {@link ExecuteLLMParams} shared between doGenerate and
   * doStream. Collects warnings from the translation helpers and
   * forwards them to the caller.
   */
  private buildExecParams(
    options: LanguageModelV2CallOptions,
    warnings: LanguageModelV2CallWarning[],
  ): ExecuteLLMParams {
    const messages = vercelPromptToDaemonMessages(options.prompt, warnings);
    const tools = vercelToolsToDaemonToolDefs(options.tools, warnings);
    const responseFormat = vercelResponseFormatToDaemon(options.responseFormat);

    return {
      providerName: this.providerName,
      model: '',
      messages,
      tools,
      responseFormat,
      temperature: options.temperature,
      maxTokens: options.maxOutputTokens,
      topP: options.topP,
      stop: options.stopSequences,
    };
  }
}

// ---------------------------------------------------------------------------
// Translation helpers — Vercel prompt/tools/response-format → daemon types
// ---------------------------------------------------------------------------

/**
 * Translate a Vercel AI SDK prompt (array of role-tagged messages with
 * multi-modal content parts) into the daemon's flat LLMMessage shape.
 *
 * MVP constraint: the daemon today accepts text content only. Image,
 * file, and reasoning parts are dropped with an `other` warning. Text
 * parts for a given message are concatenated into the message's
 * `content` string.
 */
export function vercelPromptToDaemonMessages(
  prompt: LanguageModelV2CallOptions['prompt'],
  warnings: LanguageModelV2CallWarning[],
): DaemonLLMMessage[] {
  const out: DaemonLLMMessage[] = [];
  for (const msg of prompt) {
    switch (msg.role) {
      case 'system': {
        // Vercel system messages carry `content: string` directly.
        out.push({ role: 'system', content: msg.content });
        break;
      }
      case 'user': {
        const text = extractAndWarn(msg.content, 'user', warnings);
        out.push({ role: 'user', content: text });
        break;
      }
      case 'assistant': {
        const text = extractAndWarn(msg.content, 'assistant', warnings);
        const toolCalls: DaemonLLMToolCall[] = [];
        for (const part of msg.content) {
          if (part.type === 'tool-call') {
            toolCalls.push({
              id: part.toolCallId,
              name: part.toolName,
              // Daemon expects the arguments as a JSON-encoded string
              // (matches the OpenAI / Anthropic function-calling shape).
              arguments: safeStringify(part.input),
            });
          }
        }
        out.push({
          role: 'assistant',
          content: text,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        });
        break;
      }
      case 'tool': {
        // Vercel collapses all tool-result parts into one message; the
        // daemon wants one flat `tool` message per tool_call_id. We emit
        // one daemon message per Vercel tool-result part.
        for (const part of msg.content) {
          out.push({
            role: 'tool',
            content: toolResultOutputToString(part.output, warnings),
            toolResults: [
              {
                toolCallId: part.toolCallId,
                content: toolResultOutputToString(part.output, warnings),
                isError: false,
              },
            ],
            name: part.toolName,
          });
        }
        break;
      }
      default: {
        warnings.push({
          type: 'other',
          message: `unknown message role dropped: ${(msg as { role: string }).role}`,
        });
      }
    }
  }
  return out;
}

/**
 * Walks the content parts of a user/assistant message, concatenating
 * text (and assistant `reasoning`) into one string. Any non-text part
 * triggers a warning so the caller can see multimodal content was
 * silently dropped.
 */
function extractAndWarn(
  content: ReadonlyArray<{ type: string; text?: string }>,
  role: string,
  warnings: LanguageModelV2CallWarning[],
): string {
  const texts: string[] = [];
  for (const part of content) {
    if (part.type === 'text' && typeof part.text === 'string') {
      texts.push(part.text);
    } else if (part.type === 'tool-call' || part.type === 'tool-result') {
      // Handled separately by the caller.
    } else {
      warnings.push({
        type: 'other',
        message: `${role} message part of type '${part.type}' dropped (non-text content not yet forwarded)`,
      });
    }
  }
  return texts.join('');
}

function toolResultOutputToString(
  output: import('@ai-sdk/provider').LanguageModelV2ToolResultPart['output'],
  warnings: LanguageModelV2CallWarning[],
): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;
    case 'json':
    case 'error-json':
      return safeStringify(output.value);
    case 'content': {
      // Multi-part tool results are flattened to text; media entries are
      // dropped with a warning.
      const parts: string[] = [];
      for (const p of output.value) {
        if (p.type === 'text') {
          parts.push(p.text);
        } else {
          warnings.push({
            type: 'other',
            message: `tool-result media part dropped (multimodal tool output not forwarded)`,
          });
        }
      }
      return parts.join('');
    }
    default:
      warnings.push({
        type: 'other',
        message: `unknown tool-result output shape dropped`,
      });
      return '';
  }
}

/**
 * Translate Vercel AI SDK tool descriptors into the daemon's
 * {@link DaemonLLMToolDef} list. Only `function`-typed tools are
 * supported today; provider-defined tools (Anthropic computer-use,
 * OpenAI assistants, etc.) trigger a warning and are dropped.
 */
export function vercelToolsToDaemonToolDefs(
  tools: LanguageModelV2CallOptions['tools'],
  warnings: LanguageModelV2CallWarning[],
): DaemonLLMToolDef[] {
  if (!tools) return [];
  const out: DaemonLLMToolDef[] = [];
  for (const tool of tools) {
    if (tool.type !== 'function') {
      warnings.push({
        type: 'unsupported-tool',
        tool,
        details: `provider-defined tools are not supported by the Gibson daemon yet`,
      });
      continue;
    }
    out.push({
      name: tool.name,
      description: tool.description ?? '',
      // Vercel always ships JSON Schema 7 here (Zod schemas are converted
      // upstream by the `tool()` helper). JSON.stringify is the right
      // serialisation — the daemon field is `parametersJson: string`.
      parametersJson: safeStringify(tool.inputSchema),
    });
  }
  return out;
}

/**
 * Translate Vercel's `responseFormat` into the daemon's
 * {@link DaemonResponseFormat} proto shape. `{type: 'text'}` maps to
 * undefined (omitting the field); `{type: 'json'}` with a schema maps
 * to `json_schema`, without a schema maps to `json_object`.
 */
export function vercelResponseFormatToDaemon(
  rf: LanguageModelV2CallOptions['responseFormat'],
): DaemonResponseFormat | undefined {
  if (!rf || rf.type === 'text') return undefined;
  if (rf.type === 'json') {
    if (rf.schema !== undefined) {
      return {
        type: 'json_schema',
        name: rf.name,
        schemaJson: safeStringify(rf.schema),
        strict: false,
      };
    }
    return { type: 'json_object' };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Translation helpers — daemon response/stream → Vercel
// ---------------------------------------------------------------------------

/**
 * Build the `LanguageModelV2Content[]` for a non-streaming completion.
 * Emits up to one text part followed by N tool-call parts (one per
 * tool invocation the model requested).
 */
export function daemonResponseToVercelContent(
  resp: DaemonExecuteLLMResponse,
): LanguageModelV2Content[] {
  const out: LanguageModelV2Content[] = [];
  if (resp.content && resp.content.length > 0) {
    out.push({ type: 'text', text: resp.content });
  }
  for (const call of resp.toolCalls) {
    let input: unknown;
    try {
      input = JSON.parse(call.arguments);
    } catch {
      // Daemon always returns well-formed JSON here, but if it doesn't
      // we forward the raw string so downstream tool execution can log
      // a meaningful error rather than a parse failure bubbling up.
      input = call.arguments;
    }
    out.push({
      type: 'tool-call',
      toolCallId: call.id,
      toolName: call.name,
      // LanguageModelV2ToolCall.input is typed `string` (stringified
      // JSON) in @ai-sdk/provider v3 — match that shape.
      input: typeof input === 'string' ? input : safeStringify(input),
    });
  }
  return out;
}

/**
 * Map the daemon's string `finishReason` to Vercel's canonical union.
 */
export function mapFinishReason(reason: string): LanguageModelV2FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
    case 'tool-calls':
      return 'tool-calls';
    case 'content_filter':
    case 'content-filter':
      return 'content-filter';
    case 'error':
      return 'error';
    case '':
    case 'unknown':
      return 'unknown';
    default:
      return 'other';
  }
}

/**
 * Map the daemon's flat {@link DaemonLLMUsage} to Vercel's
 * {@link LanguageModelV2Usage}. The Vercel type requires each field to
 * be `number | undefined`; when the daemon provides zero we forward
 * the zero rather than dropping it — the streaming path may later
 * update the value.
 */
export function mapUsage(u?: DaemonLLMUsage): LanguageModelV2Usage {
  if (!u) {
    return {
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    };
  }
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    totalTokens: u.totalTokens,
  };
}

/**
 * Convert a complete (non-streaming) daemon response into the sequence of
 * {@link LanguageModelV2StreamPart} objects that {@link GibsonLLMAdapter.doStream}
 * enqueues into its `ReadableStream`.
 *
 * ADR-0037: StreamLLM was removed from TenantService. doStream is implemented
 * by wrapping the single ExecuteLLM response. The emitted sequence is:
 *   - one `text-delta` part for the text content (if any)
 *   - one `tool-input-start` + one `tool-input-delta` per tool call (if any)
 *   - one `finish` part carrying finishReason + usage
 *
 * A future streaming RPC will restore incremental token delivery; the shape
 * of this sequence is already compatible with the future streaming consumer.
 */
export function daemonResponseToVercelStreamParts(
  resp: DaemonExecuteLLMResponse,
): LanguageModelV2StreamPart[] {
  const parts: LanguageModelV2StreamPart[] = [];

  if (resp.content && resp.content.length > 0) {
    parts.push({ type: 'text-delta', id: TEXT_PART_ID, delta: resp.content });
  }

  for (let i = 0; i < resp.toolCalls.length; i++) {
    const call = resp.toolCalls[i];
    const id = call.id || `tool-${i}`;
    parts.push({
      type: 'tool-input-start',
      id,
      toolName: call.name,
    });
    parts.push({
      type: 'tool-input-delta',
      id,
      delta: call.arguments,
    });
  }

  parts.push({
    type: 'finish',
    finishReason: mapFinishReason(resp.finishReason),
    usage: mapUsage(resp.usage),
  });

  return parts;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * JSON.stringify wrapped so circular or otherwise non-serialisable
 * inputs surface as a clear string rather than breaking the adapter.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
