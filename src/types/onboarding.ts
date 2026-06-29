/**
 * Onboarding Type Definitions
 * Interfaces and types for the onboarding wizard and setup flow
 */

// ============================================================================
// Data-Plane Store Status Types (Task 34, D8)
// ============================================================================

/**
 * Provisioning state for an individual data-plane store.
 * Mirrors the tenant-operator saga states written to Tenant CRD
 * `status.dataPlane.stores.<store>.state` (Task 21).
 */
export type DataPlaneStoreState = 'provisioning' | 'ready' | 'failed';

/**
 * Status of a single data-plane store as surfaced by
 * GET /api/onboarding/data-plane.
 *
 * Missing fields indicate the CRD predates Task 21 or the operator
 * has not yet started provisioning that store.
 */
export interface StoreStatus {
  state: DataPlaneStoreState | null;
  reason: string | null;
  lastUpdated: string | null;
}

/**
 * Response shape for GET /api/onboarding/data-plane.
 *
 * Each key maps to a logical data-plane store. The `graph` field surfaces
 * the knowledge-graph store; the underlying CRD field name is implementation
 * detail and the dashboard's wire shape stays agnostic of the backend
 * choice, see the customer-doc terminology rule.
 *
 * A null `state` means not-yet-started (legacy CRD or pre-provisioning).
 */
export interface DataPlaneStatus {
  postgres: StoreStatus;
  redis: StoreStatus;
  graph: StoreStatus;
}

// ============================================================================
// Wizard Step Types
// ============================================================================

/**
 * Identifiers for each wizard step.
 */
export type WizardStepId =
  | 'welcome'
  | 'llm-provider'
  | 'agent-selection'
  | 'mission-creation'
  | 'completion';

/**
 * Status of a wizard step.
 */
type WizardStepStatus = 'pending' | 'current' | 'completed' | 'skipped';

/**
 * Configuration for a wizard step.
 */
interface WizardStep {
  /** Unique step identifier */
  id: WizardStepId;
  /** Display title */
  title: string;
  /** Brief description */
  description: string;
  /** Current status */
  status: WizardStepStatus;
  /** Whether this step can be skipped */
  isSkippable: boolean;
  /** Order in the wizard (0-indexed) */
  order: number;
  /** Estimated time to complete (in minutes) */
  estimatedMinutes: number;
}

/**
 * Default wizard steps configuration.
 */
export const WIZARD_STEPS: WizardStep[] = [
  {
    id: 'welcome',
    title: 'Welcome',
    description: 'Get an overview of Zero Root AI capabilities',
    status: 'pending',
    isSkippable: false,
    order: 0,
    estimatedMinutes: 1,
  },
  {
    id: 'llm-provider',
    title: 'LLM Provider',
    description: 'Configure your AI provider',
    status: 'pending',
    isSkippable: false,
    order: 1,
    estimatedMinutes: 2,
  },
  {
    id: 'agent-selection',
    title: 'Select Agent',
    description: 'Choose your first security agent',
    status: 'pending',
    isSkippable: false,
    order: 2,
    estimatedMinutes: 2,
  },
  {
    id: 'mission-creation',
    title: 'First Mission',
    description: 'Create your first security mission',
    status: 'pending',
    isSkippable: true,
    order: 3,
    estimatedMinutes: 3,
  },
  {
    id: 'completion',
    title: 'Complete',
    description: 'Setup complete! Start exploring',
    status: 'pending',
    isSkippable: false,
    order: 4,
    estimatedMinutes: 1,
  },
];

// ============================================================================
// LLM Provider Types
// ============================================================================

/**
 * Supported LLM provider types for onboarding.
 */
export type LLMProviderType = 'anthropic' | 'openai' | 'google' | 'ollama';

/**
 * LLM provider display configuration.
 */
interface LLMProviderConfig {
  /** Provider type */
  type: LLMProviderType;
  /** Display name */
  displayName: string;
  /** Provider description */
  description: string;
  /** Icon identifier */
  icon: string;
  /** Brand color (hex) */
  color: string;
  /** Whether API key is required */
  requiresApiKey: boolean;
  /** Placeholder text for API key input */
  apiKeyPlaceholder: string;
  /** Help URL for getting API key */
  apiKeyHelpUrl: string;
  /** Available models for this provider */
  models: string[];
  /** Recommended model for beginners */
  recommendedModel: string;
}

/**
 * LLM provider configurations for onboarding.
 */
const LLM_PROVIDER_CONFIG: Record<LLMProviderType, LLMProviderConfig> = {
  anthropic: {
    type: 'anthropic',
    displayName: 'Anthropic',
    description: 'Claude AI models with strong reasoning capabilities',
    icon: '🤖',
    color: '#CC785C',
    requiresApiKey: true,
    apiKeyPlaceholder: 'sk-ant-...',
    apiKeyHelpUrl: 'https://console.anthropic.com/settings/keys',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
    recommendedModel: 'claude-3-5-sonnet-20241022',
  },
  openai: {
    type: 'openai',
    displayName: 'OpenAI',
    description: 'GPT models with broad capabilities',
    icon: '🧠',
    color: '#412991',
    requiresApiKey: true,
    apiKeyPlaceholder: 'sk-...',
    apiKeyHelpUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    recommendedModel: 'gpt-4o',
  },
  google: {
    type: 'google',
    displayName: 'Google AI',
    description: 'Gemini models for advanced reasoning',
    icon: '✨',
    color: '#4285F4',
    requiresApiKey: true,
    apiKeyPlaceholder: 'AI...',
    apiKeyHelpUrl: 'https://aistudio.google.com/app/apikey',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    recommendedModel: 'gemini-2.0-flash',
  },
  ollama: {
    type: 'ollama',
    displayName: 'Ollama',
    description: 'Run models locally on your machine',
    icon: '🦙',
    color: '#1D1D1D',
    requiresApiKey: false,
    apiKeyPlaceholder: '',
    apiKeyHelpUrl: 'https://ollama.ai/download',
    models: ['llama3.2', 'qwen2.5-coder', 'mistral'],
    recommendedModel: 'llama3.2',
  },
};

/**
 * LLM provider types as array for iteration.
 */
const LLM_PROVIDER_TYPES: LLMProviderType[] = ['anthropic', 'openai', 'google', 'ollama'];

/**
 * LLM configuration during onboarding.
 */
export interface LLMConfig {
  /** Selected provider type */
  provider: LLMProviderType;
  /** API key (encrypted in storage) */
  apiKey?: string;
  /** Custom base URL (for Ollama or custom endpoints) */
  baseUrl?: string;
  /** Selected model */
  model: string;
  /** Whether the configuration has been validated */
  isValidated: boolean;
  /** Validation timestamp */
  validatedAt?: string;
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Result of a validation operation.
 */
interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Error message if validation failed */
  error?: string;
  /** Field-specific errors */
  fieldErrors?: Record<string, string>;
  /** Additional validation metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of LLM connection validation.
 */
interface LLMValidationResult extends ValidationResult {
  /** Available models (if validation succeeded) */
  availableModels?: string[];
  /** Response latency in milliseconds */
  latencyMs?: number;
  /** Provider-specific information */
  providerInfo?: {
    /** Provider version or API version */
    version?: string;
    /** Rate limit information */
    rateLimit?: {
      requestsPerMinute?: number;
      tokensPerMinute?: number;
    };
  };
}

// ============================================================================
// Setup Task Types
// ============================================================================

/**
 * Status of a setup task.
 */
export type SetupTaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'error';

/**
 * Identifiers for setup tasks.
 */
export type SetupTaskId =
  | 'configure_llm'
  | 'select_agent'
  | 'create_mission'
  | 'run_mission'
  | 'view_findings'
  | 'explore_graph'
  | 'invite_team';

/**
 * A single setup task in the progress checklist.
 */
export interface SetupTask {
  /** Unique task identifier */
  id: SetupTaskId;
  /** Display title */
  title: string;
  /** Brief description */
  description: string;
  /** Current status */
  status: SetupTaskStatus;
  /** Category for grouping */
  category: 'essential' | 'recommended' | 'optional';
  /** Link to complete this task */
  actionUrl: string;
  /** Estimated time to complete (in minutes) */
  estimatedMinutes: number;
  /** Order within category */
  order: number;
  /** Error message if status is 'error' */
  errorMessage?: string;
  /** When the task was completed */
  completedAt?: string;
}

/**
 * Default setup tasks configuration.
 */
export const DEFAULT_SETUP_TASKS: SetupTask[] = [
  {
    id: 'configure_llm',
    title: 'Configure LLM Provider',
    description: 'Set up your AI provider for agent reasoning',
    status: 'pending',
    category: 'essential',
    actionUrl: '/onboarding?step=llm-provider',
    estimatedMinutes: 2,
    order: 0,
  },
  {
    id: 'select_agent',
    title: 'Select Security Agent',
    description: 'Choose an agent to run security missions',
    status: 'pending',
    category: 'essential',
    actionUrl: '/onboarding?step=agent-selection',
    estimatedMinutes: 2,
    order: 1,
  },
  {
    id: 'create_mission',
    title: 'Create First Mission',
    description: 'Set up your first security testing mission',
    status: 'pending',
    category: 'essential',
    actionUrl: '/onboarding?step=mission-creation',
    estimatedMinutes: 3,
    order: 2,
  },
  {
    id: 'run_mission',
    title: 'Run a Mission',
    description: 'Execute your mission and discover findings',
    status: 'pending',
    category: 'recommended',
    actionUrl: '/missions',
    estimatedMinutes: 5,
    order: 3,
  },
  {
    id: 'view_findings',
    title: 'Review Findings',
    description: 'Explore security findings from your missions',
    status: 'pending',
    category: 'recommended',
    actionUrl: '/findings',
    estimatedMinutes: 3,
    order: 4,
  },
  {
    id: 'explore_graph',
    title: 'Explore Knowledge Graph',
    description: 'Visualize relationships between discoveries',
    status: 'pending',
    category: 'optional',
    actionUrl: '/graph',
    estimatedMinutes: 5,
    order: 5,
  },
  {
    id: 'invite_team',
    title: 'Invite Team Members',
    description: 'Collaborate with your security team',
    status: 'pending',
    category: 'optional',
    actionUrl: '/settings/team',
    estimatedMinutes: 2,
    order: 6,
  },
];

// ============================================================================
// Setup Progress Types
// ============================================================================

/**
 * Overall setup progress information.
 */
export interface SetupProgress {
  /** Percentage complete (0-100) */
  percentage: number;
  /** Total number of tasks */
  totalTasks: number;
  /** Number of completed tasks */
  completedTasks: number;
  /** Number of skipped tasks */
  skippedTasks: number;
  /** Estimated time remaining (in minutes) */
  estimatedMinutesRemaining: number;
  /** Tasks by category */
  byCategory: {
    essential: { total: number; completed: number };
    recommended: { total: number; completed: number };
    optional: { total: number; completed: number };
  };
}

// ============================================================================
// Onboarding State Types
// ============================================================================

/**
 * Complete onboarding state for a user.
 */
export interface OnboardingState {
  /** User ID this state belongs to */
  userId: string;
  /** Tenant ID */
  tenantId: string;
  /** Whether the wizard has been completed */
  wizardCompleted: boolean;
  /** Whether the wizard was skipped */
  wizardSkipped: boolean;
  /** Current step ID (if in progress) */
  currentStepId?: WizardStepId;
  /** Array of completed step IDs */
  completedSteps: WizardStepId[];
  /** Array of skipped step IDs */
  skippedSteps: WizardStepId[];
  /** LLM configuration from onboarding */
  llmConfig?: LLMConfig;
  /** Selected agent ID */
  selectedAgentId?: string;
  /** Created mission ID */
  createdMissionId?: string;
  /** Setup tasks status */
  setupTasks: SetupTask[];
  /** When onboarding started */
  startedAt: string;
  /** When onboarding was completed or skipped */
  completedAt?: string;
  /** State version for migrations */
  version: number;
  /** When the state was last updated */
  updatedAt: string;
}

/**
 * Current version of onboarding state schema.
 */
const ONBOARDING_STATE_VERSION = 1;

/**
 * Default onboarding state for new users.
 */
const DEFAULT_ONBOARDING_STATE: Omit<OnboardingState, 'userId' | 'tenantId' | 'startedAt' | 'updatedAt'> = {
  wizardCompleted: false,
  wizardSkipped: false,
  currentStepId: 'welcome',
  completedSteps: [],
  skippedSteps: [],
  llmConfig: undefined,
  selectedAgentId: undefined,
  createdMissionId: undefined,
  setupTasks: DEFAULT_SETUP_TASKS,
  version: ONBOARDING_STATE_VERSION,
};

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Request to update onboarding state.
 */
export interface UpdateOnboardingStateRequest {
  /** Step that was completed */
  completedStep?: WizardStepId;
  /** Step that was skipped */
  skippedStep?: WizardStepId;
  /** Navigate to step */
  navigateToStep?: WizardStepId;
  /** LLM configuration update */
  llmConfig?: Partial<LLMConfig>;
  /** Selected agent ID */
  selectedAgentId?: string;
  /** Created mission ID */
  createdMissionId?: string;
  /** Setup task update */
  setupTaskUpdate?: {
    taskId: SetupTaskId;
    status: SetupTaskStatus;
  };
  /** Mark wizard as completed */
  completeWizard?: boolean;
  /** Mark wizard as skipped */
  skipWizard?: boolean;
}

/**
 * Response from onboarding status endpoint.
 */
export interface OnboardingStatusResponse {
  /** Current onboarding state */
  state: OnboardingState;
  /** Calculated setup progress */
  progress: SetupProgress;
  /** Whether user should see onboarding */
  shouldShowOnboarding: boolean;
  /** Whether user should see setup widget */
  shouldShowSetupWidget: boolean;
}

/**
 * Request to validate LLM configuration.
 */
interface ValidateLLMRequest {
  /** Provider type */
  provider: LLMProviderType;
  /** API key to validate */
  apiKey?: string;
  /** Custom base URL */
  baseUrl?: string;
  /** Model to test */
  model?: string;
}

/**
 * Response from LLM validation endpoint.
 */
interface ValidateLLMResponse {
  /** Validation result */
  result: LLMValidationResult;
}

// ============================================================================
// Agent Types for Onboarding
// ============================================================================

/**
 * Agent information for the selection step.
 */
interface OnboardingAgent {
  /** Agent ID */
  id: string;
  /** Display name */
  name: string;
  /** Brief description */
  description: string;
  /** Agent category */
  category: string;
  /** Skill level required */
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  /** Whether this is a recommended starter agent */
  isRecommended: boolean;
  /** Icon identifier */
  icon: string;
  /** Capabilities list */
  capabilities: string[];
}

/**
 * Recommended agent for beginners.
 */
const RECOMMENDED_STARTER_AGENT = 'debug-agent';

// ============================================================================
// Empty State Types
// ============================================================================

/**
 * Variant for empty state display.
 */
type EmptyStateVariant = 'onboarding' | 'experienced';

/**
 * Configuration for empty state display.
 */
interface EmptyStateConfig {
  /** Icon to display */
  icon: string;
  /** Title text */
  title: string;
  /** Description text */
  description: string;
  /** Primary CTA text */
  primaryActionText: string;
  /** Primary CTA URL */
  primaryActionUrl: string;
  /** Secondary CTA text */
  secondaryActionText?: string;
  /** Secondary CTA URL */
  secondaryActionUrl?: string;
  /** Help link text */
  helpLinkText?: string;
  /** Help topic ID */
  helpTopicId?: string;
}
