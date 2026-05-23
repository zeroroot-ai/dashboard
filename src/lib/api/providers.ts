/**
 * Provider API Client
 * Type-safe API client for LLM provider management operations
 */

import { apiFetch } from './fetch';
import type {
  ProviderConfig,
  ConnectionTestResult,
  ProviderAuditEvent,
  ProviderAuditEventType,
  ListProvidersResponse,
  CreateProviderResponse,
  UpdateProviderResponse,
  DeleteProviderResponse,
  SetDefaultProviderResponse,
  SetFallbackChainResponse,
  GetHealthStatusResponse,
  ExportFormat,
  ImportMergeStrategy,
  ImportResult,
  HealthStatus,
} from '@/src/types/provider';
import type {
  DaemonProviderConfigInput,
  SupportedProviderDescriptor,
} from '@/src/lib/gibson-client';

// ============================================================================
// Error Types
// ============================================================================

export class ProviderApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ProviderApiError';
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData: { message?: string; code?: string; details?: Record<string, unknown> } = {};

    try {
      errorData = await response.json();
    } catch {
      // Response might not be JSON
    }

    throw new ProviderApiError(
      errorData.message || `Request failed with status ${response.status}`,
      response.status,
      errorData.code,
      errorData.details
    );
  }

  return response.json();
}

function buildQueryString(params: Record<string, string | number | boolean | string[] | undefined>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      // Join arrays as comma-separated values
      if (value.length > 0) {
        searchParams.set(key, value.join(','));
      }
    } else {
      searchParams.set(key, String(value));
    }
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

// ============================================================================
// Supported Providers (descriptor list)
// ============================================================================

/**
 * Fetch the daemon-reported list of supported LLM provider types with their
 * credential schemas and default model catalogues. Used by the settings form
 * to render provider-specific inputs without a hard-coded frontend list.
 */
export async function getSupportedProviders(): Promise<SupportedProviderDescriptor[]> {
  const response = await apiFetch('/api/settings/providers/supported');
  const data = await handleResponse<{ providers: SupportedProviderDescriptor[] }>(response);
  return data.providers;
}

// ============================================================================
// Provider CRUD Operations
// ============================================================================

/**
 * List all configured LLM providers
 */
export async function listProviders(options?: {
  includeDisabled?: boolean;
  includeHealth?: boolean;
}): Promise<ListProvidersResponse> {
  const query = buildQueryString({
    includeDisabled: options?.includeDisabled,
    includeHealth: options?.includeHealth,
  });

  const response = await apiFetch(`/api/settings/providers${query}`);
  return handleResponse<ListProvidersResponse>(response);
}

/**
 * Get a single provider by name
 */
export async function getProvider(
  name: string,
  options?: { includeHealth?: boolean }
): Promise<ProviderConfig> {
  const query = buildQueryString({
    includeHealth: options?.includeHealth,
  });

  const response = await apiFetch(`/api/settings/providers/${encodeURIComponent(name)}${query}`);
  return handleResponse<ProviderConfig>(response);
}

/**
 * Create a new LLM provider configuration
 */
export async function createProvider(
  config: DaemonProviderConfigInput,
  options?: {
    testConnection?: boolean;
    setAsDefault?: boolean;
  }
): Promise<CreateProviderResponse> {
  const response = await apiFetch('/api/settings/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config,
      testConnection: options?.testConnection,
      setAsDefault: options?.setAsDefault,
    }),
  });

  return handleResponse<CreateProviderResponse>(response);
}

/**
 * Update an existing provider configuration
 */
export async function updateProvider(
  name: string,
  config: Partial<DaemonProviderConfigInput>,
  options?: { testConnection?: boolean; expectedVersion?: number }
): Promise<UpdateProviderResponse> {
  const response = await apiFetch(`/api/settings/providers/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: {
        ...config,
        version: options?.expectedVersion,
      },
      testConnection: options?.testConnection,
    }),
  });

  return handleResponse<UpdateProviderResponse>(response);
}

/**
 * Delete a provider configuration
 */
export async function deleteProvider(
  name: string,
  options?: { force?: boolean }
): Promise<DeleteProviderResponse> {
  const query = buildQueryString({
    force: options?.force,
  });

  const response = await apiFetch(`/api/settings/providers/${encodeURIComponent(name)}${query}`, {
    method: 'DELETE',
  });

  return handleResponse<DeleteProviderResponse>(response);
}

// ============================================================================
// Connection Testing
// ============================================================================

/**
 * Test connection to an existing provider
 */
export async function testProviderConnection(
  name: string,
  options?: { timeoutSeconds?: number }
): Promise<ConnectionTestResult> {
  const response = await apiFetch('/api/settings/providers/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      timeoutSeconds: options?.timeoutSeconds,
    }),
  });

  return handleResponse<ConnectionTestResult>(response);
}

/**
 * Test connection with a new configuration (without saving)
 */
export async function testConnectionConfig(
  config: DaemonProviderConfigInput,
  options?: { timeoutSeconds?: number }
): Promise<ConnectionTestResult> {
  const response = await apiFetch('/api/settings/providers/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config,
      timeoutSeconds: options?.timeoutSeconds,
    }),
  });

  return handleResponse<ConnectionTestResult>(response);
}

/**
 * Test connection with a new provider configuration (alias for testConnectionConfig)
 */
export async function testNewProviderConnection(
  config: DaemonProviderConfigInput,
  options?: { timeoutSeconds?: number }
): Promise<ConnectionTestResult> {
  return testConnectionConfig(config, options);
}

// ============================================================================
// Default & Fallback Configuration
// ============================================================================

/**
 * Set a provider as the default
 */
export async function setDefaultProvider(name: string): Promise<SetDefaultProviderResponse> {
  const response = await apiFetch('/api/settings/providers/default', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });

  return handleResponse<SetDefaultProviderResponse>(response);
}

/**
 * Configure the fallback chain order
 */
export async function setFallbackChain(providerNames: string[]): Promise<SetFallbackChainResponse> {
  const response = await apiFetch('/api/settings/providers/fallback', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerNames }),
  });

  return handleResponse<SetFallbackChainResponse>(response);
}

/**
 * Get the current fallback chain
 */
export async function getFallbackChain(): Promise<string[]> {
  const response = await apiFetch('/api/settings/providers/fallback');
  const data = await handleResponse<{ fallbackChain: string[] }>(response);
  return data.fallbackChain;
}

// ============================================================================
// Health Status
// ============================================================================

/**
 * Get health status for all or specific providers
 */
export async function getHealthStatus(options?: {
  providerNames?: string[];
  refresh?: boolean;
}): Promise<GetHealthStatusResponse> {
  const query = buildQueryString({
    providers: options?.providerNames,
    refresh: options?.refresh,
  });

  const response = await apiFetch(`/api/settings/providers/health${query}`);
  return handleResponse<GetHealthStatusResponse>(response);
}

/**
 * Refresh health status for a specific provider
 */
export async function refreshProviderHealth(name: string): Promise<HealthStatus> {
  const response = await apiFetch(`/api/settings/providers/${encodeURIComponent(name)}/health`, {
    method: 'POST',
  });

  return handleResponse<HealthStatus>(response);
}

// ============================================================================
// Provider Management Operations
// ============================================================================

/**
 * Rotate API key for a provider
 */
export async function rotateApiKey(
  name: string,
  newApiKey: string
): Promise<UpdateProviderResponse> {
  const response = await apiFetch(`/api/settings/providers/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: { apiKey: newApiKey },
      rotateKey: true,
    }),
  });

  return handleResponse<UpdateProviderResponse>(response);
}

/**
 * Enable or disable a provider
 */
export async function toggleProvider(
  name: string,
  isEnabled: boolean
): Promise<UpdateProviderResponse> {
  const response = await apiFetch(`/api/settings/providers/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: { isEnabled },
    }),
  });

  return handleResponse<UpdateProviderResponse>(response);
}

// ============================================================================
// Import/Export
// ============================================================================

/**
 * Export provider configurations
 */
export async function exportConfig(options?: {
  format?: ExportFormat;
  providerNames?: string[];
  includeMetadata?: boolean;
}): Promise<Blob> {
  const query = buildQueryString({
    format: options?.format || 'json',
    providers: options?.providerNames,
    includeMetadata: options?.includeMetadata,
  });

  const response = await apiFetch(`/api/settings/providers/export${query}`);

  if (!response.ok) {
    let errorData: { message?: string; code?: string } = {};
    try {
      errorData = await response.json();
    } catch {
      // Response might not be JSON
    }
    throw new ProviderApiError(
      errorData.message || 'Failed to export configuration',
      response.status,
      errorData.code
    );
  }

  return response.blob();
}

/**
 * Download exported configuration as a file
 */
export async function downloadExportedConfig(options?: {
  format?: ExportFormat;
  providerNames?: string[];
  includeMetadata?: boolean;
  filename?: string;
}): Promise<void> {
  const blob = await exportConfig(options);
  const format = options?.format || 'json';
  const filename = options?.filename || `providers-config.${format}`;

  // Create download link
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Import provider configurations
 */
export async function importConfig(
  content: string,
  options: {
    format: ExportFormat;
    mergeStrategy: ImportMergeStrategy;
    dryRun?: boolean;
  }
): Promise<ImportResult> {
  const response = await apiFetch('/api/settings/providers/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      format: options.format,
      mergeStrategy: options.mergeStrategy,
      dryRun: options.dryRun,
    }),
  });

  return handleResponse<ImportResult>(response);
}

/**
 * Import provider configurations from a file
 */
export async function importConfigFromFile(
  file: File,
  options: {
    mergeStrategy: ImportMergeStrategy;
    dryRun?: boolean;
  }
): Promise<ImportResult> {
  const content = await file.text();

  // Detect format from file extension
  const format: ExportFormat = file.name.endsWith('.yaml') || file.name.endsWith('.yml')
    ? 'yaml'
    : 'json';

  return importConfig(content, {
    format,
    mergeStrategy: options.mergeStrategy,
    dryRun: options.dryRun,
  });
}

// ============================================================================
// Audit Log
// ============================================================================

/**
 * Get audit log for provider configuration changes
 */
export async function getAuditLog(options?: {
  providerName?: string;
  eventTypes?: ProviderAuditEventType[];
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
}): Promise<{ events: ProviderAuditEvent[]; total: number }> {
  const query = buildQueryString({
    provider: options?.providerName,
    eventTypes: options?.eventTypes,
    startTime: options?.startTime?.toISOString(),
    endTime: options?.endTime?.toISOString(),
    limit: options?.limit,
    offset: options?.offset,
  });

  const response = await apiFetch(`/api/settings/providers/audit${query}`);
  return handleResponse<{ events: ProviderAuditEvent[]; total: number }>(response);
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if an error is a ProviderApiError
 */
export function isProviderApiError(error: unknown): error is ProviderApiError {
  return error instanceof ProviderApiError;
}

/**
 * Check if error is an unauthorized (401) error
 */
export function isUnauthorizedError(error: unknown): boolean {
  return isProviderApiError(error) && error.status === 401;
}

/**
 * Check if error is a forbidden (403) error
 */
export function isForbiddenError(error: unknown): boolean {
  return isProviderApiError(error) && error.status === 403;
}

/**
 * Check if error is a not found (404) error
 */
export function isNotFoundError(error: unknown): boolean {
  return isProviderApiError(error) && error.status === 404;
}

/**
 * Check if error is a conflict (409) error (e.g., duplicate name, version conflict)
 */
export function isConflictError(error: unknown): boolean {
  return isProviderApiError(error) && error.status === 409;
}

/**
 * Check if error is a validation (400) error
 */
export function isValidationError(error: unknown): boolean {
  return isProviderApiError(error) && error.status === 400;
}

/**
 * Check if error is a precondition failed (412) error (optimistic locking failure)
 */
export function isPreconditionFailedError(error: unknown): boolean {
  return isProviderApiError(error) && error.status === 412;
}
