'use client';

/**
 * Supported LLM Providers hook
 *
 * Fetches from `/api/settings/providers/supported`, which delegates to the
 * daemon's `gibson.tenant.v1.TenantService/GetSupportedProviders` RPC
 * (spec providers-wizard). The RPC carries relation: "member" so any
 * authenticated user can fetch the static provider catalogue. Powers the
 * Settings → Providers wizard's type picker and dynamic credential form.
 *
 * The static TS mirror that briefly lived at
 * `src/lib/llm/provider-descriptors.ts` is gone — the daemon is the single
 * source of truth.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { SupportedProviderDescriptor } from '@/src/lib/gibson-client-types';

export const supportedProvidersQueryKeys = {
  all: ['supportedProviders'] as const,
  list: () => [...supportedProvidersQueryKeys.all, 'list'] as const,
};

/**
 * Returns the daemon's static catalogue of supported LLM providers.
 *
 * `staleTime: 5min` — the catalogue only changes when the daemon image is
 * upgraded; a 5-minute cache keeps the wizard snappy without holding a
 * stale list across a deploy roll.
 */
export function useSupportedProviders(): UseQueryResult<SupportedProviderDescriptor[], Error> {
  return useQuery({
    queryKey: supportedProvidersQueryKeys.list(),
    queryFn: async (): Promise<SupportedProviderDescriptor[]> => {
      const res = await fetch('/api/settings/providers/supported');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(
          body?.error?.message ??
            `Failed to fetch supported providers (HTTP ${res.status})`,
        );
      }
      const json = (await res.json()) as { providers: SupportedProviderDescriptor[] };
      return json.providers ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}
