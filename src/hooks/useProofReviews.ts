// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

/**
 * React Query hook for the proofs that wait for a human review
 * (dashboard#228). It reads GET /api/world/proof-reviews one page at a time.
 * A verdict goes through useSubmitBetVerdict, which invalidates this list
 * too, because a settled bet leaves it.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { useTenantId } from '@/src/lib/auth/tenant';
import { queryKeys } from '@/src/lib/query/keys';
import type { ProofReviewPage } from '@/src/types/proof-review';

interface ApiError {
  error?: { code?: string; message?: string };
}

async function fetchProofReviewPage(pageToken: string): Promise<ProofReviewPage> {
  const qs = pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : '';
  const res = await fetch(`/api/world/proof-reviews${qs}`, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiError;
    throw new Error(body.error?.message ?? `Failed to load the proofs (HTTP ${res.status})`);
  }
  return (await res.json()) as ProofReviewPage;
}

export function useProofReviews() {
  const tenantId = useTenantId() ?? '';
  return useInfiniteQuery({
    queryKey: queryKeys.hitlSettle.proofReviews(tenantId),
    queryFn: ({ pageParam }: { pageParam: string }) => fetchProofReviewPage(pageParam),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextPageToken || undefined,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}
