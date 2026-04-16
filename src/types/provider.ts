/**
 * LLM Provider Type Definitions
 * Type definitions for BYOK (Bring Your Own Key) LLM provider configuration
 */

// ============================================================================
// Provider Type Enums
// ============================================================================

/**
 * LLM provider vendor type.
 * Matches ProviderType enum from llm_provider.proto
 */
export type ProviderType =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'ollama'
  | 'azure_openai'
  | 'aws_bedrock';

/**
 * Provider type display configuration.
 */
export const PROVIDER_TYPE_CONFIG: Record<ProviderType, {
  label: string;
  description: string;
  icon: string;
  color: string;
  requiresApiKey: boolean;
  supportsBaseUrl: boolean;
}> = {
  anthropic: {
    label: 'Anthropic',
    description: 'Claude AI models',
    icon: 'Brain',
    color: '#D97706',
    requiresApiKey: true,
    supportsBaseUrl: false,
  },
  openai: {
    label: 'OpenAI',
    description: 'GPT models and DALL-E',
    icon: 'Sparkles',
    color: '#10A37F',
    requiresApiKey: true,
    supportsBaseUrl: true,
  },
  google: {
    label: 'Google AI',
    description: 'Gemini models',
    icon: 'Gem',
    color: '#4285F4',
    requiresApiKey: true,
    supportsBaseUrl: false,
  },
  ollama: {
    label: 'Ollama',
    description: 'Self-hosted local models',
    icon: 'Server',
    color: '#7C3AED',
    requiresApiKey: false,
    supportsBaseUrl: true,
  },
  azure_openai: {
    label: 'Azure OpenAI',
    description: 'Microsoft Azure-hosted OpenAI',
    icon: 'Cloud',
    color: '#0078D4',
    requiresApiKey: true,
    supportsBaseUrl: false,
  },
  aws_bedrock: {
    label: 'AWS Bedrock',
    description: 'Amazon Bedrock foundation models',
    icon: 'CloudCog',
    color: '#FF9900',
    requiresApiKey: false,
    supportsBaseUrl: false,
  },
};

/**
 * All provider types as array.
 */
export const PROVIDER_TYPES: ProviderType[] = [
  'anthropic',
  'openai',
  'google',
  'ollama',
  'azure_openai',
  'aws_bedrock',
];

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

/**
 * Azure OpenAI-specific configuration.
 */
export interface AzureConfig {
  /** Azure OpenAI resource name */
  resourceName: string;
  /** Azure deployment name */
  deploymentName: string;
  /** Azure API version (e.g., "2024-02-15-preview") */
  apiVersion: string;
}

/**
 * AWS Bedrock-specific configuration.
 */
export interface AWSConfig {
  /** AWS region (e.g., "us-east-1") */
  region: string;
  /** AWS access key ID (only in requests, masked in responses) */
  accessKeyId?: string;
  /** AWS secret access key (only in requests, never returned) */
  secretAccessKey?: string;
  /** Optional IAM role ARN to assume */
  roleArn?: string;
  /** Masked access key ID (returned in responses) */
  accessKeyIdMasked?: string;
}

/**
 * Ollama-specific configuration.
 */
export interface OllamaConfig {
  /** Custom model names available on this Ollama instance */
  customModels?: string[];
  /** Number of layers to offload to GPU (-1 = all) */
  gpuLayers?: number;
  /** Context window size */
  numCtx?: number;
}

/**
 * OpenAI-specific configuration.
 */
export interface OpenAIConfig {
  /** OpenAI organization ID */
  organizationId?: string;
  /** OpenAI project ID */
  projectId?: string;
}

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
 * Represents a configured provider instance.
 */
export interface ProviderConfig {
  /** Unique identifier for this provider */
  name: string;
  /** Human-readable name shown in the UI */
  displayName: string;
  /** Provider vendor type */
  type: ProviderType;
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
  /** Azure-specific settings */
  azureConfig?: AzureConfig;
  /** AWS Bedrock-specific settings */
  awsConfig?: AWSConfig;
  /** Ollama-specific settings */
  ollamaConfig?: OllamaConfig;
  /** OpenAI-specific settings */
  openaiConfig?: OpenAIConfig;
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

/**
 * Input for creating or updating a provider configuration.
 */
export interface ProviderConfigInput {
  /** Unique identifier (required for create, ignored for update) */
  name?: string;
  /** Human-readable name shown in the UI */
  displayName?: string;
  /** Provider vendor type (required) */
  type: ProviderType;
  /** Full API key (required for create, optional for update) */
  apiKey?: string;
  /** API endpoint URL */
  baseUrl?: string;
  /** Default model to use when not specified */
  defaultModel?: string;
  /** Whether this provider should be active */
  isEnabled?: boolean;
  /** Azure-specific settings */
  azureConfig?: AzureConfig;
  /** AWS Bedrock-specific settings */
  awsConfig?: AWSConfig;
  /** Ollama-specific settings */
  ollamaConfig?: OllamaConfig;
  /** OpenAI-specific settings */
  openaiConfig?: OpenAIConfig;
  /** Rate limiting configuration */
  rateLimit?: RateLimitConfig;
  /** Request timeout in seconds */
  timeoutSeconds?: number;
  /** Number of retry attempts on failure */
  maxRetries?: number;
  /** Additional provider metadata */
  metadata?: Record<string, string>;
  /** Version for optimistic locking (required for updates) */
  version?: number;
}

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
  config: ProviderConfigInput;
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
  config: ProviderConfigInput;
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
  config?: ProviderConfigInput;
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

// ============================================================================
// Model Constants
// ============================================================================

/**
 * Common models for each provider type.
 */
export const PROVIDER_MODELS: Record<ProviderType, ModelInfo[]> = {
  anthropic: [
    {
      id: 'claude-3-5-sonnet-20241022',
      name: 'Claude 3.5 Sonnet',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      description: 'Best balance of intelligence and speed',
    },
    {
      id: 'claude-3-opus-20240229',
      name: 'Claude 3 Opus',
      contextWindow: 200000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      description: 'Most capable model for complex tasks',
    },
    {
      id: 'claude-3-haiku-20240307',
      name: 'Claude 3 Haiku',
      contextWindow: 200000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      description: 'Fastest and most compact',
    },
  ],
  openai: [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      description: 'Most capable multimodal model',
    },
    {
      id: 'gpt-4-turbo',
      name: 'GPT-4 Turbo',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      description: 'Previous generation flagship',
    },
    {
      id: 'gpt-3.5-turbo',
      name: 'GPT-3.5 Turbo',
      contextWindow: 16385,
      maxOutputTokens: 4096,
      supportsVision: false,
      supportsTools: true,
      description: 'Fast and cost-effective',
    },
  ],
  google: [
    {
      id: 'gemini-1.5-pro',
      name: 'Gemini 1.5 Pro',
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      description: 'Million-token context window',
    },
    {
      id: 'gemini-1.5-flash',
      name: 'Gemini 1.5 Flash',
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      description: 'Fast multimodal model',
    },
  ],
  ollama: [
    {
      id: 'llama3.1:70b',
      name: 'Llama 3.1 70B',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsVision: false,
      supportsTools: true,
      description: 'Large open-source model',
    },
    {
      id: 'llama3.1:8b',
      name: 'Llama 3.1 8B',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsVision: false,
      supportsTools: true,
      description: 'Efficient open-source model',
    },
    {
      id: 'codellama:34b',
      name: 'Code Llama 34B',
      contextWindow: 16384,
      maxOutputTokens: 4096,
      supportsVision: false,
      supportsTools: false,
      description: 'Code-optimized model',
    },
  ],
  azure_openai: [
    {
      id: 'gpt-4o',
      name: 'GPT-4o (Azure)',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      description: 'Azure-hosted GPT-4o',
    },
    {
      id: 'gpt-4-turbo',
      name: 'GPT-4 Turbo (Azure)',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      description: 'Azure-hosted GPT-4 Turbo',
    },
  ],
  aws_bedrock: [
    {
      id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      name: 'Claude 3.5 Sonnet (Bedrock)',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      supportsVision: true,
      supportsTools: true,
      description: 'Anthropic Claude on Bedrock',
    },
    {
      id: 'amazon.titan-text-express-v1',
      name: 'Amazon Titan Text',
      contextWindow: 8192,
      maxOutputTokens: 8192,
      supportsVision: false,
      supportsTools: false,
      description: 'Amazon foundation model',
    },
  ],
};

// ============================================================================
// Form Types
// ============================================================================

/**
 * Form data for creating or editing a provider.
 */
export interface ProviderFormData {
  /** Provider name (slug) */
  name: string;
  /** Display name */
  displayName: string;
  /** Provider type */
  type: ProviderType;
  /** API key */
  apiKey?: string;
  /** Base URL override */
  baseUrl?: string;
  /** Default model */
  defaultModel?: string;
  /** Whether enabled */
  isEnabled: boolean;
  /** Azure config */
  azureConfig?: AzureConfig;
  /** AWS config */
  awsConfig?: Omit<AWSConfig, 'accessKeyIdMasked'>;
  /** Ollama config */
  ollamaConfig?: OllamaConfig;
  /** OpenAI config */
  openaiConfig?: OpenAIConfig;
  /** Rate limiting */
  rateLimit?: RateLimitConfig;
  /** Timeout in seconds */
  timeoutSeconds?: number;
  /** Max retries */
  maxRetries?: number;
}

/**
 * Validation errors for provider form.
 */
export interface ProviderFormErrors {
  name?: string;
  displayName?: string;
  type?: string;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  azureConfig?: {
    resourceName?: string;
    deploymentName?: string;
    apiVersion?: string;
  };
  awsConfig?: {
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  ollamaConfig?: {
    baseUrl?: string;
  };
}
