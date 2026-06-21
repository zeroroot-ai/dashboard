/**
 * Base Type Definitions
 * Core interfaces and types for the Gibson Mission Control dashboard
 */

// ============================================================================
// Mission Types
// ============================================================================

export type MissionStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped';

export interface MissionConfig {
  target?: string;
  description?: string;
  hosts?: string[];
  scope?: string;
  timeout?: number;
  agents?: string[];
  parameters?: Record<string, unknown>;
}

export interface Mission {
  id: string;
  name: string;
  status: MissionStatus;
  progress: number;
  startedAt?: Date;
  completedAt?: Date;
  config: MissionConfig;
  agents: string[];
  findings: number;
  events: number;
  tenantId: string;
  missionDefinitionId?: string;
}

export interface MissionFilters {
  status?: MissionStatus[];
  search?: string;
  timeRange?: 'hour' | '24h' | '7d' | '30d' | 'all';
  tags?: string[];
}

// ============================================================================
// Finding Types
// ============================================================================

export type FindingSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info';

export interface TaxonomyReference {
  framework?: string;
  category?: string;
  subcategory?: string;
  id?: string;
}

export interface Finding {
  id: string;
  missionId: string;
  type: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  evidence?: Record<string, unknown>;
  remediation?: string;
  affectedAssets: string[];
  discoveredAt: Date;
  taxonomy: TaxonomyReference;
}

export interface FindingFilters {
  severity?: FindingSeverity[];
  type?: string[];
  missionId?: string;
  search?: string;
}

// ============================================================================
// Finding Export Types
// ============================================================================

export type FindingsExportFormat = 'json' | 'csv' | 'sarif' | 'html' | 'pdf';

export interface FindingsExportOptions {
  /** Export format */
  format: FindingsExportFormat;
  /** Findings to export (if not provided, uses current filters) */
  findingIds?: string[];
  /** Include mission metadata */
  includeMissionMetadata?: boolean;
  /** Include remediation details */
  includeRemediation?: boolean;
  /** Include evidence/proof data */
  includeEvidence?: boolean;
  /** Group by mission */
  groupByMission?: boolean;
  /** Include executive summary (for HTML/PDF) */
  includeExecutiveSummary?: boolean;
  /** Custom filename */
  filename?: string;
}

export interface FindingsExportResult {
  success: boolean;
  filename: string;
  format: FindingsExportFormat;
  findingsCount: number;
  exportedAt: string;
  downloadUrl?: string;
  error?: string;
}

export interface SARIFReport {
  $schema: string;
  version: string;
  runs: SARIFRun[];
}

export interface SARIFRun {
  tool: {
    driver: {
      name: string;
      version: string;
      informationUri?: string;
      rules?: SARIFRule[];
    };
  };
  results: SARIFResult[];
}

export interface SARIFRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  help?: { text: string };
  defaultConfiguration?: {
    level: 'error' | 'warning' | 'note' | 'none';
  };
}

export interface SARIFResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note' | 'none';
  message: { text: string };
  locations?: Array<{
    physicalLocation?: {
      artifactLocation: { uri: string };
      region?: { startLine?: number };
    };
  }>;
  fingerprints?: Record<string, string>;
}

// ============================================================================
// Event Types
// ============================================================================

export type EventType =
  | 'mission'
  | 'agent'
  | 'tool'
  | 'finding'
  | 'llm'
  | 'system';

export type EventSeverity =
  | 'info'
  | 'warning'
  | 'error';

export interface Event {
  id: string;
  type: EventType;
  source: string;
  timestamp: Date;
  payload: Record<string, unknown>;
  severity?: EventSeverity;
  missionId?: string;
}

export interface EventFilter {
  types?: EventType[];
  severity?: EventSeverity[];
  source?: string;
  missionId?: string;
}

// ============================================================================
// Component Status Types
// ============================================================================

export type ComponentType =
  | 'agent'
  | 'tool'
  | 'plugin';

export type ComponentStatus =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'unknown';

export interface ComponentHealth {
  id: string;
  name: string;
  type: ComponentType;
  status: ComponentStatus;
  lastActivity?: Date;
  replicas?: number;
  errorRate?: number;
  resourceUtilization?: {
    cpu?: number;
    memory?: number;
  };
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Knowledge Graph Types
// ============================================================================

export type GraphNodeType =
  | 'Mission'
  | 'Agent'
  | 'Host'
  | 'Service'
  | 'Vulnerability'
  | 'Finding'
  | 'Endpoint'
  | 'User'
  | 'Credential';

export interface NodeStyle {
  color?: string;
  borderColor?: string;
  icon?: string;
  size?: number;
}

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  properties: Record<string, unknown>;
  position?: {
    x: number;
    y: number;
    z?: number;
  };
  style?: NodeStyle;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  properties?: Record<string, unknown>;
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type GraphLayout = '2d' | '3d' | 'force';

// ============================================================================
// User Session Types
// ============================================================================

export interface UserSession {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string;
  };
  tenantId: string;
  roles: string[];
  expires: string;
}

// ============================================================================
// Notification Types
// ============================================================================

export type NotificationType =
  | 'info'
  | 'success'
  | 'warning'
  | 'error';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  actionUrl?: string;
}

// ============================================================================
// Chat Types
// ============================================================================

export interface ChatMessage {
  id: string;
  agentId?: string;
  content: string;
  timestamp: Date;
  sender: 'user' | 'agent' | 'system';
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Connection Status Types
// ============================================================================

export type ConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected';

// ============================================================================
// Metric Types
// ============================================================================

export interface MetricValue {
  current: number;
  trend?: 'up' | 'down' | 'stable';
  previousValue?: number;
  percentChange?: number;
}

export interface DashboardMetrics {
  activeMissions: MetricValue;
  totalFindings: MetricValue & {
    bySeverity: Record<FindingSeverity, number>;
  };
  agentActivity: {
    active: number;
    total: number;
    byStatus: Record<ComponentStatus, number>;
  };
  systemHealth: {
    overall: ComponentStatus;
    components: Record<string, ComponentStatus>;
  };
}

// ============================================================================
// Pagination Types
// ============================================================================

export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page?: number;
  limit?: number;
  nextCursor?: string;
  hasMore?: boolean;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
  timestamp: Date;
}

// ============================================================================
// Re-export Analytics Types
// ============================================================================

export type {
  KPIData,
  TimeSeriesPoint,
  TimeRange,
  FindingsOverTime,
  CategoryCount,
  SeverityDistribution,
  HeatmapCell,
  MissionHeatmap,
  AgentPerformance,
  AgentStatus,
  Alert,
  AlertType,
  AlertSeverity,
  WidgetConfig,
  WidgetPosition,
  WidgetLayout,
  UserLayoutPreferences,
} from './analytics';

export { WidgetType } from './analytics';

// ============================================================================
// Re-export Tenant Types
// ============================================================================

export type {
  Tenant,
  TenantSettings,
  TenantRole,
  TenantSwitchRequest,
  TenantSwitchResponse,
} from './tenant';

// ============================================================================
// Re-export Provider Types
// ============================================================================

export type {
  // ProviderType removed, use string; see spec 25-daemon-driven-provider-config
  ProviderHealthStatus,
  // AzureConfig, AWSConfig, OllamaConfig, OpenAIConfig removed, spec 25
  RateLimitConfig,
  HealthStatus,
  ProviderConfig,
  // ProviderConfigInput removed, use DaemonProviderConfigInput from gibson-client
  ModelInfo,
  ConnectionTestResult,
  ProviderAuditEventType,
  FieldChange,
  ProviderAuditEvent,
  ExportFormat,
  ImportMergeStrategy,
  ImportError,
  ImportResult,
  ExportResult,
  ListProvidersRequest,
  ListProvidersResponse,
  CreateProviderRequest,
  CreateProviderResponse,
  UpdateProviderRequest,
  UpdateProviderResponse,
  DeleteProviderRequest,
  DeleteProviderResponse,
  TestConnectionRequest,
  SetDefaultProviderRequest,
  SetDefaultProviderResponse,
  GetHealthStatusRequest,
  GetHealthStatusResponse,
  ExportConfigRequest,
  ImportConfigRequest,
  GetAuditLogRequest,
  GetAuditLogResponse,
  // ProviderFormData, ProviderFormErrors removed, spec 25
} from './provider';

export {
  // PROVIDER_TYPE_CONFIG, PROVIDER_TYPES, PROVIDER_MODELS removed, spec 25
  HEALTH_STATUS_CONFIG,
  PROVIDER_AUDIT_EVENT_CONFIG,
} from './provider';

// ============================================================================
// Re-export Onboarding Types
// ============================================================================

export type {
  WizardStepId,
  WizardStepStatus,
  WizardStep,
  LLMProviderType,
  LLMProviderConfig,
  LLMConfig,
  ValidationResult,
  LLMValidationResult,
  SetupTaskStatus,
  SetupTaskId,
  SetupTask,
  SetupProgress,
  OnboardingState,
  UpdateOnboardingStateRequest,
  OnboardingStatusResponse,
  ValidateLLMRequest,
  ValidateLLMResponse,
  OnboardingAgent,
  EmptyStateVariant,
  EmptyStateConfig,
} from './onboarding';

export {
  WIZARD_STEPS,
  LLM_PROVIDER_CONFIG,
  LLM_PROVIDER_TYPES,
  DEFAULT_SETUP_TASKS,
  ONBOARDING_STATE_VERSION,
  DEFAULT_ONBOARDING_STATE,
  RECOMMENDED_STARTER_AGENT,
} from './onboarding';

// ============================================================================
// Re-export Template Types
// ============================================================================

export type {
  TemplateCategory,
  TemplateDifficulty,
  PrerequisiteType,
  TemplatePrerequisite,
  CustomizableFieldType,
  CustomizableField,
  CustomizableFieldOption,
  CustomizableFieldGroup,
  MissionTemplate,
  MissionTemplateListItem,
  TemplateRenderResult,
  TemplateValidationError,
  TemplateCustomValues,
  ListTemplatesRequest,
  ListTemplatesResponse,
  GetTemplateRequest,
  GetTemplateResponse,
  RenderTemplateRequest,
  RenderTemplateResponse,
  CheckPrerequisitesRequest,
  CheckPrerequisitesResponse,
  TemplateFilters,
  TemplateSort,
} from './templates';

export {
  TEMPLATE_CATEGORY_CONFIG,
  TEMPLATE_DIFFICULTY_CONFIG,
  ONBOARDING_TEMPLATE_IDS,
  TEMPLATE_CATEGORIES,
  TEMPLATE_DIFFICULTIES,
} from './templates';

// ============================================================================
// Re-export Trace Types
// ============================================================================

export type { LlmCallSummary, LlmRun, LlmCallDetailData, ConversationMessage, TokenSummary, ModelTokenBreakdown, MessageRole, RunListResponse, RunDetailResponse } from './trace';

// ============================================================================
// API Key Types
// ============================================================================

/** API key metadata returned by the daemon's ListAPIKeys RPC. */
export interface APIKeyInfo {
  keyId: string;
  name?: string;
  componentType?: string;
  componentName?: string;
  status: 'active' | 'revoked';
  capabilities?: string[];
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
}
