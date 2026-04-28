'use client';

/**
 * Supported LLM Providers hook
 *
 * GetSupportedProviders has been DELETED per admin-services-completion spec
 * (design.md disposition: Bucket C). This hook returns an empty list so
 * components that previously rendered provider-type selector forms degrade
 * gracefully.
 *
 * Form rendering should use existing provider configuration from ListProviders
 * rather than a separate descriptor list.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { SupportedProviderDescriptor } from '@/src/lib/gibson-client-types';

export const supportedProvidersQueryKeys = {
  all: ['supportedProviders'] as const,
  list: () => [...supportedProvidersQueryKeys.all, 'list'] as const,
};

/**
 * Returns an empty list; GetSupportedProviders RPC has been removed.
 */
export function useSupportedProviders(): UseQueryResult<SupportedProviderDescriptor[], Error> {
  return useQuery({
    queryKey: supportedProvidersQueryKeys.list(),
    queryFn: async (): Promise<SupportedProviderDescriptor[]> => [],
    staleTime: Infinity,
  });
}
