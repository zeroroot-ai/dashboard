/**
 * Mission Creation TypeScript Interfaces
 *
 * Comprehensive type definitions for the mission creation feature.
 */

// ============================================================================
// Core Mission Types
// ============================================================================

/**
 * Main mission creation state
 */
export interface MissionCreationState {
  /** Current YAML content in the editor */
  yamlContent: string;
  /** Parsed mission metadata */
  metadata: MissionMetadata;
  /** Scope configuration */
  scope: ScopeConfig;
  /** Workflow configuration */
  workflow: WorkflowConfig;
  /** Guardrails configuration */
  guardrails: GuardrailsConfig;
  /** Current validation errors */
  validationErrors: ValidationError[];
  /** Current validation warnings */
  validationWarnings: ValidationWarning[];
  /** Whether mission is valid for submission */
  isValid: boolean;
  /** Whether content has been modified */
  isDirty: boolean;
  /** Currently active tab */
  activeTab: MissionCreationTab;
  /** Draft ID if saved */
  draftId: string | null;
  /** Last saved timestamp */
  lastSaved: string | null;
  /** Template this mission was created from */
  sourceTemplateId: string | null;
  /** Mission ID if cloned from existing */
  clonedFromId: string | null;
}

/**
 * Mission metadata configuration
 */
export interface MissionMetadata {
  /** Unique mission name */
  name: string;
  /** Mission description */
  description: string;
  /** Mission tags for categorization */
  tags: string[];
  /** Maximum mission duration in seconds */
  maxDuration: number | null;
  /** Maximum cost in tokens */
  maxCost: number | null;
  /** Minimum severity for findings */
  severityThreshold: SeverityLevel | null;
  /** Report format preferences */
  reportFormats: ReportFormat[];
  /** Mission priority */
  priority: MissionPriority;
  /** Custom metadata fields */
  customFields?: Record<string, string | number | boolean>;
}

/**
 * Scope configuration for mission targets
 */
export interface ScopeConfig {
  /** Seed targets to start from */
  seeds: ScopeTarget[];
  /** Include patterns (expand scope) */
  include: ScopePattern[];
  /** Exclude patterns (restrict scope) */
  exclude: ScopePattern[];
  /** Maximum depth for recursive discovery */
  maxDepth: number;
  /** Whether to follow redirects */
  followRedirects: boolean;
  /** Scope expansion mode */
  expansionMode: ScopeExpansionMode;
}

/**
 * Individual scope target
 */
export interface ScopeTarget {
  /** Unique identifier */
  id: string;
  /** Target type */
  type: ScopeTargetType;
  /** Target value (URL, domain, IP, etc.) */
  value: string;
  /** Optional label for display */
  label?: string;
  /** Whether target is valid */
  isValid: boolean;
  /** Validation error if invalid */
  validationError?: string;
}

/**
 * Scope pattern for include/exclude rules
 */
export interface ScopePattern {
  /** Pattern type */
  type: 'glob' | 'regex' | 'cidr';
  /** Pattern value */
  pattern: string;
  /** Optional description */
  description?: string;
}

/**
 * Workflow configuration
 */
export interface WorkflowConfig {
  /** Workflow type */
  type?: 'inline' | 'reference';
  /** For inline: workflow steps */
  steps: WorkflowStep[];
  /** For reference: workflow file path or ID */
  reference?: string;
  /** Workflow execution mode */
  executionMode?: WorkflowExecutionMode;
  /** Error handling strategy */
  errorHandling: ErrorHandlingStrategy;
}

/**
 * Individual workflow step
 */
export interface WorkflowStep {
  /** Unique step identifier */
  id: string;
  /** Step type */
  type: WorkflowStepType;
  /** Step name/label */
  name: string;
  /** Step configuration based on type */
  config: WorkflowStepConfig;
  /** Dependencies (step IDs that must complete first) */
  dependsOn?: string[];
  /** Condition for step execution */
  condition?: WorkflowCondition;
  /** Timeout in seconds */
  timeout?: number;
  /** Retry configuration */
  retry?: RetryConfig;
}

/**
 * Workflow step configuration (varies by type)
 */
export type WorkflowStepConfig =
  | AgentStepConfig
  | ToolStepConfig
  | PluginStepConfig
  | ConditionStepConfig
  | ParallelStepConfig
  | JoinStepConfig;

/**
 * Agent step configuration
 */
export interface AgentStepConfig {
  type: 'agent';
  /** Agent identifier */
  agentId: string;
  /** Agent task/prompt */
  task: string;
  /** Agent-specific parameters */
  parameters?: Record<string, unknown>;
}

/**
 * Tool step configuration
 */
export interface ToolStepConfig {
  type: 'tool';
  /** Tool identifier */
  toolId: string;
  /** Tool input parameters */
  inputs: Record<string, unknown>;
}

/**
 * Plugin step configuration
 */
export interface PluginStepConfig {
  type: 'plugin';
  /** Plugin identifier */
  pluginId: string;
  /** Plugin configuration */
  config: Record<string, unknown>;
}

/**
 * Condition step configuration
 */
export interface ConditionStepConfig {
  type: 'condition';
  /** Condition expression (CEL) */
  expression: string;
  /** Step ID if condition is true */
  ifTrue: string;
  /** Step ID if condition is false */
  ifFalse: string;
}

/**
 * Parallel execution step configuration
 */
export interface ParallelStepConfig {
  type: 'parallel';
  /** Step IDs to execute in parallel */
  branches: string[];
  /** Maximum concurrent branches */
  maxConcurrency?: number;
}

/**
 * Join step configuration (waits for parallel branches)
 */
export interface JoinStepConfig {
  type: 'join';
  /** Step IDs to wait for */
  waitFor: string[];
  /** How to handle branch results */
  mergeStrategy: 'all' | 'any' | 'majority';
}

/**
 * Guardrails configuration
 */
export interface GuardrailsConfig {
  /** Maximum tokens per agent call */
  maxTokensPerCall: number | null;
  /** Maximum total tokens for mission */
  maxTotalTokens: number | null;
  /** Rate limits per tool (or simple rate limit object) */
  rateLimits?: RateLimitConfig[] | {
    requestsPerMinute?: number;
    requestsPerHour?: number;
    requestsPerDay?: number;
    [key: string]: number | undefined;
  };
  /** Agents allowed to run */
  allowedAgents: string[];
  /** Agents blocked from running */
  blockedAgents: string[];
  /** Actions requiring confirmation */
  confirmationRequired: ConfirmationRule[];
  /** Output filtering rules */
  outputFilters: OutputFilterRule[];
  /** Maximum findings to collect */
  maxFindings: number | null;
  /** Enable CEL guardrails */
  enableCelGuardrails: boolean;
  /** Custom CEL guardrail expressions */
  customGuardrails: CelGuardrail[];
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Tool or agent ID */
  targetId: string;
  /** Target type */
  targetType: 'tool' | 'agent';
  /** Maximum calls per window */
  maxCalls: number;
  /** Window size in seconds */
  windowSeconds: number;
}

/**
 * Confirmation requirement rule
 */
export interface ConfirmationRule {
  /** Action type requiring confirmation */
  action: string;
  /** Condition when confirmation is required (CEL) */
  condition?: string;
  /** Confirmation message to display */
  message: string;
}

/**
 * Output filter rule
 */
export interface OutputFilterRule {
  /** Pattern to match (regex) */
  pattern: string;
  /** Action to take */
  action: 'redact' | 'block' | 'warn';
  /** Replacement text for redact */
  replacement?: string;
}

/**
 * CEL guardrail expression
 */
export interface CelGuardrail {
  /** Guardrail name */
  name: string;
  /** CEL expression */
  expression: string;
  /** Action on violation */
  action: 'block' | 'warn' | 'log';
  /** Error message */
  message: string;
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Validation error
 */
export interface ValidationError {
  /** Unique error identifier (optional for inline creation) */
  id?: string;
  /** Error type/code */
  code?: string;
  /** Human-readable message */
  message: string;
  /** Severity level */
  severity: 'error';
  /** Source location in YAML */
  location?: ValidationLocation;
  /** Path to error in parsed structure */
  path?: string;
  /** Flat line number (alternative to location.startLine) */
  line?: number;
  /** Flat column number (alternative to location.startColumn) */
  column?: number;
  /** Suggested fix */
  suggestion?: string;
  /** Documentation link */
  docLink?: string;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  /** Unique warning identifier (optional for inline creation) */
  id?: string;
  /** Warning type/code */
  code?: string;
  /** Human-readable message */
  message: string;
  /** Severity level */
  severity: 'warning' | 'info';
  /** Source location in YAML */
  location?: ValidationLocation;
  /** Path to warning in parsed structure */
  path?: string;
  /** Suggested improvement */
  suggestion?: string;
}

/**
 * Location in YAML source
 */
export interface ValidationLocation {
  /** Start line (1-indexed) */
  startLine: number;
  /** Start column (1-indexed) */
  startColumn: number;
  /** End line (1-indexed) */
  endLine: number;
  /** End column (1-indexed) */
  endColumn: number;
}

/**
 * Validation result from API
 */
export interface ValidationResult {
  /** Whether validation passed */
  isValid: boolean;
  /** Validation errors */
  errors: ValidationError[];
  /** Validation warnings */
  warnings: ValidationWarning[];
  /** Parsed mission structure (if valid) */
  parsed?: ParsedMission;
  /** Validation timing in ms */
  validationTimeMs: number;
}

/**
 * Parsed mission structure
 */
export interface ParsedMission {
  name: string;
  description?: string;
  scope: ScopeConfig;
  workflow: WorkflowConfig;
  guardrails?: GuardrailsConfig;
  metadata?: Partial<MissionMetadata>;
}

// ============================================================================
// Template Types
// ============================================================================

/**
 * Mission template definition
 */
export interface MissionTemplate {
  /** Unique template identifier */
  id: string;
  /** Template name */
  name: string;
  /** Template description */
  description: string;
  /** Template category */
  category: TemplateCategory;
  /** Template tags */
  tags?: string[];
  /** Difficulty level */
  difficulty?: TemplateDifficulty;
  /** Estimated runtime */
  estimatedDuration?: string;
  /** Template YAML content */
  yamlContent: string;
  /** Variables that can be customized */
  variables?: TemplateVariable[];
  /** Author/creator */
  author?: string;
  /** Version */
  version?: string;
  /** Creation date (ISO 8601) */
  createdAt?: string;
  /** Last updated */
  updatedAt?: string;
  /** Usage count */
  usageCount?: number;
  /** Whether featured */
  isFeatured?: boolean;
  /** Whether this is a built-in template */
  isBuiltIn?: boolean;
  /** Prerequisites */
  prerequisites?: TemplatePrerequisite[];
  /** Learning objectives */
  learningObjectives?: string[];
  /** Thumbnail image URL */
  thumbnailUrl?: string;
}

/**
 * Template variable definition
 */
export interface TemplateVariable {
  /** Variable name (used in ${NAME} syntax) */
  name: string;
  /** Display label */
  label?: string;
  /** Variable description */
  description?: string;
  /** Variable type */
  type?: TemplateVariableType;
  /** Default value */
  defaultValue?: string | number | boolean | string[];
  /** Whether required */
  required: boolean;
  /** Validation pattern (regex for strings) */
  pattern?: string;
  /** Minimum value (for numbers) */
  min?: number;
  /** Maximum value (for numbers) */
  max?: number;
  /** Options (for select type) */
  options?: Array<TemplateVariableOption | string>;
  /** Placeholder text */
  placeholder?: string;
}

/**
 * Template variable option (for select fields)
 */
export interface TemplateVariableOption {
  /** Option value */
  value: string;
  /** Option label */
  label: string;
  /** Option description */
  description?: string;
}

/**
 * Template prerequisite
 */
export interface TemplatePrerequisite {
  /** Prerequisite type */
  type: 'agent' | 'tool' | 'plugin' | 'config';
  /** Required component ID */
  id: string;
  /** Component name */
  name: string;
  /** Optional version requirement */
  version?: string;
  /** Whether optional */
  optional: boolean;
}

// ============================================================================
// Draft Types
// ============================================================================

/**
 * Draft mission (saved but not submitted)
 */
export interface DraftMission {
  /** Draft identifier */
  id: string;
  /** User who created the draft */
  userId: string;
  /** Tenant ID */
  tenantId: string;
  /** Draft name/title */
  name: string;
  /** YAML content */
  yamlContent: string;
  /** Creation timestamp */
  createdAt: string;
  /** Last modified timestamp */
  updatedAt: string;
  /** Source template ID if from template */
  templateId?: string;
  /** Source mission ID if cloned */
  clonedFromId?: string;
  /** Active tab when saved */
  activeTab: MissionCreationTab;
}

// ============================================================================
// UI State Types
// ============================================================================

/**
 * Available tabs in mission creation
 */
export type MissionCreationTab =
  | 'yaml'
  | 'visual'
  | 'templates'
  | 'preview'
  | 'metadata'
  | 'scope'
  | 'workflow'
  | 'guardrails';

/**
 * Editor mode for YAML editor
 */
export type EditorMode = 'edit' | 'readonly' | 'diff';

/**
 * Submission state
 */
export interface SubmissionState {
  /** Whether submission is in progress */
  isSubmitting: boolean;
  /** Whether submission succeeded */
  isSuccess: boolean;
  /** Error message if failed */
  error: string | null;
  /** Created mission ID on success */
  missionId: string | null;
}

// ============================================================================
// Enums and Literals
// ============================================================================

/**
 * Scope target types
 */
export type ScopeTargetType =
  | 'url'
  | 'domain'
  | 'ip'
  | 'cidr'
  | 'port'
  | 'repository'
  | 'custom';

/**
 * Scope expansion modes
 */
export type ScopeExpansionMode = 'strict' | 'subdomain' | 'related' | 'none';

/**
 * Workflow step types
 */
export type WorkflowStepType =
  | 'agent'
  | 'tool'
  | 'plugin'
  | 'condition'
  | 'parallel'
  | 'join'
  | 'wait';

/**
 * Workflow execution modes
 */
export type WorkflowExecutionMode = 'sequential' | 'parallel' | 'dag';

/**
 * Error handling strategies
 */
export type ErrorHandlingStrategy = 'stop' | 'continue' | 'retry' | 'fallback';

/**
 * Severity levels
 */
export type SeverityLevel =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'informational';

/**
 * Report formats
 */
export type ReportFormat = 'json' | 'html' | 'pdf' | 'sarif' | 'csv';

/**
 * Mission priority
 */
export type MissionPriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Template categories
 */
export type TemplateCategory =
  | 'web-security'
  | 'web'
  | 'api-testing'
  | 'api'
  | 'network'
  | 'cloud'
  | 'repository'
  | 'compliance'
  | 'custom'
  | 'recon'
  | 'osint'
  | 'exploitation';

/**
 * Template difficulty levels
 */
export type TemplateDifficulty = 'beginner' | 'intermediate' | 'advanced';

/**
 * Template variable types
 */
export type TemplateVariableType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'enum'
  | 'url'
  | 'domain'
  | 'ip'
  | 'cidr'
  | 'array';

// ============================================================================
// Workflow Condition Types
// ============================================================================

/**
 * Workflow condition for step execution
 */
export interface WorkflowCondition {
  /** Condition type */
  type: 'cel' | 'simple';
  /** CEL expression or simple condition */
  expression: string;
}

/**
 * Retry configuration for workflow steps
 */
export interface RetryConfig {
  /** Maximum retry attempts */
  maxAttempts: number;
  /** Initial delay in seconds */
  initialDelay: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Maximum delay in seconds */
  maxDelay: number;
}

// ============================================================================
// API Types
// ============================================================================

/**
 * Mission creation request
 */
export interface CreateMissionRequest {
  /** YAML content */
  yaml: string;
  /** Whether to start immediately */
  startImmediately: boolean;
  /** Custom mission name (overrides YAML) */
  name?: string;
}

/**
 * Mission creation response
 */
export interface CreateMissionResponse {
  /** Whether creation succeeded */
  success: boolean;
  /** Created mission ID */
  missionId?: string;
  /** Error message if failed */
  error?: string;
  /** Validation errors if invalid */
  validationErrors?: ValidationError[];
}

/**
 * Template list request
 */
export interface ListTemplatesRequest {
  /** Filter by category */
  category?: TemplateCategory;
  /** Search query */
  search?: string;
  /** Filter by tags */
  tags?: string[];
  /** Filter by difficulty */
  difficulty?: TemplateDifficulty;
  /** Include only featured */
  featuredOnly?: boolean;
  /** Pagination offset */
  offset?: number;
  /** Pagination limit */
  limit?: number;
}

/**
 * Template list response
 */
export interface ListTemplatesResponse {
  /** Templates matching query */
  templates: MissionTemplate[];
  /** Total count (for pagination) */
  total: number;
  /** Whether more results exist */
  hasMore: boolean;
}

// ============================================================================
// Store Action Types
// ============================================================================

/**
 * Actions available on the mission creation store
 */
export interface MissionCreationActions {
  /** Update YAML content */
  updateYaml: (yaml: string) => void;
  /** Update metadata fields */
  updateMetadata: (metadata: Partial<MissionMetadata>) => void;
  /** Update scope configuration */
  updateScope: (scope: Partial<ScopeConfig>) => void;
  /** Update workflow configuration */
  updateWorkflow: (workflow: Partial<WorkflowConfig>) => void;
  /** Update guardrails configuration */
  updateGuardrails: (guardrails: Partial<GuardrailsConfig>) => void;
  /** Set validation errors */
  setValidationErrors: (errors: ValidationError[]) => void;
  /** Set validation warnings */
  setValidationWarnings: (warnings: ValidationWarning[]) => void;
  /** Set active tab */
  setActiveTab: (tab: MissionCreationTab) => void;
  /** Reset all state */
  resetState: () => void;
  /** Load template */
  loadTemplate: (template: MissionTemplate, variables?: Record<string, unknown>) => void;
  /** Load draft */
  loadDraft: (draft: DraftMission) => void;
  /** Save draft */
  saveDraft: () => Promise<string>;
  /** Load from clone */
  loadFromClone: (missionId: string) => Promise<void>;
  /** Mark as dirty */
  markDirty: () => void;
  /** Mark as clean */
  markClean: () => void;
  /** Sync YAML to visual state */
  syncYamlToState: () => void;
  /** Sync visual state to YAML */
  syncStateToYaml: () => void;
}

/**
 * Complete mission creation store type
 */
export type MissionCreationStore = MissionCreationState & MissionCreationActions;

// ============================================================================
// Default Values
// ============================================================================

/**
 * Default mission metadata
 */
export const DEFAULT_METADATA: MissionMetadata = {
  name: '',
  description: '',
  tags: [],
  maxDuration: null,
  maxCost: null,
  severityThreshold: null,
  reportFormats: ['json'],
  priority: 'normal',
  customFields: {},
};

/**
 * Default scope configuration
 */
export const DEFAULT_SCOPE: ScopeConfig = {
  seeds: [],
  include: [],
  exclude: [],
  maxDepth: 3,
  followRedirects: true,
  expansionMode: 'subdomain',
};

/**
 * Default workflow configuration
 */
export const DEFAULT_WORKFLOW: WorkflowConfig = {
  type: 'inline',
  steps: [],
  executionMode: 'dag',
  errorHandling: 'continue',
};

/**
 * Default guardrails configuration
 */
export const DEFAULT_GUARDRAILS: GuardrailsConfig = {
  maxTokensPerCall: null,
  maxTotalTokens: null,
  rateLimits: [],
  allowedAgents: [],
  blockedAgents: [],
  confirmationRequired: [],
  outputFilters: [],
  maxFindings: null,
  enableCelGuardrails: true,
  customGuardrails: [],
};

/**
 * Default mission creation state
 */
export const DEFAULT_CREATION_STATE: MissionCreationState = {
  yamlContent: '',
  metadata: DEFAULT_METADATA,
  scope: DEFAULT_SCOPE,
  workflow: DEFAULT_WORKFLOW,
  guardrails: DEFAULT_GUARDRAILS,
  validationErrors: [],
  validationWarnings: [],
  isValid: false,
  isDirty: false,
  activeTab: 'yaml',
  draftId: null,
  lastSaved: null,
  sourceTemplateId: null,
  clonedFromId: null,
};

/**
 * Starter YAML template
 */
export const STARTER_YAML = `# Gibson Mission Configuration
name: my-mission
description: A new security mission

scope:
  seeds:
    - https://example.com
  include:
    - type: subdomain
      pattern: "*.example.com"

workflow:
  - agent: recon-agent
    task: Perform initial reconnaissance
  - agent: vulnerability-scanner
    task: Scan for common vulnerabilities

# Optional: guardrails
# guardrails:
#   maxTokensPerCall: 4000
#   maxTotalTokens: 100000
`;
