// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

/**
 * React Query hooks for the ADR-0123 HITL bet-settlement queue (gibson#264/
 * #266/#280, dashboard#97). Reads go to GET /api/world/bet-settlements,
 * verdicts POST through `apiFetch` (CSRF). Both are real network calls
 * against the dashboard's own API route — never a fixture — so the queue
 * shown here is exactly what `WorldService.ListOpenBets` reports.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from '@/src/lib/api/fetch';
import { useTenantId } from '@/src/lib/auth/tenant';
import { queryKeys } from '@/src/lib/query/keys';
import type {
  BetVerdict,
  HitlSettleQueueResponse,
  HitlSettleVerdictResponse,
} from '@/src/types/hitl-settle';

interface ApiError {
  error?: { code?: string; message?: string };
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as ApiError;
  return new Error(body.error?.message ?? `${fallback} (HTTP ${res.status})`);
}

async function fetchOpenBets(): Promise<HitlSettleQueueResponse> {
  const res = await fetch('/api/world/bet-settlements', { cache: 'no-store' });
  if (!res.ok) throw await readError(res, 'Failed to load the HITL settle queue');
  return (await res.json()) as HitlSettleQueueResponse;
}

/**
 * The tenant's OPEN bets awaiting a human verdict. Polls so a newly-proposed
 * bet (or another reviewer's verdict) shows up without a manual refresh.
 * Judging is always asynchronous — this read never pauses the mission it's
 * drawn from (ADR-0108).
 */
export function useOpenBets(): UseQueryResult<HitlSettleQueueResponse, Error> {
  const tenantId = useTenantId() ?? '';
  return useQuery({
    queryKey: queryKeys.hitlSettle.list(tenantId),
    queryFn: fetchOpenBets,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

interface SubmitVerdictVariables {
  id: string;
  verdict: BetVerdict;
}

/**
 * Records one human's verdict for a specific OPEN bet. true_positive/
 * false_positive settle the bet; dismiss records a label without settling
 * (the daemon's own rule — see client.ts).
 */
export function useSubmitBetVerdict() {
  const qc = useQueryClient();
  const tenantId = useTenantId() ?? '';
  return useMutation({
    mutationFn: async (vars: SubmitVerdictVariables): Promise<HitlSettleVerdictResponse> => {
      const res = await apiFetch('/api/world/bet-settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      });
      if (!res.ok) throw await readError(res, 'Failed to record the verdict');
      return (await res.json()) as HitlSettleVerdictResponse;
    },
    // A verdict settles a bet, so both the open bets and the proofs that
    // wait for a review change. The prefix covers both lists.
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.hitlSettle.all }),
  });
}
