// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI
'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/src/lib/query/keys';
import { useTenantId } from '@/src/lib/auth/tenant';
import type { UserRefView } from '@/src/lib/principals/label';

async function fetchUserRefs(ids: string[]): Promise<Map<string, UserRefView>> {
  const res = await fetch(`/api/users/resolve?ids=${encodeURIComponent(ids.join(','))}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Failed to resolve users (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { data?: UserRefView[] };
  return new Map((body.data ?? []).map((r) => [r.userId, r]));
}

/**
 * Resolves user ids to names for display. Pass the ids sorted and distinct
 * (userIdsToResolve does that) so equal sets share one cache entry. A person
 * who left the tenant resolves to state "removed".
 */
export function useUserRefs(ids: string[]) {
  const tenantId = useTenantId() ?? '';
  return useQuery({
    queryKey: queryKeys.users.resolve(tenantId, ids),
    queryFn: () => fetchUserRefs(ids),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
}
