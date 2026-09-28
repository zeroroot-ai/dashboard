// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

/**
 * React Query hooks for the ADR-0028 destructive-action authorization queue
 * (gibson#278, dashboard#99). Reads go to GET /api/world/destructive-actions,
 * decisions POST through `apiFetch` (CSRF). Both are real network calls
 * against the dashboard's own API route — never a fixture — so the queue
 * shown here is exactly what `src/lib/destructive-actions/client.ts` reports
 * (including its honest "backend not wired yet" state).
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from '@/src/lib/api/fetch';
import { useTenantId } from '@/src/lib/auth/tenant';
import { queryKeys } from '@/src/lib/query/keys';
import type {
  DestructiveActionDecision,
  DestructiveActionQueueResponse,
} from '@/src/types/destructive-actions';

interface ApiError {
  error?: { code?: string; message?: string };
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as ApiError;
  return new Error(body.error?.message ?? `${fallback} (HTTP ${res.status})`);
}

async function fetchDestructiveActions(): Promise<DestructiveActionQueueResponse> {
  const res = await fetch('/api/world/destructive-actions', { cache: 'no-store' });
  if (!res.ok) throw await readError(res, 'Failed to load the destructive-action queue');
  return (await res.json()) as DestructiveActionQueueResponse;
}

/**
 * The tenant's pending destructive actions. Polls so a newly-requested
 * action (or another reviewer's decision) shows up without a manual refresh.
 */
export function useDestructiveActions(): UseQueryResult<DestructiveActionQueueResponse, Error> {
  const tenantId = useTenantId() ?? '';
  return useQuery({
    queryKey: queryKeys.destructiveActions.list(tenantId),
    queryFn: fetchDestructiveActions,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

interface DecideVariables {
  id: string;
  decision: DestructiveActionDecision;
  reason?: string;
}

/**
 * Records one human's approve/deny decision for a specific pending action.
 * Per-action: this never touches any other pending action or the mission
 * itself (ADR-0028 §2 — the fleet keeps working everything else).
 */
export function useDecideDestructiveAction() {
  const qc = useQueryClient();
  const tenantId = useTenantId() ?? '';
  return useMutation({
    mutationFn: async (vars: DecideVariables): Promise<void> => {
      const res = await apiFetch('/api/world/destructive-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      });
      if (!res.ok) throw await readError(res, 'Failed to record the decision');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.destructiveActions.list(tenantId) }),
  });
}
