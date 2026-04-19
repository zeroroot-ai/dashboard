'use client';

/**
 * Provider Mutation Hooks
 * React Query hooks for LLM provider mutations
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  createProvider,
  updateProvider,
  deleteProvider,
  setDefaultProvider,
  rotateApiKey,
  toggleProvider,
  importConfig,
} from '@/src/lib/api/providers';
import { providerQueryKeys } from './useProviders';
import type {
  ProviderConfig,
  CreateProviderResponse,
  UpdateProviderResponse,
  DeleteProviderResponse,
  SetDefaultProviderResponse,
  ImportResult,
  ImportMergeStrategy,
  ExportFormat,
  ListProvidersResponse,
} from '@/src/types/provider';
import type { DaemonProviderConfigInput } from '@/src/lib/gibson-client';

// ============================================================================
// Create Provider Mutation
// ============================================================================

interface CreateProviderContext {
  previousProviders?: ListProvidersResponse;
}

/**
 * Hook for creating a new provider.
 *
 * Accepts the generic daemon-driven payload shape ({type, name, defaultModel,
 * credentials: Record<string, string>, setAsDefault?}) introduced by spec 25.
 * The `config` field is forwarded to POST /api/settings/providers which
 * delegates to the daemon's CreateProvider RPC.
 *
 * @returns Mutation result for provider creation
 */
export function useCreateProvider(): UseMutationResult<
  CreateProviderResponse,
  Error,
  { config: DaemonProviderConfigInput; testConnection?: boolean },
  CreateProviderContext
> {
  const queryClient = useQueryClient();

  return useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: ({ config, testConnection }) => createProvider(config as any, { testConnection }),
    onMutate: async ({ config }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: providerQueryKeys.lists() });

      // Snapshot previous value
      const previousProviders = queryClient.getQueryData<ListProvidersResponse>(
        providerQueryKeys.list()
      );

      // Optimistically add new provider (with temp data)
      if (previousProviders) {
        const now = new Date().toISOString();
        const optimisticProvider: ProviderConfig = {
          name: config.name ?? 'new-provider',
          displayName: config.name ?? 'New Provider',
          type: config.type,
          apiKeyMasked: config.credentials && Object.keys(config.credentials).length > 0 ? '****' : undefined,
          defaultModel: config.defaultModel,
          isDefault: config.setAsDefault ?? false,
          isEnabled: true,
          version: 1,
          createdAt: now,
          updatedAt: now,
          createdBy: 'current-user',
          updatedBy: 'current-user',
        };

        queryClient.setQueryData<ListProvidersResponse>(providerQueryKeys.list(), {
          ...previousProviders,
          providers: [...previousProviders.providers, optimisticProvider],
        });
      }

      return { previousProviders };
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context?.previousProviders) {
        queryClient.setQueryData(providerQueryKeys.list(), context.previousProviders);
      }
    },
    onSuccess: (data) => {
      // Add the real provider to cache
      queryClient.setQueryData(providerQueryKeys.detail(data.provider.name), data.provider);
    },
    onSettled: () => {
      // Refetch to get accurate data
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.health() });
    },
  });
}

// ============================================================================
// Update Provider Mutation
// ============================================================================

interface UpdateProviderVariables {
  name: string;
  config: Partial<DaemonProviderConfigInput>;
  expectedVersion?: number;
}

interface UpdateProviderContext {
  previousProvider?: ProviderConfig;
  previousProviders?: ListProvidersResponse;
}

/**
 * Hook for updating an existing provider
 *
 * @returns Mutation result for provider update
 */
export function useUpdateProvider(): UseMutationResult<
  UpdateProviderResponse,
  Error,
  UpdateProviderVariables,
  UpdateProviderContext
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, config, expectedVersion }) =>
      updateProvider(name, config, { expectedVersion }),
    onMutate: async ({ name, config }) => {
      await queryClient.cancelQueries({ queryKey: providerQueryKeys.detail(name) });
      await queryClient.cancelQueries({ queryKey: providerQueryKeys.lists() });

      const previousProvider = queryClient.getQueryData<ProviderConfig>(
        providerQueryKeys.detail(name)
      );

      const previousProviders = queryClient.getQueryData<ListProvidersResponse>(
        providerQueryKeys.list()
      );

      // Optimistically update the detail
      if (previousProvider) {
        queryClient.setQueryData<ProviderConfig>(providerQueryKeys.detail(name), {
          ...previousProvider,
          defaultModel: config.defaultModel ?? previousProvider.defaultModel,
          updatedAt: new Date().toISOString(),
        });
      }

      // Optimistically update the list
      if (previousProviders) {
        queryClient.setQueryData<ListProvidersResponse>(providerQueryKeys.list(), {
          ...previousProviders,
          providers: previousProviders.providers.map((p) =>
            p.name === name
              ? {
                  ...p,
                  defaultModel: config.defaultModel ?? p.defaultModel,
                  updatedAt: new Date().toISOString(),
                }
              : p
          ),
        });
      }

      return { previousProvider, previousProviders };
    },
    onError: (_err, variables, context) => {
      if (context?.previousProvider) {
        queryClient.setQueryData(
          providerQueryKeys.detail(variables.name),
          context.previousProvider
        );
      }
      if (context?.previousProviders) {
        queryClient.setQueryData(providerQueryKeys.list(), context.previousProviders);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.detail(variables.name) });
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.lists() });
    },
  });
}

// ============================================================================
// Delete Provider Mutation
// ============================================================================

interface DeleteProviderContext {
  previousProviders?: ListProvidersResponse;
}

/**
 * Hook for deleting a provider
 *
 * @returns Mutation result for provider deletion
 */
export function useDeleteProvider(): UseMutationResult<
  DeleteProviderResponse,
  Error,
  string,
  DeleteProviderContext
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => deleteProvider(name),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: providerQueryKeys.lists() });

      const previousProviders = queryClient.getQueryData<ListProvidersResponse>(
        providerQueryKeys.list()
      );

      // Optimistically remove
      if (previousProviders) {
        queryClient.setQueryData<ListProvidersResponse>(providerQueryKeys.list(), {
          ...previousProviders,
          providers: previousProviders.providers.filter((p) => p.name !== name),
          fallbackChain: previousProviders.fallbackChain?.filter((n) => n !== name),
        });
      }

      return { previousProviders };
    },
    onError: (_err, _name, context) => {
      if (context?.previousProviders) {
        queryClient.setQueryData(providerQueryKeys.list(), context.previousProviders);
      }
    },
    onSettled: (_data, _error, name) => {
      // Remove from detail cache
      queryClient.removeQueries({ queryKey: providerQueryKeys.detail(name) });
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.fallback() });
    },
  });
}

// ============================================================================
// Set Default Provider Mutation
// ============================================================================

interface SetDefaultProviderContext {
  previousProviders?: ListProvidersResponse;
}

/**
 * Hook for setting the default provider
 *
 * @returns Mutation result for setting default provider
 */
export function useSetDefaultProvider(): UseMutationResult<
  SetDefaultProviderResponse,
  Error,
  string,
  SetDefaultProviderContext
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setDefaultProvider,
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: providerQueryKeys.lists() });

      const previousProviders = queryClient.getQueryData<ListProvidersResponse>(
        providerQueryKeys.list()
      );

      // Optimistically update default
      if (previousProviders) {
        queryClient.setQueryData<ListProvidersResponse>(providerQueryKeys.list(), {
          ...previousProviders,
          defaultProvider: name,
          providers: previousProviders.providers.map((p) => ({
            ...p,
            isDefault: p.name === name,
          })),
        });
      }

      return { previousProviders };
    },
    onError: (_err, _name, context) => {
      if (context?.previousProviders) {
        queryClient.setQueryData(providerQueryKeys.list(), context.previousProviders);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.lists() });
    },
  });
}

// ============================================================================
// Rotate API Key Mutation
// ============================================================================

interface RotateApiKeyVariables {
  name: string;
  newApiKey: string;
}

/**
 * Hook for rotating a provider's API key
 *
 * @returns Mutation result for API key rotation
 */
export function useRotateApiKey(): UseMutationResult<
  UpdateProviderResponse,
  Error,
  RotateApiKeyVariables,
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, newApiKey }) => rotateApiKey(name, newApiKey),
    onSuccess: (data) => {
      queryClient.setQueryData(providerQueryKeys.detail(data.provider.name), data.provider);
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.detail(variables.name) });
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.audit() });
    },
  });
}

// ============================================================================
// Toggle Provider Mutation
// ============================================================================

interface ToggleProviderVariables {
  name: string;
  isEnabled: boolean;
}

interface ToggleProviderContext {
  previousProvider?: ProviderConfig;
}

/**
 * Hook for enabling/disabling a provider
 *
 * @returns Mutation result for toggling provider
 */
export function useToggleProvider(): UseMutationResult<
  UpdateProviderResponse,
  Error,
  ToggleProviderVariables,
  ToggleProviderContext
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, isEnabled }) => toggleProvider(name, isEnabled),
    onMutate: async ({ name, isEnabled }) => {
      await queryClient.cancelQueries({ queryKey: providerQueryKeys.detail(name) });

      const previousProvider = queryClient.getQueryData<ProviderConfig>(
        providerQueryKeys.detail(name)
      );

      if (previousProvider) {
        queryClient.setQueryData<ProviderConfig>(providerQueryKeys.detail(name), {
          ...previousProvider,
          isEnabled,
        });
      }

      return { previousProvider };
    },
    onError: (_err, variables, context) => {
      if (context?.previousProvider) {
        queryClient.setQueryData(
          providerQueryKeys.detail(variables.name),
          context.previousProvider
        );
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.detail(variables.name) });
      queryClient.invalidateQueries({ queryKey: providerQueryKeys.lists() });
    },
  });
}

// ============================================================================
// Import Configuration Mutation
// ============================================================================

interface ImportConfigVariables {
  content: string;
  format: ExportFormat;
  mergeStrategy: ImportMergeStrategy;
  dryRun?: boolean;
}

/**
 * Hook for importing provider configurations
 *
 * @returns Mutation result for importing configuration
 */
export function useImportConfig(): UseMutationResult<
  ImportResult,
  Error,
  ImportConfigVariables,
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ content, format, mergeStrategy, dryRun }) =>
      importConfig(content, { format, mergeStrategy, dryRun }),
    onSuccess: (_data, variables) => {
      // Only invalidate if not a dry run
      if (!variables.dryRun) {
        queryClient.invalidateQueries({ queryKey: providerQueryKeys.all });
      }
    },
  });
}
