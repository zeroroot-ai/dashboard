'use client';

/**
 * Connection Test Hook
 * React Query hook for testing LLM provider connections
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { testProviderConnection, testNewProviderConnection } from '@/src/lib/api/providers';
import { providerQueryKeys } from './useProviders';
import type { ConnectionTestResult } from '@/src/types/provider';
import type { DaemonProviderConfigInput } from '@/src/lib/gibson-client-types';

// ============================================================================
// Test Existing Provider Connection
// ============================================================================

interface TestConnectionOptions {
  /**
   * Timeout in seconds for the connection test
   * @default 10
   */
  timeoutSeconds?: number;
}

/**
 * Hook for testing connection to an existing provider
 *
 * Tests connectivity using the provider's stored configuration
 * and returns available models on success.
 *
 * @returns Mutation result for connection testing
 *
 * @example
 * ```tsx
 * const { mutate: testConnection, isPending, data } = useTestConnection();
 *
 * const handleTest = () => {
 *   testConnection('anthropic-primary', {
 *     onSuccess: (result) => {
 *       if (result.success) {
 *         console.log('Connected! Models:', result.availableModels);
 *       } else {
 *         console.error('Failed:', result.errorMessage);
 *       }
 *     },
 *   });
 * };
 * ```
 */
export function useTestConnection(
  options?: TestConnectionOptions
): UseMutationResult<ConnectionTestResult, Error, string, unknown> {
  const queryClient = useQueryClient();
  const timeoutSeconds = options?.timeoutSeconds ?? 10;

  return useMutation({
    mutationFn: (providerName: string) =>
      testProviderConnection(providerName, { timeoutSeconds }),
    onSuccess: (result, providerName) => {
      // Update health status in cache if test was successful
      if (result.success) {
        // Invalidate health queries to reflect new status
        queryClient.invalidateQueries({
          queryKey: providerQueryKeys.healthForProvider(providerName),
        });
      }
    },
    onSettled: () => {
      // Always refresh health data after a test
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.health() });
    },
  });
}

// ============================================================================
// Test New Provider Connection
// ============================================================================

/**
 * Hook for testing connection to a new provider (before saving)
 *
 * Tests connectivity using provided configuration without
 * requiring the provider to be saved first. Useful for
 * validating credentials during provider creation.
 *
 * @returns Mutation result for connection testing
 *
 * @example
 * ```tsx
 * const { mutate: testNew, isPending } = useTestNewConnection();
 *
 * const handleValidate = () => {
 *   testNew({
 *     type: 'anthropic',
 *     apiKey: 'sk-ant-...',
 *     baseUrl: 'https://api.anthropic.com',
 *   }, {
 *     onSuccess: (result) => {
 *       if (result.success) {
 *         // Credentials are valid, proceed with save
 *       }
 *     },
 *   });
 * };
 * ```
 */
export function useTestNewConnection(
  options?: TestConnectionOptions
): UseMutationResult<ConnectionTestResult, Error, DaemonProviderConfigInput, unknown> {
  const timeoutSeconds = options?.timeoutSeconds ?? 10;

  return useMutation({
    mutationFn: (config: DaemonProviderConfigInput) =>
      testNewProviderConnection(config, { timeoutSeconds }),
  });
}

// ============================================================================
// Connection Test State Hook
// ============================================================================

interface ConnectionTestState {
  /**
   * Test connection to an existing provider
   */
  testExisting: UseMutationResult<ConnectionTestResult, Error, string, unknown>;
  /**
   * Test connection with new provider config
   */
  testNew: UseMutationResult<ConnectionTestResult, Error, DaemonProviderConfigInput, unknown>;
  /**
   * Whether either test is currently running
   */
  isAnyTesting: boolean;
}

/**
 * Combined hook for both existing and new provider connection tests
 *
 * Provides a unified interface for testing connections in forms
 * where you may need to test both new and existing providers.
 *
 * @returns Combined mutation states for connection testing
 *
 * @example
 * ```tsx
 * const { testExisting, testNew, isAnyTesting } = useConnectionTests();
 *
 * const handleTest = () => {
 *   if (isEditing) {
 *     testExisting.mutate(providerName);
 *   } else {
 *     testNew.mutate(formData);
 *   }
 * };
 * ```
 */
export function useConnectionTests(
  options?: TestConnectionOptions
): ConnectionTestState {
  const testExisting = useTestConnection(options);
  const testNew = useTestNewConnection(options);

  return {
    testExisting,
    testNew,
    isAnyTesting: testExisting.isPending || testNew.isPending,
  };
}
