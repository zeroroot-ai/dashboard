/**
 * Trace Display Type Definitions
 * Types for the multi-tenant trace viewer feature
 */

// ============================================================================
// Trace-level Types
// ============================================================================

export interface TraceData {
  traceId: string;
  missionId: string;
  startTime: Date;
  endTime?: Date;
  totalDurationMs: number;
  tokenSummary: TokenSummary;
  decisions: DecisionEntry[];
  traceTree: TraceNode[];
}

export interface TokenSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  llmCallCount: number;
  byAgent: AgentTokenBreakdown[];
  byModel: ModelTokenBreakdown[];
}

export interface AgentTokenBreakdown {
  agentName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  callCount: number;
}

export interface ModelTokenBreakdown {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  callCount: number;
  estimatedCostUsd: number;
}

// ============================================================================
// Decision Types
// ============================================================================

export interface DecisionEntry {
  id: string;
  timestamp: Date;
  action: string;
  targetAgent?: string;
  confidence: number;
  reasoning: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: 'ok' | 'error';
  errorMessage?: string;
  contentAvailable: boolean;
  conversation?: ConversationMessage[];
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ConversationMessage {
  role: MessageRole;
  content: string;
  name?: string;
  toolCalls?: ToolCallBlock[];
  toolCallId?: string;
}

export interface ToolCallBlock {
  id: string;
  name: string;
  arguments: string;
}

export interface GenerationMetadata {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
}

// ============================================================================
// Trace Tree Types
// ============================================================================

export type TraceNodeType = 'mission' | 'decision' | 'agent' | 'tool' | 'generation' | 'span';

export interface TraceNode {
  id: string;
  name: string;
  type: TraceNodeType;
  startTime: Date;
  endTime?: Date;
  durationMs: number;
  status: 'ok' | 'error';
  errorMessage?: string;
  tokens?: { input: number; output: number };
  model?: string;
  children: TraceNode[];
}

// ============================================================================
// Tenant-wide trace list types
// ============================================================================

/**
 * A trace as it appears in the tenant-wide trace list — a projection of the
 * upstream trace record with no observations (those load on detail open).
 */
export interface TraceSummary {
  id: string;
  name: string;
  timestamp: string;
  status: 'ok' | 'error';
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  tags: string[];
  sessionId?: string;
}

export interface TraceListMeta {
  page: number;
  totalPages: number;
  totalItems: number;
}

export interface TraceListResponse {
  data: TraceSummary[];
  meta: TraceListMeta;
}
