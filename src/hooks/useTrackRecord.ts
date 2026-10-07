// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

/**
 * React Query hooks for the track record of a technique (gibson#619,
 * dashboard#192): the scopes of the tenant's World, and the record of one
 * technique in one scope. Both read the dashboard's own API routes, which
 * call WorldService through the user client.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useTenantId } from '@/src/lib/auth/tenant';
import { queryKeys } from '@/src/lib/query/keys';
import type { MissionTechniques, TrackRecord } from '@/src/types/calibration';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** The scope ids of the hosts in the tenant's World. */
export function useWorldScopes(): UseQueryResult<string[], Error> {
  const tenantId = useTenantId() ?? '';
  return useQuery({
    queryKey: queryKeys.calibration.scopes(tenantId),
    queryFn: async () => (await getJson<{ scopes: string[] }>('/api/world/scopes')).scopes,
    staleTime: 30_000,
  });
}

/** The track record of one technique in one scope. Idle until both are set. */
export function useTrackRecord(
  technique: string,
  scopeId: string,
): UseQueryResult<TrackRecord, Error> {
  const tenantId = useTenantId() ?? '';
  return useQuery({
    queryKey: queryKeys.calibration.trackRecord(tenantId, technique, scopeId),
    queryFn: () =>
      getJson<TrackRecord>(
        `/api/world/reputation?technique=${encodeURIComponent(technique)}&scope=${encodeURIComponent(scopeId)}`,
      ),
    enabled: technique !== '' && scopeId !== '',
    staleTime: 30_000,
  });
}

/** The techniques one mission used, each in its scope. Idle until the mission id is set. */
export function useMissionTechniques(missionId: string): UseQueryResult<MissionTechniques, Error> {
  const tenantId = useTenantId() ?? '';
  return useQuery({
    queryKey: queryKeys.calibration.missionTechniques(tenantId, missionId),
    queryFn: () =>
      getJson<MissionTechniques>(`/api/missions/${encodeURIComponent(missionId)}/techniques`),
    enabled: missionId !== '',
    staleTime: 30_000,
  });
}
