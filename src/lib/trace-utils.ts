import type {
  TraceNode,
  TraceNodeType,
  ConversationMessage,
  ToolCallBlock,
  TokenSummary,
  AgentTokenBreakdown,
  ModelTokenBreakdown,
  DecisionEntry,
} from '@/src/types/trace';

// Re-define the Langfuse observation shape locally to avoid importing server-side module
interface LangfuseObservation {
  id: string;
  traceId: string;
  type: 'GENERATION' | 'SPAN' | 'EVENT';
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
  level: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
  statusMessage?: string;
  modelParameters?: Record<string, unknown>;
}

/**
 * Build a tree from a flat list of Langfuse observations using parentObservationId.
 * Orphan nodes (parent not found) become roots.
 */
export function buildTraceTree(observations: LangfuseObservation[]): TraceNode[] {
  const nodeMap = new Map<string, TraceNode>();

  for (const obs of observations) {
    const node: TraceNode = {
      id: obs.id,
      name: obs.name,
      type: mapObservationType(obs),
      startTime: new Date(obs.startTime),
      endTime: obs.endTime ? new Date(obs.endTime) : undefined,
      durationMs: obs.endTime
        ? new Date(obs.endTime).getTime() - new Date(obs.startTime).getTime()
        : 0,
      status: obs.level === 'ERROR' ? 'error' : 'ok',
      errorMessage: obs.level === 'ERROR' ? obs.statusMessage : undefined,
      tokens:
        obs.promptTokens != null || obs.completionTokens != null
          ? { input: obs.promptTokens ?? 0, output: obs.completionTokens ?? 0 }
          : undefined,
      model: obs.model,
      children: [],
    };
    nodeMap.set(obs.id, node);
  }

  const roots: TraceNode[] = [];

  for (const obs of observations) {
    const node = nodeMap.get(obs.id)!;
    if (obs.parentObservationId && nodeMap.has(obs.parentObservationId)) {
      nodeMap.get(obs.parentObservationId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort children by startTime recursively
  const sortChildren = (nodes: TraceNode[]) => {
    nodes.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    for (const node of nodes) {
      if (node.children.length > 0) sortChildren(node.children);
    }
  };
  sortChildren(roots);

  return roots;
}

/**
 * Map Langfuse observation type + name to our TraceNodeType.
 */
function mapObservationType(obs: LangfuseObservation): TraceNodeType {
  if (obs.type === 'GENERATION') {
    if (obs.name?.includes('decision') || obs.name?.includes('orchestrat')) return 'decision';
    return 'generation';
  }
  if (obs.type === 'SPAN') {
    if (obs.name?.includes('mission')) return 'mission';
    if (obs.name?.includes('agent')) return 'agent';
    if (obs.name?.includes('tool')) return 'tool';
    return 'span';
  }
  return 'span';
}

/**
 * Extract structured messages from a Langfuse generation observation.
 * Handles both OpenAI-style [{role, content}] and Anthropic-style content blocks.
 * Returns empty array if input is null/undefined (content logging disabled).
 */
export function extractMessages(observation: LangfuseObservation): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  const input = observation.input;
  const output = observation.output;

  // Handle input (the prompt messages)
  if (input && Array.isArray(input)) {
    // OpenAI/Anthropic style: [{role, content, ...}]
    for (const msg of input) {
      if (msg && typeof msg === 'object' && 'role' in msg) {
        messages.push(parseMessage(msg as Record<string, unknown>));
      }
    }
  } else if (input && typeof input === 'object' && 'messages' in input) {
    // Wrapped format: { messages: [{role, content}] }
    const msgs = (input as Record<string, unknown>).messages;
    if (Array.isArray(msgs)) {
      for (const msg of msgs) {
        if (msg && typeof msg === 'object' && 'role' in msg) {
          messages.push(parseMessage(msg as Record<string, unknown>));
        }
      }
    }
  }

  // Handle output (the assistant response)
  if (output) {
    if (typeof output === 'string') {
      messages.push({ role: 'assistant', content: output });
    } else if (typeof output === 'object' && output !== null) {
      const out = output as Record<string, unknown>;
      if ('role' in out) {
        messages.push(parseMessage(out));
      } else if ('content' in out) {
        // Anthropic-style response with content blocks
        const content = normalizeContent(out.content);
        const toolCalls = extractToolCalls(out);
        messages.push({
          role: 'assistant',
          content,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        });
      }
    }
  }

  return messages;
}

function parseMessage(msg: Record<string, unknown>): ConversationMessage {
  const role = (msg.role as string || 'user') as ConversationMessage['role'];
  const content = normalizeContent(msg.content);
  const toolCalls = extractToolCalls(msg);

  return {
    role,
    content,
    name: msg.name as string | undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    toolCallId: msg.tool_call_id as string | undefined,
  };
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // Anthropic content blocks: [{type: 'text', text: '...'}, ...]
    return content
      .filter(
        (block): block is Record<string, unknown> =>
          typeof block === 'object' &&
          block !== null &&
          (block as Record<string, unknown>).type === 'text',
      )
      .map((block) => block.text as string)
      .join('\n');
  }
  if (content == null) return '';
  return JSON.stringify(content);
}

function extractToolCalls(msg: Record<string, unknown>): ToolCallBlock[] {
  // OpenAI format: tool_calls array
  if (Array.isArray(msg.tool_calls)) {
    return msg.tool_calls.map((tc: Record<string, unknown>) => ({
      id: (tc.id as string) || '',
      name:
        (tc.function as Record<string, unknown>)?.name as string ||
        (tc.name as string) ||
        '',
      arguments:
        typeof (tc.function as Record<string, unknown>)?.arguments === 'string'
          ? ((tc.function as Record<string, unknown>).arguments as string)
          : JSON.stringify(
              (tc.function as Record<string, unknown>)?.arguments ?? tc.input ?? '',
            ),
    }));
  }
  // Anthropic format: content blocks with type 'tool_use'
  if (Array.isArray(msg.content)) {
    return (msg.content as Record<string, unknown>[])
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        id: (block.id as string) || '',
        name: (block.name as string) || '',
        arguments:
          typeof block.input === 'string'
            ? block.input
            : JSON.stringify(block.input ?? {}),
      }));
  }
  return [];
}

/**
 * Aggregate token usage across observations, grouped by agent and model.
 */
export function aggregateTokenUsage(observations: LangfuseObservation[]): TokenSummary {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let llmCallCount = 0;
  const agentMap = new Map<string, AgentTokenBreakdown>();
  const modelMap = new Map<string, ModelTokenBreakdown>();

  for (const obs of observations) {
    if (obs.type !== 'GENERATION') continue;

    const promptTok = obs.promptTokens ?? 0;
    const completionTok = obs.completionTokens ?? 0;
    const totalTok = obs.totalTokens ?? promptTok + completionTok;

    inputTokens += promptTok;
    outputTokens += completionTok;
    totalTokens += totalTok;
    llmCallCount++;

    // By agent
    const agentName =
      (obs.metadata?.['gibson.agent.name'] as string) || 'orchestrator';
    const existing = agentMap.get(agentName);
    if (existing) {
      existing.inputTokens += promptTok;
      existing.outputTokens += completionTok;
      existing.totalTokens += totalTok;
      existing.callCount++;
    } else {
      agentMap.set(agentName, {
        agentName,
        inputTokens: promptTok,
        outputTokens: completionTok,
        totalTokens: totalTok,
        callCount: 1,
      });
    }

    // By model
    const model = obs.model || 'unknown';
    const existingModel = modelMap.get(model);
    if (existingModel) {
      existingModel.inputTokens += promptTok;
      existingModel.outputTokens += completionTok;
      existingModel.totalTokens += totalTok;
      existingModel.callCount++;
    } else {
      modelMap.set(model, {
        model,
        inputTokens: promptTok,
        outputTokens: completionTok,
        totalTokens: totalTok,
        callCount: 1,
        estimatedCostUsd: 0,
      });
    }
  }

  // Calculate cost estimates per model
  for (const breakdown of modelMap.values()) {
    breakdown.estimatedCostUsd = estimateCost(
      breakdown.model,
      breakdown.inputTokens,
      breakdown.outputTokens,
    );
  }

  const estimatedCostUsd = Array.from(modelMap.values()).reduce(
    (sum, m) => sum + m.estimatedCostUsd,
    0,
  );

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd,
    llmCallCount,
    byAgent: Array.from(agentMap.values()),
    byModel: Array.from(modelMap.values()),
  };
}

/**
 * Estimate cost in USD based on model name and token counts.
 * Uses approximate per-model pricing. Returns 0 for unknown models.
 *
 * Exported as estimateStepCostUsd for client-side per-step cost display
 * (e.g. the train-of-thought timeline); the aggregate path uses it too.
 */
export function estimateStepCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  return estimateCost(model, inputTokens, outputTokens);
}

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const m = model.toLowerCase();
  // Prices per 1M tokens: [inputPrice, outputPrice]
  const pricing: Record<string, [number, number]> = {
    'claude-3-5-sonnet': [3, 15],
    'claude-3-opus': [15, 75],
    'claude-3-haiku': [0.25, 1.25],
    'claude-sonnet-4': [3, 15],
    'claude-opus-4': [15, 75],
    'gpt-4o': [2.5, 10],
    'gpt-4o-mini': [0.15, 0.6],
    'gpt-4-turbo': [10, 30],
    'gemini-1.5-pro': [1.25, 5],
    'gemini-1.5-flash': [0.075, 0.3],
    'gemini-2.0-flash': [0.1, 0.4],
  };

  for (const [key, [inputPrice, outputPrice]] of Object.entries(pricing)) {
    if (m.includes(key)) {
      return (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;
    }
  }
  return 0;
}

/**
 * Format token count for display: 12432 → "12.4k", 1234567 → "1.2M"
 */
export function formatTokenCount(count: number): string {
  if (count === 0) return '0';
  if (count < 1000) return count.toString();
  if (count < 1_000_000) {
    const k = count / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${parseFloat(k.toFixed(1))}k`;
  }
  const m = count / 1_000_000;
  return `${parseFloat(m.toFixed(1))}M`;
}

/**
 * Extract decision entries from observations for the DecisionTimeline.
 */
export function extractDecisions(observations: LangfuseObservation[]): DecisionEntry[] {
  return observations
    .filter(
      (obs) =>
        obs.type === 'GENERATION' &&
        (obs.name?.includes('decision') ||
          obs.name?.includes('gen_ai.chat') ||
          obs.name?.includes('orchestrat')),
    )
    .map((obs) => {
      const metadata = obs.metadata || {};
      return {
        id: obs.id,
        timestamp: new Date(obs.startTime),
        action: (metadata['orchestrator.action'] as string) || 'llm_call',
        targetAgent: metadata['orchestrator.target_agent'] as string | undefined,
        confidence: (metadata['orchestrator.confidence'] as number) ?? 1,
        reasoning: (metadata['orchestrator.reasoning'] as string) || '',
        model: obs.model || 'unknown',
        inputTokens: obs.promptTokens ?? 0,
        outputTokens: obs.completionTokens ?? 0,
        latencyMs: obs.endTime
          ? new Date(obs.endTime).getTime() - new Date(obs.startTime).getTime()
          : 0,
        status: obs.level === 'ERROR' ? ('error' as const) : ('ok' as const),
        errorMessage: obs.level === 'ERROR' ? obs.statusMessage : undefined,
        contentAvailable: obs.input != null || obs.output != null,
      };
    })
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
