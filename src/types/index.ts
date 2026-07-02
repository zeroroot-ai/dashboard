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

interface FindingFilters {
  severity?: FindingSeverity[];
  type?: string[];
  missionId?: string;
  search?: string;
}

// ============================================================================
// Finding Export Types
// ============================================================================

type FindingsExportFormat = 'json' | 'csv' | 'sarif' | 'html' | 'pdf';

interface FindingsExportOptions {
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

interface FindingsExportResult {
  success: boolean;
  filename: string;
  format: FindingsExportFormat;
  findingsCount: number;
  exportedAt: string;
  downloadUrl?: string;
  error?: string;
}

interface SARIFReport {
  $schema: string;
  version: string;
  runs: SARIFRun[];
}

interface SARIFRun {
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

interface SARIFRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  help?: { text: string };
  defaultConfiguration?: {
    level: 'error' | 'warning' | 'note' | 'none';
  };
}

interface SARIFResult {
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

interface EventFilter {
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

interface NodeStyle {
  color?: string;
  borderColor?: string;
  icon?: string;
  size?: number;
}

interface GraphNode {
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

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  properties?: Record<string, unknown>;
  label?: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

type GraphLayout = '2d' | '3d' | 'force';

// ============================================================================
// User Session Types
// ============================================================================

interface UserSession {
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

type NotificationType =
  | 'info'
  | 'success'
  | 'warning'
  | 'error';

interface Notification {
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

interface ChatMessage {
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

type ConnectionStatus =
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

interface PaginationParams {
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

interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
  timestamp: Date;
}

// ============================================================================
// Re-export Analytics Types
// ============================================================================

export type {
  KPIData,
  TimeRange,
  FindingsOverTime,
  CategoryCount,
  SeverityDistribution,
  MissionHeatmap,
  AgentPerformance,
} from './analytics';


// ============================================================================
// Re-export Tenant Types
// ============================================================================

export type {
} from './tenant';

// ============================================================================
// Re-export Provider Types
// ============================================================================

export type {
  // ProviderType removed, use string; see spec 25-daemon-driven-provider-config
  // AzureConfig, AWSConfig, OllamaConfig, OpenAIConfig removed, spec 25
  // ProviderConfigInput removed, use DaemonProviderConfigInput from gibson-client
  // ProviderFormData, ProviderFormErrors removed, spec 25
} from './provider';

export {
  // PROVIDER_TYPE_CONFIG, PROVIDER_TYPES, PROVIDER_MODELS removed, spec 25
} from './provider';

// ============================================================================
// Re-export Onboarding Types
// ============================================================================

export type {
} from './onboarding';

export {
} from './onboarding';

// ============================================================================
// Re-export Template Types
// ============================================================================

export type {
} from './templates';

export {
} from './templates';

// ============================================================================
// Re-export Trace Types
// ============================================================================


// ============================================================================
// API Key Types
// ============================================================================

/** API key metadata returned by the daemon's ListAPIKeys RPC. */
interface APIKeyInfo {
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
