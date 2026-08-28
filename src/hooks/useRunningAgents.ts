'use client';

/**
 * useRunningAgents, the live list of the active tenant's currently running
 * agent instances for the read-only agent console (ADR-0016 S12,
 * dashboard#1134).
 *
 * Fetches GET /api/agents/running and re-polls so the console picks up agents
 * that start or finish while the page is open. The tenant scope is derived
 * server-side (the route resolves the active tenant and the daemon derives the
 * scope from the authenticated identity); the client never passes a tenant and
 * never re-filters.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { RunningAgentView } from '@/src/lib/gibson-client/agent-console';

const POLL_INTERVAL_MS = 10_000;

async function fetchRunningAgents(): Promise<RunningAgentView[]> {
  const res = await fetch('/api/agents/running');
  if (!res.ok) {
    throw new Error(`Failed to list running agents: ${res.statusText}`);
  }
  const body = (await res.json()) as { data?: RunningAgentView[] };
  return body.data ?? [];
}

export function useRunningAgents(): UseQueryResult<RunningAgentView[]> {
  return useQuery<RunningAgentView[]>({
    queryKey: ['running-agents'],
    queryFn: fetchRunningAgents,
    refetchInterval: POLL_INTERVAL_MS,
  });
}
