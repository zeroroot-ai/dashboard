import 'server-only';

import {
  LangfuseClient,
  type LangfuseObservation,
} from '@/src/lib/langfuse-client';
import {
  buildTraceTree,
  aggregateTokenUsage,
  extractDecisions,
  extractMessages,
} from '@/src/lib/trace-utils';

/**
 * Shared trace-assembly for the Gibson Traces routes. Both
 * /api/missions/[id]/traces (mission-correlated) and /api/traces/[traceId]
 * (direct lookup) build the same TraceData shape, and both observation-detail
 * lookups build the same shape — this module is the single source of that
 * assembly so the two surfaces never diverge.
 */

/** Build the canonical TraceData JSON for a trace id. */
export async function assembleTraceData(
  client: LangfuseClient,
  traceId: string,
  missionId?: string,
) {
  const [trace, observations] = await Promise.all([
    client.getTrace(traceId),
    client.getObservations(traceId),
  ]);

  const traceTree = buildTraceTree(observations);
  const tokenSummary = aggregateTokenUsage(observations);
  const decisions = extractDecisions(observations);

  const startTime = trace.timestamp;
  const endTime =
    observations.length > 0
      ? observations.reduce((latest, obs) => {
          const end = obs.endTime || obs.startTime;
          return end > latest ? end : latest;
        }, observations[0].startTime)
      : trace.timestamp;

  const totalDurationMs =
    new Date(endTime).getTime() - new Date(startTime).getTime();

  return {
    traceId: trace.id,
    missionId: missionId ?? '',
    startTime,
    endTime,
    totalDurationMs,
    tokenSummary,
    decisions,
    traceTree,
  };
}

/** Build the observation-detail JSON (conversation messages + metadata). */
export async function assembleObservationDetail(
  client: LangfuseClient,
  observationId: string,
) {
  const observation: LangfuseObservation =
    await client.getObservation(observationId);

  const messages = extractMessages(observation);
  const contentAvailable =
    observation.input != null || observation.output != null;

  return {
    id: observation.id,
    contentAvailable,
    messages,
    metadata: {
      model: observation.model || 'unknown',
      temperature: observation.modelParameters?.temperature as number | undefined,
      maxTokens: observation.modelParameters?.max_tokens as number | undefined,
      topP: observation.modelParameters?.top_p as number | undefined,
      inputTokens: observation.promptTokens ?? 0,
      outputTokens: observation.completionTokens ?? 0,
      latencyMs: observation.endTime
        ? new Date(observation.endTime).getTime() -
          new Date(observation.startTime).getTime()
        : 0,
      estimatedCostUsd: 0, // Calculated client-side from model pricing
    },
  };
}
