import 'server-only';

import type { ObservationRecord } from '@/src/gen/gibson/traces/v1/traces_pb';
import {
  buildTraceTree,
  aggregateTokenUsage,
  extractDecisions,
  extractMessages,
} from '@/src/lib/trace-utils';
import { timestampToISO } from '@/src/lib/gibson-client';

/**
 * Daemon-native trace assembly for the Gibson Traces routes.
 *
 * Both /api/missions/[id]/traces (mission-correlated) and
 * /api/traces/[traceId] (direct lookup) build the same TraceData shape.
 * Both observation-detail lookups build the same shape.
 *
 * Replaces trace-detail.ts (deleted as part of dashboard#588 TracesService
 * cutover). All Langfuse credentials and HTTP calls are now handled by the
 * daemon; the dashboard receives plain ObservationRecord proto messages and
 * maps them into the canonical UI shapes here.
 *
 * Server-only: never importable from browser code.
 */

// ---------------------------------------------------------------------------
// ObservationRecord → internal observation shape adapter
// ---------------------------------------------------------------------------

/**
 * The internal observation shape consumed by trace-utils.ts functions.
 * This mirrors the old LangfuseObservation type.
 */
interface InternalObservation {
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
 * Convert a proto ObservationRecord to the internal observation shape.
 * - Timestamps are proto `google.protobuf.Timestamp` → ISO string.
 * - input_json / output_json / metadata_json are JSON strings → parsed objects.
 * - Token counts are int64 bigint → number.
 * - Type/level strings are mapped directly (proto uses same string values).
 */
function adaptObservation(obs: ObservationRecord): InternalObservation {
  // Parse JSON fields; tolerate empty/invalid JSON by returning undefined.
  function tryParse(json: string): unknown {
    if (!json) return undefined;
    try {
      return JSON.parse(json);
    } catch {
      return undefined;
    }
  }

  const metadata = tryParse(obs.metadataJson) as Record<string, unknown> | undefined;

  return {
    id: obs.id,
    traceId: obs.traceId,
    type: (obs.type as 'GENERATION' | 'SPAN' | 'EVENT') || 'SPAN',
    name: obs.name,
    startTime: timestampToISO(obs.startTime) ?? new Date().toISOString(),
    endTime: obs.endTime ? (timestampToISO(obs.endTime) ?? undefined) : undefined,
    parentObservationId: obs.parentObservationId || undefined,
    model: obs.model || undefined,
    input: tryParse(obs.inputJson),
    output: tryParse(obs.outputJson),
    metadata,
    promptTokens: obs.promptTokens ? Number(obs.promptTokens) : undefined,
    completionTokens: obs.completionTokens ? Number(obs.completionTokens) : undefined,
    totalTokens: obs.totalTokens ? Number(obs.totalTokens) : undefined,
    level: (obs.level as 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR') || 'DEFAULT',
    statusMessage: obs.statusMessage || undefined,
    // modelParameters is not in ObservationRecord (daemon strips it at this layer)
    modelParameters: undefined,
  };
}

// ---------------------------------------------------------------------------
// Public assembly helpers
// ---------------------------------------------------------------------------

/**
 * Build the canonical TraceData JSON for a trace id, given the trace record
 * and its observations (already fetched from the daemon).
 *
 * Matches the shape produced by the old assembleTraceData (trace-detail.ts).
 */
export function assembleTraceData(
  traceTimestamp: string,
  observations: ObservationRecord[],
  traceId: string,
  missionId?: string,
) {
  const adapted = observations.map(adaptObservation);

  const traceTree = buildTraceTree(adapted);
  const tokenSummary = aggregateTokenUsage(adapted);
  const decisions = extractDecisions(adapted);

  const startTime = traceTimestamp;
  const endTime =
    adapted.length > 0
      ? adapted.reduce((latest, obs) => {
          const end = obs.endTime || obs.startTime;
          return end > latest ? end : latest;
        }, adapted[0].startTime)
      : traceTimestamp;

  const totalDurationMs =
    new Date(endTime).getTime() - new Date(startTime).getTime();

  return {
    traceId,
    missionId: missionId ?? '',
    startTime,
    endTime,
    totalDurationMs,
    tokenSummary,
    decisions,
    traceTree,
  };
}

/**
 * Build the observation-detail JSON (conversation messages + metadata)
 * from a daemon ObservationRecord.
 *
 * Matches the shape produced by the old assembleObservationDetail
 * (trace-detail.ts).
 */
export function assembleObservationDetail(obs: ObservationRecord) {
  const adapted = adaptObservation(obs);
  const messages = extractMessages(adapted);
  const contentAvailable = adapted.input != null || adapted.output != null;

  return {
    id: adapted.id,
    contentAvailable,
    messages,
    metadata: {
      model: adapted.model || 'unknown',
      // modelParameters no longer available from ObservationRecord
      temperature: undefined as number | undefined,
      maxTokens: undefined as number | undefined,
      topP: undefined as number | undefined,
      inputTokens: adapted.promptTokens ?? 0,
      outputTokens: adapted.completionTokens ?? 0,
      latencyMs: adapted.endTime
        ? new Date(adapted.endTime).getTime() -
          new Date(adapted.startTime).getTime()
        : 0,
      estimatedCostUsd: 0, // Calculated client-side from model pricing
    },
  };
}
