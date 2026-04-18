'use client';

/**
 * Supported LLM Providers hook
 *
 * Wraps the daemon's GetSupportedProviders admin RPC so components can
 * render provider-configuration forms dynamically against whatever set of
 * providers the daemon actually supports — no drift between daemon and UI.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getSupportedProviders, type SupportedProviderDescriptor } from '@/src/lib/gibson-client';

export const supportedProvidersQueryKeys = {
  all: ['supportedProviders'] as const,
  list: () => [...supportedProvidersQueryKeys.all, 'list'] as const,
};

/**
 * Fetch the daemon-reported list of LLM provider types with their credential
 * schemas and default model catalogues.
 *
 * The result is cached for 5 minutes because the set is effectively static
 * (it changes only on daemon deploy). Consumers rendering a form should
 * gate on `isLoading`; the list is never empty on success.
 */
export function useSupportedProviders(): UseQueryResult<SupportedProviderDescriptor[], Error> {
  return useQuery({
    queryKey: supportedProvidersQueryKeys.list(),
    queryFn: async () => {
      const descriptors = await getSupportedProviders();
      return descriptors;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
