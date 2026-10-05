// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

/**
 * React Query hook for the ADR-0122 reliability/calibration report (gibson#284,
 * dashboard#98). Reads go to GET /api/world/calibration, a real network call
 * against the dashboard's own API route — never a fixture — so the reliability
 * diagram shows exactly what the daemon computed from the tenant's settled bets.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useTenantId } from '@/src/lib/auth/tenant';
import { queryKeys } from '@/src/lib/query/keys';
import type { CalibrationReport } from '@/src/types/calibration';

async function fetchCalibration(bins: number): Promise<CalibrationReport> {
  const res = await fetch(`/api/world/calibration?bins=${bins}`, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(body.error?.message ?? `Failed to load the reliability report (HTTP ${res.status})`);
  }
  return (await res.json()) as CalibrationReport;
}

/**
 * The tenant's reliability report at a given bin resolution. `bins` is the
 * curve's predicted-probability resolution (<= 0 uses the daemon default).
 */
export function useCalibration(bins: number): UseQueryResult<CalibrationReport, Error> {
  const tenantId = useTenantId() ?? '';
  return useQuery({
    queryKey: queryKeys.calibration.report(tenantId, bins),
    queryFn: () => fetchCalibration(bins),
    staleTime: 30_000,
  });
}
