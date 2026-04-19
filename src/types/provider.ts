/**
 * LLM Provider Type Definitions
 * Type definitions for BYOK (Bring Your Own Key) LLM provider configuration
 *
 * NOTE (spec 25-daemon-driven-provider-config): The hard-coded ProviderType
 * union, PROVIDER_TYPES, PROVIDER_TYPE_CONFIG, PROVIDER_MODELS, and the
 * per-provider typed config interfaces (AnthropicConfig, OpenAIConfig, etc.)
 * have been removed. The daemon is now the sole source of truth for which
 * provider types exist and what credential fields they require. Consumers
 * that need the supported-provider list should use useSupportedProviders()
 * or getSupportedProviders() from gibson-client.ts. The provider type
 * identifier is now just `string`.
 */

// ============================================================================
// Health Status Types
// ============================================================================

/**
 * Provider health status type.
 * Matches HealthStatusType enum from llm_provider.proto
 */
export type ProviderHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'unknown';

/**
 * Health status display configuration.
 */
export const HEALTH_STATUS_CONFIG: Record<ProviderHealthStatus, {
  label: string;
  description: string;
  color: string;
  icon: string;
}> = {
  healthy: {
    label: 'Healthy',
    description: 'Provider is responding normally',
    color: 'green',
    icon: 'CheckCircle',
  },
  degraded: {
    label: 'Degraded',
    description: 'Provider is experiencing issues',
    color: 'yellow',
    icon: 'AlertTriangle',
  },
  unhealthy: {
    label: 'Unhealthy',
    description: 'Provider is not responding',
    color: 'red',
    icon: 'XCircle',
  },
  unknown: {
    label: 'Unknown',
    description: 'Health status not available',
    color: 'gray',
    icon: 'HelpCircle',
  },
};

// ============================================================================
// Provider-Specific Configuration Types
// ============================================================================
// Note: AzureConfig, AWSConfig (BedrockConfig), OllamaConfig, OpenAIConfig
// removed in spec 25-daemon-driven-provider-config. Use the descriptor
// returned by useSupportedProviders() / getSupportedProviders() from
// gibson-client.ts instead.

/**
 * Rate limiting configuration for a provider.
 */
export interface RateLimitConfig {
  /** Maximum requests per minute (0 = unlimited) */
  requestsPerMinute?: number;
  /** Maximum tokens per minute (0 = unlimited) */
  tokensPerMinute?: number;
}

// ============================================================================
// Health Status Types
// ============================================================================

/**
 * Health status information for a provider.
 */
export interface HealthStatus {
  /** Current health state */
  status: ProviderHealthStatus;
  /** When health was last checked */
  lastCheckAt?: string;
  /** When last successful health check occurred */
  lastSuccessAt?: string;
  /** Most recent error message */
  lastError?: string;
  /** When the last error occurred */
  lastErrorAt?: string;
  /** Average response latency in milliseconds */
  latencyMs?: number;
  /** Count of consecutive failed checks */
  consecutiveFailures?: number;
  /** Models confirmed available from the provider */
  availableModels?: string[];
}

// ============================================================================
// Core Provider Types
// ============================================================================

/**
 * Complete LLM provider configuration.
 * Represents a configured provider instance returned by the dashboard API.
 *
 * Note: `type` is now `string` (daemon-assigned identifier); no longer
 * constrained to the old ProviderType union.
 */
export interface ProviderConfig {
  /** Unique identifier for this provider */
  name: string;
  /** Human-readable name shown in the UI */
  displayName: string;
  /** Provider vendor type string (e.g. "anthropic", "bedrock") */
  type: string;
  /** Masked API key (e.g., "sk-****abc") - never the full key */
  apiKeyMasked?: string;
  /** API endpoint URL (optional, uses provider defaults if empty) */
  baseUrl?: string;
  /** Default model to use when not specified */
  defaultModel?: string;
  /** Whether this is the default provider */
  isDefault: boolean;
  /** Whether this provider is currently active */
  isEnabled: boolean;
  /** Current health status */
  health?: HealthStatus;
  /** Rate limiting configuration */
  rateLimit?: RateLimitConfig;
  /** Request timeout in seconds */
  timeoutSeconds?: number;
  /** Number of retry attempts on failure */
  maxRetries?: number;
  /** Position in the fallback chain (0 = not in chain) */
  fallbackPosition?: number;
  /** Additional provider metadata */
  metadata?: Record<string, string>;
  /** Version for optimistic locking */
  version: number;
  /** When this configuration was created */
  createdAt: string;
  /** When this configuration was last updated */
  updatedAt: string;
  /** User who created this configuration */
  createdBy?: string;
  /** User who last updated this configuration */
  updatedBy?: string;
}

// ProviderConfigInput removed in spec 25-daemon-driven-provider-config.
// Use DaemonProviderConfigInput from @/src/lib/gibson-client for writes.

// ============================================================================
// Connection Test Types
// ============================================================================

/**
 * Information about an available model from a provider.
 */
export interface ModelInfo {
  /** Model identifier */
  id: string;
  /** Human-readable model name */
  name: string;
  /** Maximum context length in tokens */
  contextWindow?: number;
  /** Maximum output length */
  maxOutputTokens?: number;
  /** Whether the model supports image inputs */
  supportsVision?: boolean;
  /** Whether the model supports tool/function calling */
  supportsTools?: boolean;
  /** Additional model information */
  description?: string;
}

/**
 * Result of a connection test to a provider.
 */
export interface ConnectionTestResult {
  /** Whether the connection test passed */
  success: boolean;
  /** Response latency in milliseconds */
  latencyMs?: number;
  /** Models available from the provider */
  availableModels?: ModelInfo[];
  /** Error message if the test failed */
  error?: string;
  /** Machine-readable error code */
  errorCode?: string;
  /** When the test was performed */
  testedAt: string;
}

// ============================================================================
// Audit Event Types
// ============================================================================

/**
 * Type of provider configuration audit event.
 */
export type ProviderAuditEventType =
  | 'provider_created'
  | 'provider_updated'
  | 'provider_deleted'
  | 'api_key_rotated'
  | 'default_changed'
  | 'fallback_chain_updated'
  | 'config_imported'
  | 'config_exported'
  | 'connection_tested';

/**
 * Audit event type display configuration.
 */
export const PROVIDER_AUDIT_EVENT_CONFIG: Record<ProviderAuditEventType, {
  label: string;
  description: string;
  icon: string;
  severity: 'info' | 'warning' | 'critical';
}> = {
  provider_created: {
    label: 'Provider Created',
    description: 'A new LLM provider was configured',
    icon: 'Plus',
    severity: 'info',
  },
  provider_updated: {
    label: 'Provider Updated',
    description: 'Provider configuration was modified',
    icon: 'Edit',
    severity: 'info',
  },
  provider_deleted: {
    label: 'Provider Deleted',
    description: 'A provider was removed',
    icon: 'Trash',
    severity: 'warning',
  },
  api_key_rotated: {
    label: 'API Key Rotated',
    description: 'Provider API key was changed',
    icon: 'Key',
    severity: 'warning',
  },
  default_changed: {
    label: 'Default Changed',
    description: 'Default provider was changed',
    icon: 'Star',
    severity: 'info',
  },
  fallback_chain_updated: {
    label: 'Fallback Updated',
    description: 'Fallback chain order was modified',
    icon: 'ArrowsSort',
    severity: 'info',
  },
  config_imported: {
    label: 'Config Imported',
    description: 'Provider configurations were imported',
    icon: 'Download',
    severity: 'info',
  },
  config_exported: {
    label: 'Config Exported',
    description: 'Provider configurations were exported',
    icon: 'Upload',
    severity: 'info',
  },
  connection_tested: {
    label: 'Connection Tested',
    description: 'Provider connectivity was tested',
    icon: 'Wifi',
    severity: 'info',
  },
};

/**
 * Describes a single field change in an update.
 */
export interface FieldChange {
  /** Name of the changed field */
  field: string;
  /** Previous value (redacted for sensitive fields) */
  oldValue: string;
  /** New value (redacted for sensitive fields) */
  newValue: string;
}

/**
 * Audit event for provider configuration changes.
 */
export interface ProviderAuditEvent {
  /** Unique event identifier */
  id: string;
  /** Type of change */
  type: ProviderAuditEventType;
  /** Affected provider name */
  providerName?: string;
  /** User or system that made the change */
  actor: string;
  /** IP address of the actor */
  actorIp?: string;
  /** When the event occurred */
  timestamp: string;
  /** Additional event-specific information */
  details?: Record<string, string>;
  /** Field changes (for update events) */
  changes?: FieldChange[];
}

// ============================================================================
// Import/Export Types
// ============================================================================

/**
 * Export format options.
 */
export type ExportFormat = 'json' | 'yaml';

/**
 * Import merge strategy options.
 */
export type ImportMergeStrategy = 'skip' | 'replace' | 'error';

/**
 * Error encountered during import.
 */
export interface ImportError {
  /** Affected provider name */
  providerName: string;
  /** Error message */
  error: string;
  /** Machine-readable error code */
  errorCode?: string;
}

/**
 * Result of an import operation.
 */
export interface ImportResult {
  /** Whether the import was successful */
  success: boolean;
  /** Number of providers created */
  createdCount: number;
  /** Number of providers updated */
  updatedCount: number;
  /** Number of providers skipped */
  skippedCount: number;
  /** Import errors encountered */
  errors?: ImportError[];
  /** Providers that need API keys to be entered */
  providersRequiringKeys?: string[];
}

/**
 * Result of an export operation.
 */
export interface ExportResult {
  /** Exported configuration content */
  content: string;
  /** Format of the exported content */
  format: ExportFormat;
  /** Number of exported providers */
  providerCount: number;
  /** When the export was generated */
  exportedAt: string;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Request to list providers.
 */
export interface ListProvidersRequest {
  /** Include disabled providers */
  includeDisabled?: boolean;
  /** Include health status for each provider */
  includeHealth?: boolean;
}

/**
 * Response containing provider list.
 */
export interface ListProvidersResponse {
  /** List of configured providers */
  providers: ProviderConfig[];
  /** Name of the default provider */
  defaultProvider?: string;
  /** Ordered list of fallback provider names */
  fallbackChain?: string[];
}

/**
 * Request to create a provider.
 */
export interface CreateProviderRequest {
  /** Provider configuration to create */
  config: Record<string, unknown>;
  /** Test connectivity before creating */
  testConnection?: boolean;
  /** Make this the default provider */
  setAsDefault?: boolean;
}

/**
 * Response from creating a provider.
 */
export interface CreateProviderResponse {
  /** Created provider configuration */
  provider: ProviderConfig;
  /** Connection test result (if test was requested) */
  testResult?: ConnectionTestResult;
}

/**
 * Request to update a provider.
 */
export interface UpdateProviderRequest {
  /** Provider name to update */
  name: string;
  /** Fields to update */
  config: Record<string, unknown>;
  /** Test connectivity before updating */
  testConnection?: boolean;
}

/**
 * Response from updating a provider.
 */
export interface UpdateProviderResponse {
  /** Updated provider configuration */
  provider: ProviderConfig;
  /** Connection test result (if test was requested) */
  testResult?: ConnectionTestResult;
}

/**
 * Request to delete a provider.
 */
export interface DeleteProviderRequest {
  /** Provider name to delete */
  name: string;
  /** Force deletion of default provider */
  force?: boolean;
}

/**
 * Response from deleting a provider.
 */
export interface DeleteProviderResponse {
  /** Whether deletion was successful */
  success: boolean;
  /** Additional context message */
  message?: string;
  /** New default provider (if original default was deleted) */
  newDefault?: string;
}

/**
 * Request to test provider connection.
 */
export interface TestConnectionRequest {
  /** Name of existing provider to test */
  name?: string;
  /** New configuration to test without saving */
  config?: Record<string, unknown>;
  /** Custom timeout in seconds */
  timeoutSeconds?: number;
}

/**
 * Request to set the default provider.
 */
export interface SetDefaultProviderRequest {
  /** Provider name to make default */
  name: string;
}

/**
 * Response from setting default provider.
 */
export interface SetDefaultProviderResponse {
  /** Whether the change was successful */
  success: boolean;
  /** Previous default provider */
  previousDefault?: string;
  /** New default provider */
  newDefault: string;
}

/**
 * Request to set fallback chain.
 */
export interface SetFallbackChainRequest {
  /** Ordered list of fallback provider names */
  providerNames: string[];
}

/**
 * Response from setting fallback chain.
 */
export interface SetFallbackChainResponse {
  /** Whether the update was successful */
  success: boolean;
  /** Configured fallback order */
  fallbackChain: string[];
}

/**
 * Request to get health status.
 */
export interface GetHealthStatusRequest {
  /** Filter to specific providers (empty = all) */
  providerNames?: string[];
  /** Force fresh health check */
  refresh?: boolean;
}

/**
 * Response containing health statuses.
 */
export interface GetHealthStatusResponse {
  /** Provider name to health status mapping */
  statuses: Record<string, HealthStatus>;
  /** When health data was last refreshed */
  lastRefreshAt?: string;
}

/**
 * Request to export configurations.
 */
export interface ExportConfigRequest {
  /** Export format */
  format: ExportFormat;
  /** Filter to specific providers (empty = all) */
  providerNames?: string[];
  /** Include metadata in export */
  includeMetadata?: boolean;
}

/**
 * Request to import configurations.
 */
export interface ImportConfigRequest {
  /** Configuration content to import */
  content: string;
  /** Format of the content */
  format: ExportFormat;
  /** How to handle existing providers */
  mergeStrategy: ImportMergeStrategy;
  /** Validate without actually importing */
  dryRun?: boolean;
}

/**
 * Query parameters for audit log.
 */
export interface GetAuditLogRequest {
  /** Filter to specific provider */
  providerName?: string;
  /** Filter to specific event types */
  eventTypes?: ProviderAuditEventType[];
  /** Filter events after this time */
  startTime?: string;
  /** Filter events before this time */
  endTime?: string;
  /** Maximum results (default 100, max 1000) */
  limit?: number;
  /** Pagination offset */
  offset?: number;
}

/**
 * Response containing audit events.
 */
export interface GetAuditLogResponse {
  /** List of audit events */
  events: ProviderAuditEvent[];
  /** Total count of matching events */
  total: number;
}

// PROVIDER_MODELS, ProviderFormData, ProviderFormErrors removed in
// spec 25-daemon-driven-provider-config. Models are now sourced from
// SupportedProviderDescriptor.defaultModels returned by the daemon's
// GetSupportedProviders RPC via useSupportedProviders().

