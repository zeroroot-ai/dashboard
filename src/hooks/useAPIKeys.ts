/**
 * useAPIKeys Hook
 *
 * TanStack Query hook for managing API keys.
 * Provides fetching, creating, and revoking API keys.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';

/**
 * API Key types (inline to avoid import issues).
 */
interface APIKey {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  token?: string;
  scopes: string[];
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  status: 'active' | 'revoked' | 'expired';
}

interface CreateAPIKeyRequest {
  name: string;
  scopes?: string[];
  expiresInDays?: number | null;
}

/**
 * Query keys for API keys.
 */
export const apiKeyKeys = {
  all: ['api-keys'] as const,
  list: () => [...apiKeyKeys.all, 'list'] as const,
};

/**
 * API client functions for API keys.
 */
async function fetchAPIKeys(): Promise<{ keys: Omit<APIKey, 'token' | 'keyHash'>[] }> {
  const response = await fetch('/api/users/api-keys');
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch API keys');
  }
  return response.json();
}

async function createAPIKey(
  data: CreateAPIKeyRequest
): Promise<{ key: APIKey; warning: string }> {
  const response = await fetch('/api/users/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to create API key');
  }
  return response.json();
}

async function revokeAPIKey(
  keyId: string
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`/api/users/api-keys?keyId=${keyId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to revoke API key');
  }
  return response.json();
}

/**
 * Hook for fetching API keys.
 */
export function useAPIKeys(enabled = true) {
  return useQuery({
    queryKey: apiKeyKeys.list(),
    queryFn: fetchAPIKeys,
    enabled,
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook for creating a new API key.
 * Returns the created key with the token (only visible once).
 */
export function useCreateAPIKey() {
  const queryClient = useQueryClient();
  const [newKeyToken, setNewKeyToken] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: createAPIKey,

    onSuccess: (result) => {
      // Store the token (only time it's visible)
      if (result.key.token) {
        setNewKeyToken(result.key.token);
      }

      // Invalidate the list to refetch
      queryClient.invalidateQueries({
        queryKey: apiKeyKeys.list(),
      });
    },
  });

  const clearNewKeyToken = useCallback(() => {
    setNewKeyToken(null);
  }, []);

  return {
    ...mutation,
    newKeyToken,
    clearNewKeyToken,
  };
}

/**
 * Hook for revoking an API key.
 */
export function useRevokeAPIKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: revokeAPIKey,

    onMutate: async (keyId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({
        queryKey: apiKeyKeys.list(),
      });

      // Snapshot the previous value
      const previousKeys = queryClient.getQueryData<{
        keys: Omit<APIKey, 'token' | 'keyHash'>[];
      }>(apiKeyKeys.list());

      // Optimistically update
      if (previousKeys) {
        queryClient.setQueryData(apiKeyKeys.list(), {
          keys: previousKeys.keys.map((key) =>
            key.id === keyId
              ? { ...key, status: 'revoked' as const }
              : key
          ),
        });
      }

      return { previousKeys };
    },

    onError: (_err, _keyId, context) => {
      // Rollback on error
      if (context?.previousKeys) {
        queryClient.setQueryData(apiKeyKeys.list(), context.previousKeys);
      }
    },

    onSettled: () => {
      // Refetch to ensure data is correct
      queryClient.invalidateQueries({
        queryKey: apiKeyKeys.list(),
      });
    },
  });
}

/**
 * Hook for invalidating API keys cache.
 */
export function useInvalidateAPIKeys() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({
      queryKey: apiKeyKeys.all,
    });
  };
}

/**
 * Available scopes for API keys.
 */
export const API_KEY_SCOPES = [
  { value: 'mission:read', label: 'Read Missions', description: 'View mission details and status' },
  { value: 'mission:execute', label: 'Execute Missions', description: 'Start and stop missions' },
  { value: 'mission:write', label: 'Write Missions', description: 'Create and update missions' },
  { value: 'mission:delete', label: 'Delete Missions', description: 'Delete missions' },
  { value: 'findings:read', label: 'Read Findings', description: 'View security findings' },
  { value: 'findings:export', label: 'Export Findings', description: 'Export findings to files' },
  { value: 'graph:read', label: 'Read Graph', description: 'View knowledge graph' },
  { value: 'graph:query', label: 'Query Graph', description: 'Execute graph queries' },
];

/**
 * Default scopes for new API keys.
 */
export const DEFAULT_API_KEY_SCOPES = ['mission:read', 'findings:read'];

/**
 * Expiration options for API keys.
 */
export const API_KEY_EXPIRATION_OPTIONS = [
  { value: null, label: 'Never expires' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 180, label: '180 days' },
  { value: 365, label: '1 year' },
];
