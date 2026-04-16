/**
 * Onboarding Analytics Events
 *
 * Defines and emits analytics events for onboarding wizard tracking.
 * Tracks funnel progression, completion rates, and drop-off points.
 */

import { WizardStepId, LLMProviderType as LLMProvider } from '@/src/types/onboarding';

// ============================================================================
// Event Types
// ============================================================================

/**
 * All onboarding analytics event types
 */
export type OnboardingEventType =
  | 'onboarding.wizard_started'
  | 'onboarding.step_viewed'
  | 'onboarding.step_completed'
  | 'onboarding.step_skipped'
  | 'onboarding.wizard_completed'
  | 'onboarding.wizard_skipped'
  | 'onboarding.wizard_abandoned'
  | 'onboarding.wizard_resumed'
  | 'onboarding.llm_provider_selected'
  | 'onboarding.llm_validation_attempted'
  | 'onboarding.llm_validation_succeeded'
  | 'onboarding.llm_validation_failed'
  | 'onboarding.agent_selected'
  | 'onboarding.template_selected'
  | 'onboarding.mission_created'
  | 'onboarding.help_opened'
  | 'onboarding.help_topic_viewed'
  | 'onboarding.error_encountered';

/**
 * Base event payload with common fields
 */
export interface BaseEventPayload {
  /** ISO timestamp of event */
  timestamp: string;
  /** User identifier (anonymized) */
  userId: string;
  /** Tenant identifier */
  tenantId: string;
  /** Current session ID */
  sessionId: string;
  /** Whether user has privacy mode enabled */
  privacyMode?: boolean;
}

/**
 * Wizard started event payload
 */
export interface WizardStartedPayload extends BaseEventPayload {
  /** Whether this is a fresh start or resume */
  isResume: boolean;
  /** Current step index if resuming */
  resumeFromStep?: number;
  /** Source of wizard entry (redirect, manual, banner) */
  entrySource: 'redirect' | 'manual' | 'banner' | 'deep_link';
}

/**
 * Step viewed event payload
 */
export interface StepViewedPayload extends BaseEventPayload {
  /** Step identifier */
  stepId: WizardStepId;
  /** Step index (0-based) */
  stepIndex: number;
  /** Total number of steps */
  totalSteps: number;
  /** Time since wizard started (ms) */
  timeFromStart: number;
}

/**
 * Step completed event payload
 */
export interface StepCompletedPayload extends BaseEventPayload {
  /** Step identifier */
  stepId: WizardStepId;
  /** Step index (0-based) */
  stepIndex: number;
  /** Time spent on this step (ms) */
  timeOnStep: number;
  /** Whether step was completed with minimum or extended actions */
  completionType: 'minimal' | 'full';
  /** Any additional data collected in step */
  stepData?: Record<string, unknown>;
}

/**
 * Step skipped event payload
 */
export interface StepSkippedPayload extends BaseEventPayload {
  /** Step identifier */
  stepId: WizardStepId;
  /** Step index (0-based) */
  stepIndex: number;
  /** Reason for skip if provided */
  skipReason?: string;
}

/**
 * Wizard completed event payload
 */
export interface WizardCompletedPayload extends BaseEventPayload {
  /** Total time from start to completion (ms) */
  totalDuration: number;
  /** Number of steps completed */
  stepsCompleted: number;
  /** Steps that were skipped */
  skippedSteps: WizardStepId[];
  /** Final configuration summary */
  configuration: {
    llmProvider: LLMProvider | null;
    agentId: string | null;
    missionCreated: boolean;
  };
}

/**
 * Wizard skipped event payload
 */
export interface WizardSkippedPayload extends BaseEventPayload {
  /** Step where user chose to skip */
  skippedAtStep: WizardStepId;
  /** Step index where user chose to skip */
  skippedAtIndex: number;
  /** Steps completed before skipping */
  completedSteps: WizardStepId[];
  /** Reason provided for skipping */
  skipReason?: 'experienced_user' | 'no_time' | 'will_return' | 'other';
}

/**
 * Wizard abandoned event payload
 */
export interface WizardAbandonedPayload extends BaseEventPayload {
  /** Last active step */
  lastStep: WizardStepId;
  /** Last active step index */
  lastStepIndex: number;
  /** Steps completed */
  completedSteps: WizardStepId[];
  /** Time since last interaction (ms) */
  inactivityDuration: number;
}

/**
 * Wizard resumed event payload
 */
export interface WizardResumedPayload extends BaseEventPayload {
  /** Time since last activity (ms) */
  timeSinceLastActivity: number;
  /** Step being resumed */
  resumeStep: WizardStepId;
  /** Previously completed steps */
  completedSteps: WizardStepId[];
  /** Resume source */
  resumeSource: 'banner' | 'direct_navigation' | 'deep_link';
}

/**
 * LLM provider selected event payload
 */
export interface LLMProviderSelectedPayload extends BaseEventPayload {
  /** Selected provider */
  provider: LLMProvider;
  /** Previous provider if changed */
  previousProvider?: LLMProvider;
}

/**
 * LLM validation event payload
 */
export interface LLMValidationPayload extends BaseEventPayload {
  /** Provider being validated */
  provider: LLMProvider;
  /** Whether validation succeeded */
  success: boolean;
  /** Error message if failed (sanitized) */
  errorType?: 'invalid_format' | 'invalid_key' | 'network_error' | 'quota_exceeded' | 'unknown';
  /** Time taken for validation (ms) */
  validationDuration: number;
}

/**
 * Agent selected event payload
 */
export interface AgentSelectedPayload extends BaseEventPayload {
  /** Selected agent ID */
  agentId: string;
  /** Agent name */
  agentName: string;
  /** Agent difficulty */
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  /** Whether it was the recommended agent */
  wasRecommended: boolean;
}

/**
 * Template selected event payload
 */
export interface TemplateSelectedPayload extends BaseEventPayload {
  /** Template ID */
  templateId: string;
  /** Template name */
  templateName: string;
  /** Template category */
  category: string;
  /** Template difficulty */
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  /** Whether it was featured */
  wasFeatured: boolean;
}

/**
 * Mission created event payload
 */
export interface MissionCreatedPayload extends BaseEventPayload {
  /** Created mission ID */
  missionId: string;
  /** Source template ID */
  templateId: string;
  /** Whether custom values were used */
  usedCustomValues: boolean;
  /** Time to create from template selection (ms) */
  creationDuration: number;
}

/**
 * Help opened event payload
 */
export interface HelpOpenedPayload extends BaseEventPayload {
  /** How help was opened */
  openMethod: 'keyboard_shortcut' | 'button_click' | 'contextual_link' | 'tooltip';
  /** Current wizard step when opened */
  currentStep: WizardStepId;
  /** Search query if searched */
  searchQuery?: string;
}

/**
 * Help topic viewed event payload
 */
export interface HelpTopicViewedPayload extends BaseEventPayload {
  /** Topic ID */
  topicId: string;
  /** Topic category */
  category: string;
  /** How topic was found */
  discoveryMethod: 'search' | 'browse' | 'contextual' | 'related';
  /** Time spent viewing (ms) - sent on topic change/close */
  viewDuration?: number;
}

/**
 * Error encountered event payload
 */
export interface ErrorEncounteredPayload extends BaseEventPayload {
  /** Current step when error occurred */
  step: WizardStepId;
  /** Error type */
  errorType: 'validation' | 'network' | 'api' | 'unknown';
  /** Sanitized error message */
  errorMessage: string;
  /** Whether user recovered */
  recovered?: boolean;
}

// ============================================================================
// Event Emitter
// ============================================================================

/** Global analytics instance reference */
let analyticsInstance: AnalyticsClient | null = null;

/**
 * Analytics client interface
 */
interface AnalyticsClient {
  track(event: string, properties: Record<string, unknown>): void;
  identify(userId: string, traits: Record<string, unknown>): void;
  page(name: string, properties?: Record<string, unknown>): void;
}

/**
 * Initialize analytics with client
 */
export function initializeOnboardingAnalytics(client: AnalyticsClient): void {
  analyticsInstance = client;
}

/**
 * Get current session context
 */
function getSessionContext(): Pick<BaseEventPayload, 'timestamp' | 'sessionId'> {
  return {
    timestamp: new Date().toISOString(),
    sessionId: getSessionId(),
  };
}

/**
 * Get or create session ID
 */
function getSessionId(): string {
  if (typeof window === 'undefined') {
    return 'server-session';
  }

  let sessionId = sessionStorage.getItem('gibson:analytics:session_id');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    sessionStorage.setItem('gibson:analytics:session_id', sessionId);
  }
  return sessionId;
}

/**
 * Check if user has privacy mode enabled
 */
function checkPrivacyMode(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('gibson:analytics:privacy_mode') === 'true';
}

/**
 * Emit analytics event
 */
function emit(event: OnboardingEventType, payload: Record<string, unknown>): void {
  if (!analyticsInstance) {
    console.debug('[Analytics] No client initialized, skipping:', event);
    return;
  }

  if (checkPrivacyMode()) {
    console.debug('[Analytics] Privacy mode enabled, skipping:', event);
    return;
  }

  analyticsInstance.track(event, {
    ...getSessionContext(),
    ...payload,
  });
}

// ============================================================================
// Event Emitter Functions
// ============================================================================

/**
 * Emit wizard started event
 */
export function trackWizardStarted(
  userId: string,
  tenantId: string,
  options: {
    isResume: boolean;
    resumeFromStep?: number;
    entrySource: WizardStartedPayload['entrySource'];
  }
): void {
  emit('onboarding.wizard_started', {
    userId,
    tenantId,
    ...options,
  });
}

/**
 * Emit step viewed event
 */
export function trackStepViewed(
  userId: string,
  tenantId: string,
  stepId: WizardStepId,
  stepIndex: number,
  totalSteps: number,
  timeFromStart: number
): void {
  emit('onboarding.step_viewed', {
    userId,
    tenantId,
    stepId,
    stepIndex,
    totalSteps,
    timeFromStart,
  });
}

/**
 * Emit step completed event
 */
export function trackStepCompleted(
  userId: string,
  tenantId: string,
  stepId: WizardStepId,
  stepIndex: number,
  timeOnStep: number,
  completionType: StepCompletedPayload['completionType'] = 'full',
  stepData?: Record<string, unknown>
): void {
  emit('onboarding.step_completed', {
    userId,
    tenantId,
    stepId,
    stepIndex,
    timeOnStep,
    completionType,
    stepData,
  });
}

/**
 * Emit step skipped event
 */
export function trackStepSkipped(
  userId: string,
  tenantId: string,
  stepId: WizardStepId,
  stepIndex: number,
  skipReason?: string
): void {
  emit('onboarding.step_skipped', {
    userId,
    tenantId,
    stepId,
    stepIndex,
    skipReason,
  });
}

/**
 * Emit wizard completed event
 */
export function trackWizardCompleted(
  userId: string,
  tenantId: string,
  totalDuration: number,
  stepsCompleted: number,
  skippedSteps: WizardStepId[],
  configuration: WizardCompletedPayload['configuration']
): void {
  emit('onboarding.wizard_completed', {
    userId,
    tenantId,
    totalDuration,
    stepsCompleted,
    skippedSteps,
    configuration,
  });
}

/**
 * Emit wizard skipped event
 */
export function trackWizardSkipped(
  userId: string,
  tenantId: string,
  skippedAtStep: WizardStepId,
  skippedAtIndex: number,
  completedSteps: WizardStepId[],
  skipReason?: WizardSkippedPayload['skipReason']
): void {
  emit('onboarding.wizard_skipped', {
    userId,
    tenantId,
    skippedAtStep,
    skippedAtIndex,
    completedSteps,
    skipReason,
  });
}

/**
 * Emit wizard abandoned event
 */
export function trackWizardAbandoned(
  userId: string,
  tenantId: string,
  lastStep: WizardStepId,
  lastStepIndex: number,
  completedSteps: WizardStepId[],
  inactivityDuration: number
): void {
  emit('onboarding.wizard_abandoned', {
    userId,
    tenantId,
    lastStep,
    lastStepIndex,
    completedSteps,
    inactivityDuration,
  });
}

/**
 * Emit wizard resumed event
 */
export function trackWizardResumed(
  userId: string,
  tenantId: string,
  timeSinceLastActivity: number,
  resumeStep: WizardStepId,
  completedSteps: WizardStepId[],
  resumeSource: WizardResumedPayload['resumeSource']
): void {
  emit('onboarding.wizard_resumed', {
    userId,
    tenantId,
    timeSinceLastActivity,
    resumeStep,
    completedSteps,
    resumeSource,
  });
}

/**
 * Emit LLM provider selected event
 */
export function trackLLMProviderSelected(
  userId: string,
  tenantId: string,
  provider: LLMProvider,
  previousProvider?: LLMProvider
): void {
  emit('onboarding.llm_provider_selected', {
    userId,
    tenantId,
    provider,
    previousProvider,
  });
}

/**
 * Emit LLM validation attempted event
 */
export function trackLLMValidationAttempted(
  userId: string,
  tenantId: string,
  provider: LLMProvider
): void {
  emit('onboarding.llm_validation_attempted', {
    userId,
    tenantId,
    provider,
  });
}

/**
 * Emit LLM validation succeeded event
 */
export function trackLLMValidationSucceeded(
  userId: string,
  tenantId: string,
  provider: LLMProvider,
  validationDuration: number
): void {
  emit('onboarding.llm_validation_succeeded', {
    userId,
    tenantId,
    provider,
    success: true,
    validationDuration,
  });
}

/**
 * Emit LLM validation failed event
 */
export function trackLLMValidationFailed(
  userId: string,
  tenantId: string,
  provider: LLMProvider,
  errorType: LLMValidationPayload['errorType'],
  validationDuration: number
): void {
  emit('onboarding.llm_validation_failed', {
    userId,
    tenantId,
    provider,
    success: false,
    errorType,
    validationDuration,
  });
}

/**
 * Emit agent selected event
 */
export function trackAgentSelected(
  userId: string,
  tenantId: string,
  agentId: string,
  agentName: string,
  difficulty: AgentSelectedPayload['difficulty'],
  wasRecommended: boolean
): void {
  emit('onboarding.agent_selected', {
    userId,
    tenantId,
    agentId,
    agentName,
    difficulty,
    wasRecommended,
  });
}

/**
 * Emit template selected event
 */
export function trackTemplateSelected(
  userId: string,
  tenantId: string,
  templateId: string,
  templateName: string,
  category: string,
  difficulty: TemplateSelectedPayload['difficulty'],
  wasFeatured: boolean
): void {
  emit('onboarding.template_selected', {
    userId,
    tenantId,
    templateId,
    templateName,
    category,
    difficulty,
    wasFeatured,
  });
}

/**
 * Emit mission created event
 */
export function trackMissionCreated(
  userId: string,
  tenantId: string,
  missionId: string,
  templateId: string,
  usedCustomValues: boolean,
  creationDuration: number
): void {
  emit('onboarding.mission_created', {
    userId,
    tenantId,
    missionId,
    templateId,
    usedCustomValues,
    creationDuration,
  });
}

/**
 * Emit help opened event
 */
export function trackHelpOpened(
  userId: string,
  tenantId: string,
  openMethod: HelpOpenedPayload['openMethod'],
  currentStep: WizardStepId,
  searchQuery?: string
): void {
  emit('onboarding.help_opened', {
    userId,
    tenantId,
    openMethod,
    currentStep,
    searchQuery,
  });
}

/**
 * Emit help topic viewed event
 */
export function trackHelpTopicViewed(
  userId: string,
  tenantId: string,
  topicId: string,
  category: string,
  discoveryMethod: HelpTopicViewedPayload['discoveryMethod'],
  viewDuration?: number
): void {
  emit('onboarding.help_topic_viewed', {
    userId,
    tenantId,
    topicId,
    category,
    discoveryMethod,
    viewDuration,
  });
}

/**
 * Emit error encountered event
 */
export function trackErrorEncountered(
  userId: string,
  tenantId: string,
  step: WizardStepId,
  errorType: ErrorEncounteredPayload['errorType'],
  errorMessage: string,
  recovered?: boolean
): void {
  // Sanitize error message to remove sensitive data
  const sanitizedMessage = errorMessage
    .replace(/sk-[a-zA-Z0-9-_]+/g, '[API_KEY]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    .substring(0, 200);

  emit('onboarding.error_encountered', {
    userId,
    tenantId,
    step,
    errorType,
    errorMessage: sanitizedMessage,
    recovered,
  });
}

// ============================================================================
// Funnel Analysis Helpers
// ============================================================================

/**
 * Calculate funnel metrics from events
 */
export interface FunnelMetrics {
  totalStarts: number;
  stepCompletionRates: Record<WizardStepId, number>;
  averageTimePerStep: Record<WizardStepId, number>;
  completionRate: number;
  skipRate: number;
  abandonmentRate: number;
  averageCompletionTime: number;
  dropOffPoints: { step: WizardStepId; rate: number }[];
}

/**
 * Step timing tracker for calculating durations
 */
export class StepTimingTracker {
  private stepStartTimes: Map<WizardStepId, number> = new Map();
  private wizardStartTime: number | null = null;

  startWizard(): void {
    this.wizardStartTime = Date.now();
    this.stepStartTimes.clear();
  }

  startStep(stepId: WizardStepId): void {
    this.stepStartTimes.set(stepId, Date.now());
  }

  getStepDuration(stepId: WizardStepId): number {
    const startTime = this.stepStartTimes.get(stepId);
    if (!startTime) return 0;
    return Date.now() - startTime;
  }

  getWizardDuration(): number {
    if (!this.wizardStartTime) return 0;
    return Date.now() - this.wizardStartTime;
  }

  getTimeFromStart(): number {
    return this.getWizardDuration();
  }

  reset(): void {
    this.stepStartTimes.clear();
    this.wizardStartTime = null;
  }
}

// Create singleton timing tracker
export const timingTracker = new StepTimingTracker();

export default {
  initializeOnboardingAnalytics,
  trackWizardStarted,
  trackStepViewed,
  trackStepCompleted,
  trackStepSkipped,
  trackWizardCompleted,
  trackWizardSkipped,
  trackWizardAbandoned,
  trackWizardResumed,
  trackLLMProviderSelected,
  trackLLMValidationAttempted,
  trackLLMValidationSucceeded,
  trackLLMValidationFailed,
  trackAgentSelected,
  trackTemplateSelected,
  trackMissionCreated,
  trackHelpOpened,
  trackHelpTopicViewed,
  trackErrorEncountered,
  timingTracker,
};
