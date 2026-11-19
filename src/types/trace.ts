// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Trace display types — backed by the ECS brain World (gibson#755).
 *
 * The Gibson Traces surface reads `gibson.world.v1.WorldService.ListLlmCalls` /
 * `GetLlmCall`: a flat log of LLM completions folded into the per-tenant World,
 * replacing the retired Langfuse trace/observation tree. Each LLM call carries
 * model + token metadata and (on detail) its request items and output items.
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
// Model call detail types
// ============================================================================

/**
 * One Open Responses item of a model call, parsed for display.
 *
 * `text` is an item that is a JSON string, or a JSON text that does not parse.
 * `unknown` is an item of a type that the view does not know. Its `json` is the
 * raw JSON. All strings are untrusted. The view shows them as text.
 */
export type ModelCallItem =
  | { kind: 'message'; role: string; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'function_call'; name: string; callId: string; arguments: string }
  | { kind: 'function_call_output'; callId: string; output: string }
  | { kind: 'text'; text: string }
  | { kind: 'unknown'; json: string };

/** The full record of one model call (a `gibson.world.v1.LlmCallDetail`). */
export interface LlmCallDetailData {
  callId: string;
  runId: string;
  model: string;
  scopeId: string;
  /** The provider of the model, for example "openai". Empty when unknown. */
  provider: string;
  /** The HTTP status of the gateway reply. 0 when unknown. */
  httpStatus: number;
  /** True when the HTTP status is 400 or more. */
  failed: boolean;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** US dollars as a decimal string. Empty when the gateway had no price. */
  cost: string;
  /** The reply text of a failed model call. Empty for a call that worked. */
  errorText: string;
  /** The items that the caller sent to the model, in order. */
  requestItems: ModelCallItem[];
  /** The items that the model returned, in order. */
  outputItems: ModelCallItem[];
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
