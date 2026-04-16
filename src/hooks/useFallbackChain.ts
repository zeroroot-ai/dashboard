'use client';

/**
 * Fallback Chain Hooks
 * React Query hooks for managing LLM provider fallback chain
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { setFallbackChain } from '@/src/lib/api/providers';
import { providerQueryKeys, useFallbackChain as useFallbackChainQuery } from './useProviders';
import type {
  SetFallbackChainResponse,
  ListProvidersResponse,
} from '@/src/types/provider';

// ============================================================================
// Set Fallback Chain Mutation
// ============================================================================

interface SetFallbackChainContext {
  previousProviders?: ListProvidersResponse;
  previousFallback?: string[];
}

/**
 * Hook for updating the fallback chain
 *
 * @returns Mutation result for setting fallback chain
 *
 * @example
 * ```tsx
 * const { mutate: updateFallback, isPending } = useSetFallbackChain();
 *
 * const handleSave = () => {
 *   updateFallback(['openai-backup', 'anthropic-secondary'], {
 *     onSuccess: () => {
 *       toast.success('Fallback chain updated');
 *     },
 *   });
 * };
 * ```
 */
export function useSetFallbackChain(): UseMutationResult<
  SetFallbackChainResponse,
  Error,
  string[],
  SetFallbackChainContext
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setFallbackChain,
    onMutate: async (newChain) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: providerQueryKeys.fallback() });
      await queryClient.cancelQueries({ queryKey: providerQueryKeys.lists() });

      // Snapshot previous values
      const previousFallback = queryClient.getQueryData<string[]>(
        providerQueryKeys.fallback()
      );

      const previousProviders = queryClient.getQueryData<ListProvidersResponse>(
        providerQueryKeys.list()
      );

      // Optimistically update fallback chain
      queryClient.setQueryData<string[]>(providerQueryKeys.fallback(), newChain);

      // Update providers list with new fallback chain
      if (previousProviders) {
        queryClient.setQueryData<ListProvidersResponse>(providerQueryKeys.list(), {
          ...previousProviders,
          fallbackChain: newChain,
        });
      }

      return { previousProviders, previousFallback };
    },
    onError: (_err, _newChain, context) => {
      // Rollback on error
      if (context?.previousFallback !== undefined) {
        queryClient.setQueryData(providerQueryKeys.fallback(), context.previousFallback);
      }
      if (context?.previousProviders) {
        queryClient.setQueryData(providerQueryKeys.list(), context.previousProviders);
      }
    },
    onSettled: () => {
      // Refetch to get accurate data
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.fallback() });
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.lists() });
    },
  });
}

// ============================================================================
// Fallback Chain Reorder Helpers
// ============================================================================

interface UseFallbackChainManagerResult {
  /**
   * Current fallback chain
   */
  chain: string[];
  /**
   * Whether the chain is loading
   */
  isLoading: boolean;
  /**
   * Whether an update is in progress
   */
  isUpdating: boolean;
  /**
   * Move a provider up in the chain
   */
  moveUp: (providerName: string) => void;
  /**
   * Move a provider down in the chain
   */
  moveDown: (providerName: string) => void;
  /**
   * Add a provider to the chain
   */
  add: (providerName: string) => void;
  /**
   * Remove a provider from the chain
   */
  remove: (providerName: string) => void;
  /**
   * Reorder the entire chain
   */
  reorder: (newOrder: string[]) => void;
}

/**
 * Hook for managing fallback chain with reordering helpers
 *
 * Provides a higher-level interface for manipulating the fallback chain
 * with built-in optimistic updates and error handling.
 *
 * @returns Fallback chain management utilities
 *
 * @example
 * ```tsx
 * const { chain, moveUp, moveDown, remove, isUpdating } = useFallbackChainManager();
 *
 * return (
 *   <SortableList
 *     items={chain}
 *     onReorder={reorder}
 *     renderItem={(name, index) => (
 *       <ProviderItem
 *         name={name}
 *         onMoveUp={() => moveUp(name)}
 *         onMoveDown={() => moveDown(name)}
 *         onRemove={() => remove(name)}
 *         canMoveUp={index > 0}
 *         canMoveDown={index < chain.length - 1}
 *       />
 *     )}
 *   />
 * );
 * ```
 */
export function useFallbackChainManager(): UseFallbackChainManagerResult {
  const { data: chain = [], isLoading } = useFallbackChainQuery();
  const { mutate: setChain, isPending: isUpdating } = useSetFallbackChain();

  const moveUp = (providerName: string) => {
    const index = chain.indexOf(providerName);
    if (index <= 0) return;

    const newChain = [...chain];
    [newChain[index - 1], newChain[index]] = [newChain[index], newChain[index - 1]];
    setChain(newChain);
  };

  const moveDown = (providerName: string) => {
    const index = chain.indexOf(providerName);
    if (index === -1 || index >= chain.length - 1) return;

    const newChain = [...chain];
    [newChain[index], newChain[index + 1]] = [newChain[index + 1], newChain[index]];
    setChain(newChain);
  };

  const add = (providerName: string) => {
    if (chain.includes(providerName)) return;
    setChain([...chain, providerName]);
  };

  const remove = (providerName: string) => {
    setChain(chain.filter((name) => name !== providerName));
  };

  const reorder = (newOrder: string[]) => {
    setChain(newOrder);
  };

  return {
    chain,
    isLoading,
    isUpdating,
    moveUp,
    moveDown,
    add,
    remove,
    reorder,
  };
}
