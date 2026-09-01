'use client';

/** The jobs a mission run's job nodes opened (gibson#1706 lane E5). */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useTenantId } from '@/src/lib/auth/tenant';
import type { JobView } from '@/src/lib/jobs/view';

const POLL_MS = 10_000;

async function fetchRunJobs(missionId: string): Promise<JobView[]> {
  const res = await fetch(`/api/missions/${encodeURIComponent(missionId)}/jobs`);
  if (!res.ok) throw new Error(`Failed to list the run's jobs: ${res.statusText}`);
  const body = (await res.json()) as { data?: JobView[] };
  return body.data ?? [];
}

export function useRunJobs(missionId: string): UseQueryResult<JobView[]> {
  const tenantId = useTenantId() ?? '';
  return useQuery({
    queryKey: ['jobs', tenantId, 'run', missionId],
    queryFn: () => fetchRunJobs(missionId),
    enabled: missionId !== '',
    refetchInterval: POLL_MS,
  });
}
