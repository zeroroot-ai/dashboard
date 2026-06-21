/**
 * world-traces — pure projection of the brain World's LLM-call log into the
 * Gibson Traces UI shapes (gibson#755).
 *
 * The daemon's `gibson.world.v1.WorldService` returns flat `LlmCallView` /
 * `LlmCallDetail` messages. This module maps those proto messages into the
 * `LlmCallSummary` / `LlmRun` / `TokenSummary` / `LlmCallDetailData` shapes the
 * UI renders, groups calls into runs by `runId`, and aggregates by-model token
 * spend with a static per-model price table. Pure + dependency-free so it is
 * unit-testable without a daemon (replaces the Langfuse-shaped trace-utils +
 * trace-runs).
 */

import type { LlmCallView, LlmCallDetail } from '@/src/gen/gibson/world/v1/world_pb';
import type {
  LlmCallSummary,
  LlmRun,
  TokenSummary,
  ModelTokenBreakdown,
  ConversationMessage,
  MessageRole,
  LlmCallDetailData,
} from '@/src/types/trace';

// ---------------------------------------------------------------------------
// proto → UI adapters
// ---------------------------------------------------------------------------

/** Map a proto `LlmCallView` to the UI `LlmCallSummary` (adds totalTokens). */
export function adaptCallView(c: LlmCallView): LlmCallSummary {
  return {
    callId: c.callId,
    runId: c.runId,
    model: c.model,
    scopeId: c.scopeId,
    promptTokens: c.promptTokens,
    completionTokens: c.completionTokens,
    totalTokens: c.promptTokens + c.completionTokens,
  };
}

const ROLES: ReadonlySet<string> = new Set(['system', 'user', 'assistant', 'tool']);

function normalizeRole(role: string): MessageRole {
  return ROLES.has(role) ? (role as MessageRole) : 'user';
}

/** Map a proto `LlmCallDetail` to the UI `LlmCallDetailData` (with transcript). */
export function adaptCallDetail(c: LlmCallDetail): LlmCallDetailData {
  return {
    callId: c.callId,
    runId: c.runId,
    model: c.model,
    scopeId: c.scopeId,
    promptTokens: c.promptTokens,
    completionTokens: c.completionTokens,
    totalTokens: c.promptTokens + c.completionTokens,
    messages: c.messages.map(
      (m): ConversationMessage => ({ role: normalizeRole(m.role), content: m.content }),
    ),
    completion: c.completion,
  };
}

// ---------------------------------------------------------------------------
// run grouping
// ---------------------------------------------------------------------------

const UNGROUPED_LABEL = 'Ungrouped calls';

/**
 * Group a flat call list into runs by `runId`. Calls with an empty run id
 * collapse into a single synthetic ungrouped run. Run order follows first
 * appearance; calls within a run keep their input order.
 */
export function groupCallsIntoRuns(calls: LlmCallSummary[]): LlmRun[] {
  const order: string[] = [];
  const byRun = new Map<string, LlmCallSummary[]>();

  for (const call of calls) {
    const key = call.runId || '';
    const existing = byRun.get(key);
    if (existing) {
      existing.push(call);
    } else {
      byRun.set(key, [call]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const group = byRun.get(key)!;
    const models = new Set<string>();
    let promptTokens = 0;
    let completionTokens = 0;
    let estimatedCostUsd = 0;

    for (const c of group) {
      if (c.model) models.add(c.model);
      promptTokens += c.promptTokens;
      completionTokens += c.completionTokens;
      estimatedCostUsd += estimateCallCostUsd(c.model, c.promptTokens, c.completionTokens);
    }

    return {
      id: key,
      label: key || UNGROUPED_LABEL,
      models: Array.from(models),
      callCount: group.length,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCostUsd,
      calls: group,
    };
  });
}

// ---------------------------------------------------------------------------
// token / spend aggregation
// ---------------------------------------------------------------------------

/** Aggregate a call list into a by-model `TokenSummary`. */
export function aggregateCalls(calls: LlmCallSummary[]): TokenSummary {
  const byModel = new Map<string, ModelTokenBreakdown>();
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd = 0;

  for (const c of calls) {
    inputTokens += c.promptTokens;
    outputTokens += c.completionTokens;
    const cost = estimateCallCostUsd(c.model, c.promptTokens, c.completionTokens);
    estimatedCostUsd += cost;

    const model = c.model || 'unknown';
    const row = byModel.get(model) ?? {
      model,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      callCount: 0,
      estimatedCostUsd: 0,
    };
    row.inputTokens += c.promptTokens;
    row.outputTokens += c.completionTokens;
    row.totalTokens += c.totalTokens;
    row.callCount += 1;
    row.estimatedCostUsd += cost;
    byModel.set(model, row);
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd,
    llmCallCount: calls.length,
    byModel: Array.from(byModel.values()),
  };
}

// ---------------------------------------------------------------------------
// cost estimation + formatting (kept from the retired trace-utils)
// ---------------------------------------------------------------------------

/**
 * Estimate a single call's cost in USD from model name + token counts using an
 * approximate per-model price table. Returns 0 for unknown models.
 */
export function estimateCallCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const m = (model || '').toLowerCase();
  // Prices per 1M tokens: [inputPrice, outputPrice].
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
 * Format a USD amount for display: 0 → "$0.00", 0.004 → "<$0.01",
 * 1.2345 → "$1.23". The string carries the leading "$".
 */
export function formatUsd(usd: number): string {
  if (usd <= 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** Format a token count: 12432 → "12.4k", 1234567 → "1.2M". */
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
