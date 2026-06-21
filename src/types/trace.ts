/**
 * Trace display types — backed by the ECS brain World (gibson#755).
 *
 * The Gibson Traces surface reads `gibson.world.v1.WorldService.ListLlmCalls` /
 * `GetLlmCall`: a flat log of LLM completions folded into the per-tenant World,
 * replacing the retired Langfuse trace/observation tree. Each LLM call carries
 * model + token metadata and (on detail) its prompt transcript + completion.
 * Calls are grouped into "runs" by the AgentRun (`runId`) that issued them.
 */

// ============================================================================
// LLM call + run types
// ============================================================================

/** One LLM call's metadata (a `gibson.world.v1.LlmCallView`). */
export interface LlmCallSummary {
  callId: string;
  /** The AgentRun that issued the call ("" for mission/chat-level calls). */
  runId: string;
  model: string;
  scopeId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * A run is the set of LLM calls sharing a `runId` — the work a single AgentRun
 * drove through the model. Calls with no run id ("") collapse into one
 * synthetic "ungrouped" run so the list is never lossy.
 */
export interface LlmRun {
  /** runId, or the sentinel "" rendered as ungrouped. */
  id: string;
  label: string;
  /** Distinct models used across the run's calls. */
  models: string[];
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  /** The run's calls, in observation order. */
  calls: LlmCallSummary[];
}

// ============================================================================
// Token / spend aggregation
// ============================================================================

export interface ModelTokenBreakdown {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  callCount: number;
  estimatedCostUsd: number;
}

/**
 * Aggregate token + cost summary for a run. The World attributes calls by
 * model only (there is no per-agent token attribution in the call log), so the
 * breakdown is by-model.
 */
export interface TokenSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  llmCallCount: number;
  byModel: ModelTokenBreakdown[];
}

// ============================================================================
// Transcript types
// ============================================================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ConversationMessage {
  role: MessageRole;
  content: string;
  name?: string;
}

/** One call's full record incl. transcript (a `gibson.world.v1.LlmCallDetail`). */
export interface LlmCallDetailData {
  callId: string;
  runId: string;
  model: string;
  scopeId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** The prompt messages sent to the model. */
  messages: ConversationMessage[];
  /** The assistant's completion text. */
  completion: string;
}

// ============================================================================
// API payload shapes
// ============================================================================

export interface RunListResponse {
  runs: LlmRun[];
}

export interface RunDetailResponse {
  run: LlmRun;
  tokenSummary: TokenSummary;
}
