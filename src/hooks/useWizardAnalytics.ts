'use client';

import * as React from 'react';
import { useOnboardingStore } from '@/src/stores/onboarding-store';
import { WIZARD_STEPS, type WizardStepId, type LLMProviderType as LLMProvider } from '@/src/types/onboarding';
import {
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
  trackErrorEncountered,
  timingTracker,
  type LLMValidationPayload,
  type HelpOpenedPayload,
  type ErrorEncounteredPayload,
  type WizardStartedPayload,
  type WizardResumedPayload,
  type AgentSelectedPayload,
  type TemplateSelectedPayload,
} from '@/src/lib/analytics/onboarding-events';

// ============================================================================
// Types
// ============================================================================

export interface WizardAnalyticsContext {
  userId: string;
  tenantId: string;
}

export interface UseWizardAnalyticsReturn {
  /** Call when wizard starts */
  onWizardStart: (isResume: boolean, entrySource: WizardStartedPayload['entrySource']) => void;
  /** Call when a step becomes visible */
  onStepView: (stepId: WizardStepId) => void;
  /** Call when a step is completed successfully */
  onStepComplete: (stepId: WizardStepId, stepData?: Record<string, unknown>) => void;
  /** Call when a step is explicitly skipped */
  onStepSkip: (stepId: WizardStepId, reason?: string) => void;
  /** Call when wizard is fully completed */
  onWizardComplete: () => void;
  /** Call when user chooses to skip entire wizard */
  onWizardSkip: (reason?: string) => void;
  /** Call when wizard is resumed from previous session */
  onWizardResume: (resumeSource: WizardResumedPayload['resumeSource']) => void;
  /** Call when LLM provider is selected */
  onLLMProviderSelect: (provider: LLMProvider, previousProvider?: LLMProvider) => void;
  /** Call when LLM validation starts */
  onLLMValidationStart: (provider: LLMProvider) => void;
  /** Call when LLM validation succeeds */
  onLLMValidationSuccess: (provider: LLMProvider) => void;
  /** Call when LLM validation fails */
  onLLMValidationFailure: (provider: LLMProvider, errorType: LLMValidationPayload['errorType']) => void;
  /** Call when agent is selected */
  onAgentSelect: (
    agentId: string,
    agentName: string,
    difficulty: AgentSelectedPayload['difficulty'],
    wasRecommended: boolean
  ) => void;
  /** Call when template is selected */
  onTemplateSelect: (
    templateId: string,
    templateName: string,
    category: string,
    difficulty: TemplateSelectedPayload['difficulty'],
    wasFeatured: boolean
  ) => void;
  /** Call when mission is created */
  onMissionCreate: (missionId: string, templateId: string, usedCustomValues: boolean) => void;
  /** Call when help is opened */
  onHelpOpen: (openMethod: HelpOpenedPayload['openMethod'], searchQuery?: string) => void;
  /** Call when an error occurs */
  onError: (errorType: ErrorEncounteredPayload['errorType'], errorMessage: string, recovered?: boolean) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * useWizardAnalytics Hook
 *
 * Provides analytics instrumentation for the onboarding wizard.
 * Automatically tracks timing and integrates with onboarding store.
 */
export function useWizardAnalytics(context: WizardAnalyticsContext): UseWizardAnalyticsReturn {
  const { userId, tenantId } = context;

  // Get current state from store
  const {
    currentStepId,
    completedSteps,
    llmConfig,
    selectedAgentId,
    createdMissionId,
  } = useOnboardingStore();
  const currentStep = WIZARD_STEPS.findIndex((s) => s.id === currentStepId);

  // Track validation start time for duration calculation
  const validationStartRef = React.useRef<number | null>(null);
  const missionCreationStartRef = React.useRef<number | null>(null);

  // Get current step ID
  const getCurrentStepId = React.useCallback((): WizardStepId => {
    return currentStepId || 'welcome';
  }, [currentStepId]);

  // =========================================================================
  // Event Handlers
  // =========================================================================

  const onWizardStart = React.useCallback(
    (isResume: boolean, entrySource: WizardStartedPayload['entrySource']) => {
      timingTracker.startWizard();
      trackWizardStarted(userId, tenantId, {
        isResume,
        resumeFromStep: isResume ? currentStep : undefined,
        entrySource,
      });
    },
    [userId, tenantId, currentStep]
  );

  const onStepView = React.useCallback(
    (stepId: WizardStepId) => {
      timingTracker.startStep(stepId);
      const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === stepId);
      trackStepViewed(
        userId,
        tenantId,
        stepId,
        stepIndex,
        WIZARD_STEPS.length,
        timingTracker.getTimeFromStart()
      );
    },
    [userId, tenantId]
  );

  const onStepComplete = React.useCallback(
    (stepId: WizardStepId, stepData?: Record<string, unknown>) => {
      const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === stepId);
      const timeOnStep = timingTracker.getStepDuration(stepId);
      trackStepCompleted(userId, tenantId, stepId, stepIndex, timeOnStep, 'full', stepData);
    },
    [userId, tenantId]
  );

  const onStepSkip = React.useCallback(
    (stepId: WizardStepId, reason?: string) => {
      const stepIndex = WIZARD_STEPS.findIndex((s) => s.id === stepId);
      trackStepSkipped(userId, tenantId, stepId, stepIndex, reason);
    },
    [userId, tenantId]
  );

  const onWizardComplete = React.useCallback(() => {
    const totalDuration = timingTracker.getWizardDuration();
    const skippedSteps = WIZARD_STEPS.filter((s) => !completedSteps.includes(s.id)).map(
      (s) => s.id
    );

    trackWizardCompleted(userId, tenantId, totalDuration, completedSteps.length, skippedSteps, {
      llmProvider: llmConfig?.provider ?? null,
      agentId: selectedAgentId ?? null,
      missionCreated: !!createdMissionId,
    });

    timingTracker.reset();
  }, [userId, tenantId, completedSteps, llmConfig, selectedAgentId, createdMissionId]);

  const onWizardSkip = React.useCallback(
    (reason?: string) => {
      const currentStepId = getCurrentStepId();
      trackWizardSkipped(
        userId,
        tenantId,
        currentStepId,
        currentStep,
        completedSteps,
        reason as any
      );
      timingTracker.reset();
    },
    [userId, tenantId, currentStep, completedSteps, getCurrentStepId]
  );

  const onWizardResume = React.useCallback(
    (resumeSource: WizardResumedPayload['resumeSource']) => {
      const timeSinceLastActivity = 0;

      trackWizardResumed(
        userId,
        tenantId,
        timeSinceLastActivity,
        getCurrentStepId(),
        completedSteps,
        resumeSource
      );

      // Continue timing from where we left off
      timingTracker.startWizard();
    },
    [userId, tenantId, completedSteps, getCurrentStepId]
  );

  const onLLMProviderSelect = React.useCallback(
    (provider: LLMProvider, previousProvider?: LLMProvider) => {
      trackLLMProviderSelected(userId, tenantId, provider, previousProvider);
    },
    [userId, tenantId]
  );

  const onLLMValidationStart = React.useCallback(
    (provider: LLMProvider) => {
      validationStartRef.current = Date.now();
      trackLLMValidationAttempted(userId, tenantId, provider);
    },
    [userId, tenantId]
  );

  const onLLMValidationSuccess = React.useCallback(
    (provider: LLMProvider) => {
      const duration = validationStartRef.current
        ? Date.now() - validationStartRef.current
        : 0;
      trackLLMValidationSucceeded(userId, tenantId, provider, duration);
      validationStartRef.current = null;
    },
    [userId, tenantId]
  );

  const onLLMValidationFailure = React.useCallback(
    (provider: LLMProvider, errorType: LLMValidationPayload['errorType']) => {
      const duration = validationStartRef.current
        ? Date.now() - validationStartRef.current
        : 0;
      trackLLMValidationFailed(userId, tenantId, provider, errorType, duration);
      validationStartRef.current = null;
    },
    [userId, tenantId]
  );

  const onAgentSelect = React.useCallback(
    (
      agentId: string,
      agentName: string,
      difficulty: AgentSelectedPayload['difficulty'],
      wasRecommended: boolean
    ) => {
      trackAgentSelected(userId, tenantId, agentId, agentName, difficulty, wasRecommended);
    },
    [userId, tenantId]
  );

  const onTemplateSelect = React.useCallback(
    (
      templateId: string,
      templateName: string,
      category: string,
      difficulty: TemplateSelectedPayload['difficulty'],
      wasFeatured: boolean
    ) => {
      missionCreationStartRef.current = Date.now();
      trackTemplateSelected(
        userId,
        tenantId,
        templateId,
        templateName,
        category,
        difficulty,
        wasFeatured
      );
    },
    [userId, tenantId]
  );

  const onMissionCreate = React.useCallback(
    (missionId: string, templateId: string, usedCustomValues: boolean) => {
      const creationDuration = missionCreationStartRef.current
        ? Date.now() - missionCreationStartRef.current
        : 0;
      trackMissionCreated(
        userId,
        tenantId,
        missionId,
        templateId,
        usedCustomValues,
        creationDuration
      );
      missionCreationStartRef.current = null;
    },
    [userId, tenantId]
  );

  const onHelpOpen = React.useCallback(
    (openMethod: HelpOpenedPayload['openMethod'], searchQuery?: string) => {
      trackHelpOpened(userId, tenantId, openMethod, getCurrentStepId(), searchQuery);
    },
    [userId, tenantId, getCurrentStepId]
  );

  const onError = React.useCallback(
    (
      errorType: ErrorEncounteredPayload['errorType'],
      errorMessage: string,
      recovered?: boolean
    ) => {
      trackErrorEncountered(
        userId,
        tenantId,
        getCurrentStepId(),
        errorType,
        errorMessage,
        recovered
      );
    },
    [userId, tenantId, getCurrentStepId]
  );

  return {
    onWizardStart,
    onStepView,
    onStepComplete,
    onStepSkip,
    onWizardComplete,
    onWizardSkip,
    onWizardResume,
    onLLMProviderSelect,
    onLLMValidationStart,
    onLLMValidationSuccess,
    onLLMValidationFailure,
    onAgentSelect,
    onTemplateSelect,
    onMissionCreate,
    onHelpOpen,
    onError,
  };
}

// ============================================================================
// Auto-Instrumentation Hook
// ============================================================================

/**
 * useWizardAutoInstrumentation Hook
 *
 * Automatically tracks step views and handles common analytics scenarios.
 * Use this in the WizardShell component for automatic instrumentation.
 */
export function useWizardAutoInstrumentation(context: WizardAnalyticsContext): void {
  const { currentStepId, completedSteps, wizardInProgress } = useOnboardingStore();
  const currentStep = WIZARD_STEPS.findIndex((s) => s.id === currentStepId);
  const analytics = useWizardAnalytics(context);
  const previousStepRef = React.useRef<number | null>(null);
  const hasStartedRef = React.useRef(false);

  // Track wizard start
  React.useEffect(() => {
    if (wizardInProgress && !hasStartedRef.current) {
      hasStartedRef.current = true;
      const isResume = completedSteps.length > 0;
      analytics.onWizardStart(isResume, isResume ? 'banner' : 'redirect');
    }
  }, [wizardInProgress, completedSteps.length, analytics]);

  // Track step views
  React.useEffect(() => {
    if (wizardInProgress && previousStepRef.current !== currentStep) {
      const stepId = WIZARD_STEPS[currentStep]?.id;
      if (stepId) {
        // Complete previous step if moving forward
        if (previousStepRef.current !== null && currentStep > previousStepRef.current) {
          const prevStepId = WIZARD_STEPS[previousStepRef.current]?.id;
          if (prevStepId) {
            analytics.onStepComplete(prevStepId);
          }
        }

        // View new step
        analytics.onStepView(stepId);
        previousStepRef.current = currentStep;
      }
    }
  }, [wizardInProgress, currentStep, analytics]);

  // Track abandonment on unmount
  React.useEffect(() => {
    return () => {
      if (wizardInProgress && hasStartedRef.current) {
        // Component unmounting while wizard in progress = potential abandonment
        // Note: This doesn't actually fire the event here since we'd need to
        // detect if user is navigating away vs completing. The actual abandonment
        // tracking happens via page visibility API or session timeout.
      }
    };
  }, [wizardInProgress]);
}

// ============================================================================
// Page Visibility Abandonment Tracking
// ============================================================================

/**
 * useAbandonmentTracking Hook
 *
 * Tracks wizard abandonment using page visibility and beforeunload events.
 */
export function useAbandonmentTracking(context: WizardAnalyticsContext): void {
  const { currentStepId, completedSteps, wizardInProgress } = useOnboardingStore();
  const currentStep = WIZARD_STEPS.findIndex((s) => s.id === currentStepId);
  const analytics = useWizardAnalytics(context);
  const lastActiveRef = React.useRef<number>(Date.now());

  // Update last active time on any interaction
  React.useEffect(() => {
    const updateLastActive = () => {
      lastActiveRef.current = Date.now();
    };

    window.addEventListener('click', updateLastActive);
    window.addEventListener('keydown', updateLastActive);
    window.addEventListener('scroll', updateLastActive);

    return () => {
      window.removeEventListener('click', updateLastActive);
      window.removeEventListener('keydown', updateLastActive);
      window.removeEventListener('scroll', updateLastActive);
    };
  }, []);

  // Track page hide (tab switch, minimize, close)
  React.useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && wizardInProgress) {
        // User switched away from tab while in wizard
        // We'll track this as a potential abandonment point
        const inactivityDuration = Date.now() - lastActiveRef.current;

        // Store abandonment data in sessionStorage for potential resume tracking
        sessionStorage.setItem(
          'gibson:onboarding:abandonment',
          JSON.stringify({
            step: WIZARD_STEPS[currentStep]?.id,
            stepIndex: currentStep,
            completedSteps,
            timestamp: Date.now(),
            inactivityDuration,
          })
        );
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [wizardInProgress, currentStep, completedSteps]);

  // Check for abandonment data on mount (for analytics on return)
  React.useEffect(() => {
    const abandonmentData = sessionStorage.getItem('gibson:onboarding:abandonment');
    if (abandonmentData) {
      try {
        const data = JSON.parse(abandonmentData);
        const timeSinceAbandonment = Date.now() - data.timestamp;

        // If user returns within 30 minutes, it's a resume, not abandonment
        if (timeSinceAbandonment < 30 * 60 * 1000) {
          analytics.onWizardResume('direct_navigation');
        }

        // Clear the abandonment data
        sessionStorage.removeItem('gibson:onboarding:abandonment');
      } catch {
        // Abandonment data parse error — skip resumption analytics
      }
    }
  }, [analytics]);
}

// ============================================================================
// Export
// ============================================================================

export default useWizardAnalytics;
