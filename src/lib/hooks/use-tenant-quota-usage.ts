"use client";

/**
 * useTenantQuotaUsage, React Query hook over the getQuotaUsage Server
 * Action. Spec plans-and-quotas-simplification R9.B.
 *
 * Defaults: refetchInterval=30s, staleTime=30s. Call queryClient
 * .invalidateQueries({ queryKey: ['tenant-quota-usage'] }) on quota-
 * mutating actions (mission submit success, agent registration, etc.)
 * so the widget doesn't lag behind the server-side counter.
 */

import { useQuery } from "@tanstack/react-query";

import { getQuotaUsage, type QuotaUsage } from "@/app/(authenticated)/_actions/quota";

export const TENANT_QUOTA_USAGE_QUERY_KEY = "tenant-quota-usage";

export function useTenantQuotaUsage() {
  return useQuery<QuotaUsage | null>({
    queryKey: [TENANT_QUOTA_USAGE_QUERY_KEY],
    queryFn: async () => {
      const usage = await getQuotaUsage();
      return usage;
    },
    refetchInterval: 30_000,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
