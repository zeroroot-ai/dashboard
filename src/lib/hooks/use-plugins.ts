'use client';

/**
 * Plugin Management Hooks
 * React Query hooks for plugin access operations.
 *
 * All data fetching goes through Next.js API routes (/api/plugins/*)
 * which in turn call the Gibson daemon via gibson-client.ts (server-side only).
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { queryKeys } from '@/src/lib/query/keys';

const STALE_TIME = 30000; // 30 seconds

// ============================================================================
// TypeScript interfaces (mirroring gibson-client exports for type safety)
// ============================================================================

export interface PluginCatalogEntry {
  name: string;
  version: string;
  description: string;
  methods: string[];
  configSchemaJson: string;
  enabled: boolean;
  configured: boolean;
  healthStatus: string;
  source: 'platform' | 'self-hosted';
  instanceCount: number;
  lastHeartbeat?: string;
}

export interface PluginAccess {
  tenantId: string;
  pluginName: string;
  enabled: boolean;
  /** Whether agents may call read-only methods on this plugin. Defaults true when enabled. */
  readEnabled: boolean;
  /** Whether agents may call mutating methods on this plugin. Defaults true when enabled. */
  writeEnabled: boolean;
  source: 'platform' | 'self-hosted';
  configuredAt: string;
  configuredBy: string;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  details?: string;
}

// ============================================================================
// Variable types for mutations
// ============================================================================

export interface EnablePluginVars {
  tenantId: string;
  pluginName: string;
  config: Record<string, string>;
}

export interface DisablePluginVars {
  tenantId: string;
  pluginName: string;
}

export interface UpdateConfigVars {
  tenantId: string;
  pluginName: string;
  config: Record<string, string>;
}

export interface TestConnectionVars {
  tenantId: string;
  pluginName: string;
  config: Record<string, string>;
}

export interface UpdateAccessVars {
  tenantId: string;
  pluginName: string;
  readEnabled: boolean;
  writeEnabled: boolean;
}

// ============================================================================
// API fetch helpers
// ============================================================================

async function fetchAvailablePlugins(tenantId: string): Promise<PluginCatalogEntry[]> {
  const res = await fetch(`/api/plugins?tenantId=${encodeURIComponent(tenantId)}&type=available`);
  if (!res.ok) throw new Error(`Failed to fetch plugins: ${res.statusText}`);
  const data = await res.json() as { plugins: PluginCatalogEntry[] };
  return data.plugins ?? [];
}

async function fetchTenantPlugins(tenantId: string): Promise<PluginAccess[]> {
  const res = await fetch(`/api/plugins?tenantId=${encodeURIComponent(tenantId)}&type=tenant`);
  if (!res.ok) throw new Error(`Failed to fetch tenant plugins: ${res.statusText}`);
  const data = await res.json() as { plugins: PluginAccess[] };
  return data.plugins ?? [];
}

async function postEnablePlugin(vars: EnablePluginVars): Promise<void> {
  const res = await fetch(`/api/plugins/${encodeURIComponent(vars.pluginName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: vars.tenantId, config: vars.config }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Failed to enable plugin: ${res.statusText}`);
  }
}

async function postDisablePlugin(vars: DisablePluginVars): Promise<void> {
  const res = await fetch(`/api/plugins/${encodeURIComponent(vars.pluginName)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: vars.tenantId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Failed to disable plugin: ${res.statusText}`);
  }
}

async function patchUpdatePluginConfig(vars: UpdateConfigVars): Promise<void> {
  const res = await fetch(`/api/plugins/${encodeURIComponent(vars.pluginName)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: vars.tenantId, config: vars.config }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Failed to update plugin config: ${res.statusText}`);
  }
}

async function postTestConnection(vars: TestConnectionVars): Promise<TestConnectionResult> {
  const res = await fetch(`/api/plugins/${encodeURIComponent(vars.pluginName)}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: vars.tenantId, config: vars.config }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Failed to test plugin: ${res.statusText}`);
  }
  return res.json() as Promise<TestConnectionResult>;
}

async function putUpdatePluginAccess(vars: UpdateAccessVars): Promise<void> {
  const res = await fetch('/api/plugins/access', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId: vars.tenantId,
      pluginName: vars.pluginName,
      readEnabled: vars.readEnabled,
      writeEnabled: vars.writeEnabled,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Failed to update plugin access: ${res.statusText}`);
  }
}

// ============================================================================
// Query Hooks
// ============================================================================

/**
 * Fetch all plugins available to a tenant (platform + self-hosted).
 * Health status and enabled state are included in each entry.
 */
export function useAvailablePlugins(tenantId: string): UseQueryResult<PluginCatalogEntry[], Error> {
  return useQuery({
    queryKey: queryKeys.plugins.available(tenantId),
    queryFn: () => fetchAvailablePlugins(tenantId),
    staleTime: STALE_TIME,
    enabled: !!tenantId,
  });
}

/**
 * Fetch the tenant's enabled plugin access records.
 */
export function useTenantPlugins(tenantId: string): UseQueryResult<PluginAccess[], Error> {
  return useQuery({
    queryKey: queryKeys.plugins.tenant(tenantId),
    queryFn: () => fetchTenantPlugins(tenantId),
    staleTime: STALE_TIME,
    enabled: !!tenantId,
  });
}

// ============================================================================
// Mutation Hooks
// ============================================================================

/**
 * Enable a platform plugin for the current tenant.
 * On success, both the available-plugin list and the tenant-plugin list are
 * invalidated so the catalog reflects the new state.
 */
export function useEnablePlugin(): UseMutationResult<void, Error, EnablePluginVars> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: postEnablePlugin,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.available(variables.tenantId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.tenant(variables.tenantId) });
    },
  });
}

/**
 * Disable an enabled plugin, removing stored credentials.
 * On success, both list queries are invalidated.
 */
export function useDisablePlugin(): UseMutationResult<void, Error, DisablePluginVars> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: postDisablePlugin,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.available(variables.tenantId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.tenant(variables.tenantId) });
    },
  });
}

/**
 * Update the configuration for an already-enabled plugin.
 * On success, the tenant list and the specific plugin config entry are invalidated.
 */
export function useUpdatePluginConfig(): UseMutationResult<void, Error, UpdateConfigVars> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: patchUpdatePluginConfig,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.tenant(variables.tenantId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.plugins.config(variables.tenantId, variables.pluginName),
      });
    },
  });
}

/**
 * Test a plugin's connection with the provided config without persisting.
 * Does not invalidate any queries — the result is ephemeral UI feedback.
 */
export function useTestConnection(): UseMutationResult<TestConnectionResult, Error, TestConnectionVars> {
  return useMutation({
    mutationFn: postTestConnection,
  });
}

/**
 * Update the read/write access flags for an already-enabled plugin.
 * Invalidates the tenant plugin list so the UI reflects the new state immediately.
 */
export function useUpdatePluginAccess(): UseMutationResult<void, Error, UpdateAccessVars> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: putUpdatePluginAccess,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.tenant(variables.tenantId) });
    },
  });
}
