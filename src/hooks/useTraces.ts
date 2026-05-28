'use client';

import {
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';
import { queryKeys } from '@/src/lib/query/keys';
import { useTenantStore } from '@/src/stores/tenant-store';
import type { TraceData, TraceNode, DecisionEntry, ConversationMessage, GenerationMetadata } from '@/src/types/trace';
import type { MissionStatus } from '@/src/types';

// ---------- API client functions ----------

interface RawTraceNode extends Omit<TraceNode, 'startTime' | 'endTime' | 'children'> {
  startTime: string;
  endTime?: string;
  children?: RawTraceNode[];
}

interface RawDecisionEntry extends Omit<DecisionEntry, 'timestamp'> {
  timestamp: string;
}

interface TraceApiResponse {
  traceId: string;
  missionId: string;
  startTime: string;
  endTime?: string;
  totalDurationMs: number;
  tokenSummary: TraceData['tokenSummary'];
  decisions: RawDecisionEntry[];
  traceTree: RawTraceNode[];
}

function deserializeTraceNode(node: RawTraceNode): TraceNode {
  return {
    ...node,
    startTime: new Date(node.startTime),
    endTime: node.endTime ? new Date(node.endTime) : undefined,
    children: (node.children || []).map(deserializeTraceNode),
  };
}

/** Shared deserialization of the TraceData JSON returned by both trace routes. */
function deserializeTraceData(json: TraceApiResponse): TraceData {
  return {
    ...json,
    startTime: new Date(json.startTime),
    endTime: json.endTime ? new Date(json.endTime) : undefined,
    decisions: json.decisions.map((d) => ({
      ...d,
      timestamp: new Date(d.timestamp),
    })),
    traceTree: json.traceTree.map(deserializeTraceNode),
  };
}

async function fetchMissionTrace(missionId: string): Promise<TraceData> {
  const response = await fetch(`/api/missions/${missionId}/traces`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Traces not available for this mission');
    }
    if (response.status === 503) {
      throw new Error('Trace data temporarily unavailable');
    }
    throw new Error(`Failed to fetch traces: ${response.statusText}`);
  }

  return deserializeTraceData((await response.json()) as TraceApiResponse);
}

async function fetchTraceById(traceId: string): Promise<TraceData> {
  const response = await fetch(`/api/traces/${traceId}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Trace not available');
    }
    if (response.status === 503) {
      throw new Error('Trace data temporarily unavailable');
    }
    throw new Error(`Failed to fetch trace: ${response.statusText}`);
  }

  return deserializeTraceData((await response.json()) as TraceApiResponse);
}

interface ObservationDetailResponse {
  observation: {
    id: string;
    contentAvailable: boolean;
    messages: ConversationMessage[];
    metadata: GenerationMetadata;
  };
}

async function fetchObservationDetail(
  observationId: string
): Promise<ObservationDetailResponse['observation']> {
  const response = await fetch(`/api/traces/observations/${observationId}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch observation: ${response.statusText}`);
  }

  const json: ObservationDetailResponse = await response.json();
  return json.observation;
}

// ---------- Hooks ----------

/**
 * Fetch the full trace for a mission.
 * Cache strategy varies by mission status:
 * - Completed/failed/stopped: staleTime 60s (immutable data)
 * - Running/pending/paused: staleTime 5s + refetchInterval 10s
 */
export function useMissionTrace(
  missionId: string,
  missionStatus?: MissionStatus
): UseQueryResult<TraceData, Error> {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id;

  const isActive = missionStatus === 'running' || missionStatus === 'paused';

  return useQuery({
    queryKey: queryKeys.traces.mission(tenantId ?? '', missionId),
    queryFn: () => fetchMissionTrace(missionId),
    staleTime: isActive ? 5_000 : 60_000,
    refetchInterval: isActive ? 10_000 : false,
    enabled: !!missionId,
    retry: (failureCount, error) => {
      // Don't retry 404s (no trace data) or 403s
      if (error.message.includes('not available') || error.message.includes('Forbidden')) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

/**
 * Fetch the full trace for a trace id directly (no mission correlation).
 * Backs the standalone /dashboard/traces/[id] detail page. Trace content is
 * immutable once recorded, so staleTime is 60s.
 */
export function useTraceDetail(
  traceId: string
): UseQueryResult<TraceData, Error> {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id;

  return useQuery({
    queryKey: queryKeys.traces.detail(tenantId ?? '', traceId),
    queryFn: () => fetchTraceById(traceId),
    staleTime: 60_000,
    enabled: !!traceId,
    retry: (failureCount, error) => {
      if (error.message.includes('not available') || error.message.includes('Forbidden')) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

/**
 * Fetch a single observation's detail (conversation content).
 * Used for on-demand loading when user expands a decision. Mission-agnostic —
 * the observation id alone identifies the record. staleTime is Infinity since
 * observation content is immutable.
 */
export function useObservationDetail(
  observationId: string,
  enabled: boolean
): UseQueryResult<ObservationDetailResponse['observation'], Error> {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id;

  return useQuery({
    queryKey: queryKeys.traces.observation(tenantId ?? '', observationId),
    queryFn: () => fetchObservationDetail(observationId),
    staleTime: Infinity,
    enabled: enabled && !!observationId,
  });
}
