'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { queryKeys } from '@/src/lib/query/keys';
import { useTenantStore } from '@/src/stores/tenant-store';
import type { LlmRun, RunDetailResponse, LlmCallDetailData } from '@/src/types/trace';

/**
 * Gibson Traces hooks — backed by the brain World LLM-call log (gibson#755).
 *
 *   useRuns()                  → GET /api/traces            (runs across the tenant)
 *   useRunDetail(runId)        → GET /api/traces/runs/[id]  (one run + token summary)
 *   useCallTranscript(callId)  → GET /api/traces/calls/[id] (one call's transcript)
 *
 * The World call log is append-only and immutable once recorded, so detail and
 * transcript are cached aggressively; the run list refreshes on a short stale
 * window so newly-recorded calls surface without a manual refetch.
 */

// ---------- fetchers ----------

async function fetchRuns(): Promise<LlmRun[]> {
  const res = await fetch('/api/traces');
  if (!res.ok) {
    if (res.status === 503) throw new Error('Trace data temporarily unavailable');
    throw new Error(`Failed to fetch traces: ${res.statusText}`);
  }
  const json = (await res.json()) as { runs: LlmRun[] };
  return json.runs;
}

/** The empty (ungrouped) run id is encoded as the URL-safe segment "_". */
function runSegment(runId: string): string {
  return runId === '' ? '_' : encodeURIComponent(runId);
}

async function fetchRunDetail(runId: string): Promise<RunDetailResponse> {
  const res = await fetch(`/api/traces/runs/${runSegment(runId)}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Run not available');
    if (res.status === 503) throw new Error('Trace data temporarily unavailable');
    throw new Error(`Failed to fetch run: ${res.statusText}`);
  }
  return (await res.json()) as RunDetailResponse;
}

async function fetchCallTranscript(callId: string): Promise<LlmCallDetailData> {
  const res = await fetch(`/api/traces/calls/${encodeURIComponent(callId)}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error('Call not available');
    throw new Error(`Failed to fetch call: ${res.statusText}`);
  }
  return (await res.json()) as LlmCallDetailData;
}

// ---------- hooks ----------

/** Fetch the tenant-wide list of runs (LLM calls grouped by run id). */
export function useRuns(): UseQueryResult<LlmRun[], Error> {
  const tenantId = useTenantStore((state) => state.currentTenant?.id);
  return useQuery({
    queryKey: queryKeys.traces.runs(tenantId ?? ''),
    queryFn: fetchRuns,
    staleTime: 10_000,
  });
}

/** Fetch one run's calls + by-model token summary. */
export function useRunDetail(runId: string): UseQueryResult<RunDetailResponse, Error> {
  const tenantId = useTenantStore((state) => state.currentTenant?.id);
  return useQuery({
    queryKey: queryKeys.traces.run(tenantId ?? '', runId),
    queryFn: () => fetchRunDetail(runId),
    staleTime: 60_000,
    // runId === '' is the valid "ungrouped" run, so do not gate on truthiness.
    retry: (failureCount, error) => {
      if (error.message.includes('not available')) return false;
      return failureCount < 2;
    },
  });
}

/**
 * Fetch one call's transcript on demand (when a call row is expanded). Call
 * content is immutable, so it never goes stale.
 */
export function useCallTranscript(
  callId: string,
  enabled: boolean,
): UseQueryResult<LlmCallDetailData, Error> {
  const tenantId = useTenantStore((state) => state.currentTenant?.id);
  return useQuery({
    queryKey: queryKeys.traces.call(tenantId ?? '', callId),
    queryFn: () => fetchCallTranscript(callId),
    staleTime: Infinity,
    enabled: enabled && !!callId,
  });
}
