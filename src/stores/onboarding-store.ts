import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type {
  WizardStepId,
  LLMConfig,
  SetupTask,
  SetupTaskId,
  SetupTaskStatus,
} from '@/src/types/onboarding';
import { WIZARD_STEPS, DEFAULT_SETUP_TASKS } from '@/src/types/onboarding';

// ============================================================================
// Store State Interface
// ============================================================================

/**
 * Onboarding store state interface.
 *
 * This store manages:
 * - Wizard navigation and progress
 * - Step validation state
 * - LLM configuration during onboarding
 * - Setup task tracking
 * - Resumption state
 */
export interface OnboardingState {
  // ========================================
  // Wizard Navigation
  // ========================================

  /** Current wizard step ID */
  currentStepId: WizardStepId;
  /** Array of completed step IDs */
  completedSteps: WizardStepId[];
  /** Array of skipped step IDs */
  skippedSteps: WizardStepId[];
  /** Whether the wizard has been fully completed */
  wizardCompleted: boolean;
  /** Whether the wizard was skipped entirely */
  wizardSkipped: boolean;
  /** Whether wizard is currently in progress (active session) */
  wizardInProgress: boolean;

  // ========================================
  // Step Validation
  // ========================================

  /** Validation status for each step */
  stepValidation: Record<WizardStepId, boolean>;
  /** Whether current step is being validated */
  isValidating: boolean;
  /** Validation error message for current step */
  validationError: string | null;

  // ========================================
  // LLM Configuration
  // ========================================

  /** LLM configuration from the wizard */
  llmConfig: LLMConfig | null;
  /** Whether LLM has been validated successfully */
  llmValidated: boolean;

  // ========================================
  // Agent Selection
  // ========================================

  /** Selected agent ID */
  selectedAgentId: string | null;

  // ========================================
  // Mission Creation
  // ========================================

  /** ID of mission created during onboarding */
  createdMissionId: string | null;
  /** Template ID used for mission creation */
  usedTemplateId: string | null;
  /** Mission target (domain, IP, etc.) */
  missionTarget: string | null;
  /** Mission name */
  missionName: string | null;

  // ========================================
  // Setup Tasks
  // ========================================

  /** Current setup tasks status */
  setupTasks: SetupTask[];
  /** Whether setup widget is dismissed */
  setupWidgetDismissed: boolean;

  // ========================================
  // Timing
  // ========================================

  /** Timestamp when wizard was started */
  wizardStartedAt: string | null;
  /** Timestamp when wizard was completed */
  wizardCompletedAt: string | null;
  /** Time spent on each step (in ms) */
  stepTimes: Record<WizardStepId, number>;
  /** Timestamp when current step was started */
  currentStepStartedAt: string | null;

  // ========================================
  // Actions
  // ========================================

  // Navigation actions
  startWizard: () => void;
  nextStep: () => void;
  previousStep: () => void;
  goToStep: (stepId: WizardStepId) => void;
  completeWizard: () => void;
  skipWizard: () => void;
  skipCurrentStep: () => void;

  // Validation actions
  setStepValid: (stepId: WizardStepId, valid: boolean) => void;
  setValidating: (validating: boolean) => void;
  setValidationError: (error: string | null) => void;
  clearValidationError: () => void;

  // Configuration actions
  setLLMConfig: (config: LLMConfig) => void;
  setLLMProvider: (provider: LLMConfig['provider']) => void;
  setLLMApiKey: (apiKey: string) => void;
  setLLMBaseUrl: (baseUrl: string) => void;
  setLLMModel: (model: string) => void;
  setLLMValidated: (validated: boolean) => void;
  setSelectedAgentId: (agentId: string) => void;
  setCreatedMissionId: (missionId: string) => void;
  setUsedTemplateId: (templateId: string) => void;
  setMissionTarget: (target: string) => void;
  setMissionName: (name: string) => void;

  // Setup task actions
  updateSetupTask: (taskId: SetupTaskId, status: SetupTaskStatus) => void;
  dismissSetupWidget: () => void;
  showSetupWidget: () => void;

  // Reset action
  resetOnboarding: () => void;

  // Computed helpers
  canAdvance: () => boolean;
  canGoBack: () => boolean;
  getProgress: () => number;
  getCurrentStepIndex: () => number;
  isStepComplete: (stepId: WizardStepId) => boolean;

  // ========================================
  // Compatibility Aliases (test-friendly interface)
  // ========================================

  /** Current step index (0-based numeric alias for currentStepId) */
  currentStep: number;
  /** LLM provider string alias (from llmConfig.provider) */
  llmProvider: LLMConfig['provider'] | null;
  /** Selected agent alias for selectedAgentId */
  selectedAgent: string | null;
  /** Wizard started timestamp alias for wizardStartedAt */
  startedAt: string | null;
  /** Wizard completed timestamp alias for wizardCompletedAt */
  completedAt: string | null;
  /** Selected template alias for usedTemplateId */
  selectedMissionTemplate: string | null;

  // Alias actions
  /** Alias for clearValidationError */
  clearValidation: () => void;
  /** Alias for setSelectedAgentId */
  setSelectedAgent: (agentId: string | null) => void;
  /** Alias for setUsedTemplateId */
  setSelectedMissionTemplate: (templateId: string | null) => void;
  /** Restore persisted state */
  restoreState: (state: Partial<{
    wizardCompleted: boolean;
    wizardSkipped: boolean;
    currentStep: number;
    completedSteps: string[];
    llmProvider: string;
    llmValidated: boolean;
    selectedAgent: string | null;
    selectedMissionTemplate: string | null;
    createdMissionId: string | null;
    startedAt: string | null;
    completedAt: string | null;
    lastActiveAt: string | null;
  }>) => void;
}

// ============================================================================
// Step Order Helper
// ============================================================================

const STEP_ORDER: WizardStepId[] = [
  'welcome',
  'llm-provider',
  'agent-selection',
  'mission-creation',
  'completion',
];

function getStepIndex(stepId: WizardStepId): number {
  return STEP_ORDER.indexOf(stepId);
}

function getNextStepId(currentStepId: WizardStepId): WizardStepId | null {
  const currentIndex = getStepIndex(currentStepId);
  if (currentIndex < STEP_ORDER.length - 1) {
    return STEP_ORDER[currentIndex + 1];
  }
  return null;
}

function getPreviousStepId(currentStepId: WizardStepId): WizardStepId | null {
  const currentIndex = getStepIndex(currentStepId);
  if (currentIndex > 0) {
    return STEP_ORDER[currentIndex - 1];
  }
  return null;
}

// ============================================================================
// Initial State
// ============================================================================

const initialStepValidation: Record<WizardStepId, boolean> = {
  welcome: false,
  'llm-provider': false,
  'agent-selection': false,
  'mission-creation': false,
  completion: false,
};

const initialStepTimes: Record<WizardStepId, number> = {
  welcome: 0,
  'llm-provider': 0,
  'agent-selection': 0,
  'mission-creation': 0,
  completion: 0,
};

// ============================================================================
// Store Implementation
// ============================================================================

/**
 * Onboarding state store with localStorage persistence.
 *
 * Persisted fields:
 * - currentStepId
 * - completedSteps
 * - skippedSteps
 * - wizardCompleted
 * - wizardSkipped
 * - stepValidation
 * - llmConfig
 * - llmValidated
 * - selectedAgentId
 * - createdMissionId
 * - usedTemplateId
 * - setupTasks
 * - setupWidgetDismissed
 * - wizardStartedAt
 * - wizardCompletedAt
 * - stepTimes
 *
 * Non-persisted fields (reset on reload):
 * - isValidating
 * - validationError
 * - wizardInProgress
 * - currentStepStartedAt
 */
export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      // ========================================
      // Initial State
      // ========================================

      // Navigation
      currentStepId: 'welcome',
      completedSteps: [],
      skippedSteps: [],
      wizardCompleted: false,
      wizardSkipped: false,
      wizardInProgress: false,

      // Validation
      stepValidation: { ...initialStepValidation },
      isValidating: false,
      validationError: null,

      // LLM Configuration
      llmConfig: null,
      llmValidated: false,

      // Agent Selection
      selectedAgentId: null,

      // Mission Creation
      createdMissionId: null,
      usedTemplateId: null,
      missionTarget: null,
      missionName: null,

      // Setup Tasks
      setupTasks: [...DEFAULT_SETUP_TASKS],
      setupWidgetDismissed: false,

      // Timing
      wizardStartedAt: null,
      wizardCompletedAt: null,
      stepTimes: { ...initialStepTimes },
      currentStepStartedAt: null,

      // ========================================
      // Navigation Actions
      // ========================================

      startWizard: () => {
        const now = new Date().toISOString();
        set({
          wizardInProgress: true,
          wizardStartedAt: now,
          currentStepStartedAt: now,
          currentStepId: 'welcome',
        });
      },

      nextStep: () => {
        const state = get();
        const { currentStepId, completedSteps, stepTimes, currentStepStartedAt } = state;

        // Calculate time spent on current step
        const updatedStepTimes = { ...stepTimes };
        if (currentStepStartedAt) {
          const timeSpent = Date.now() - new Date(currentStepStartedAt).getTime();
          updatedStepTimes[currentStepId] = (stepTimes[currentStepId] || 0) + timeSpent;
        }

        // Mark current step as completed if not already
        const updatedCompletedSteps = completedSteps.includes(currentStepId)
          ? completedSteps
          : [...completedSteps, currentStepId];

        // Get next step
        const nextStepId = getNextStepId(currentStepId);
        if (nextStepId) {
          set({
            currentStepId: nextStepId,
            completedSteps: updatedCompletedSteps,
            stepTimes: updatedStepTimes,
            currentStepStartedAt: new Date().toISOString(),
            validationError: null,
          });
        }
      },

      previousStep: () => {
        const state = get();
        const previousStepId = getPreviousStepId(state.currentStepId);
        if (previousStepId) {
          set({
            currentStepId: previousStepId,
            currentStepStartedAt: new Date().toISOString(),
            validationError: null,
          });
        }
      },

      goToStep: (stepId: WizardStepId) => {
        set({
          currentStepId: stepId,
          currentStepStartedAt: new Date().toISOString(),
          validationError: null,
        });
      },

      completeWizard: () => {
        const state = get();
        const { currentStepId, completedSteps, stepTimes, currentStepStartedAt, setupTasks } = state;

        // Calculate final step time
        const updatedStepTimes = { ...stepTimes };
        if (currentStepStartedAt) {
          const timeSpent = Date.now() - new Date(currentStepStartedAt).getTime();
          updatedStepTimes[currentStepId] = (stepTimes[currentStepId] || 0) + timeSpent;
        }

        // Mark completion step as completed
        const updatedCompletedSteps: WizardStepId[] = completedSteps.includes('completion')
          ? completedSteps
          : [...completedSteps, 'completion' as WizardStepId];

        // Update setup tasks based on what was configured
        const updatedSetupTasks = setupTasks.map((task) => {
          if (task.id === 'configure_llm' && state.llmValidated) {
            return { ...task, status: 'completed' as SetupTaskStatus, completedAt: new Date().toISOString() };
          }
          if (task.id === 'select_agent' && state.selectedAgentId) {
            return { ...task, status: 'completed' as SetupTaskStatus, completedAt: new Date().toISOString() };
          }
          if (task.id === 'create_mission' && state.createdMissionId) {
            return { ...task, status: 'completed' as SetupTaskStatus, completedAt: new Date().toISOString() };
          }
          return task;
        });

        set({
          wizardCompleted: true,
          wizardInProgress: false,
          completedSteps: updatedCompletedSteps,
          stepTimes: updatedStepTimes,
          wizardCompletedAt: new Date().toISOString(),
          setupTasks: updatedSetupTasks,
        });
      },

      skipWizard: () => {
        set({
          wizardSkipped: true,
          wizardInProgress: false,
          wizardCompletedAt: new Date().toISOString(),
        });
      },

      skipCurrentStep: () => {
        const state = get();
        const { currentStepId, skippedSteps } = state;

        // Check if step is skippable
        const stepConfig = WIZARD_STEPS.find((s) => s.id === currentStepId);
        if (!stepConfig?.isSkippable) {
          return;
        }

        // Mark as skipped and advance
        const updatedSkippedSteps = skippedSteps.includes(currentStepId)
          ? skippedSteps
          : [...skippedSteps, currentStepId];

        const nextStepId = getNextStepId(currentStepId);
        if (nextStepId) {
          set({
            currentStepId: nextStepId,
            skippedSteps: updatedSkippedSteps,
            currentStepStartedAt: new Date().toISOString(),
            validationError: null,
          });
        }
      },

      // ========================================
      // Validation Actions
      // ========================================

      setStepValid: (stepId: WizardStepId, valid: boolean) => {
        set((state) => ({
          stepValidation: {
            ...state.stepValidation,
            [stepId]: valid,
          },
        }));
      },

      setValidating: (validating: boolean) => {
        set({ isValidating: validating });
      },

      setValidationError: (error: string | null) => {
        set({ validationError: error });
      },

      clearValidationError: () => {
        set({ validationError: null });
      },

      // ========================================
      // Configuration Actions
      // ========================================

      setLLMConfig: (config: LLMConfig) => {
        set({ llmConfig: config });
      },

      setLLMProvider: (provider: LLMConfig['provider']) => {
        set((state) => ({
          llmConfig: state.llmConfig
            ? { ...state.llmConfig, provider }
            : { provider, model: '', isValidated: false },
        }));
      },

      setLLMApiKey: (apiKey: string) => {
        set((state) => ({
          llmConfig: state.llmConfig
            ? { ...state.llmConfig, apiKey }
            : { provider: 'anthropic', apiKey, model: '', isValidated: false },
        }));
      },

      setLLMBaseUrl: (baseUrl: string) => {
        set((state) => ({
          llmConfig: state.llmConfig
            ? { ...state.llmConfig, baseUrl }
            : { provider: 'ollama', baseUrl, model: '', isValidated: false },
        }));
      },

      setLLMModel: (model: string) => {
        set((state) => ({
          llmConfig: state.llmConfig
            ? { ...state.llmConfig, model }
            : { provider: 'anthropic', model, isValidated: false },
        }));
      },

      setLLMValidated: (validated: boolean) => {
        set({ llmValidated: validated });
      },

      setSelectedAgentId: (agentId: string) => {
        set({ selectedAgentId: agentId });
      },

      setCreatedMissionId: (missionId: string) => {
        set({ createdMissionId: missionId });
      },

      setUsedTemplateId: (templateId: string) => {
        set({ usedTemplateId: templateId });
      },

      setMissionTarget: (target: string) => {
        set({ missionTarget: target });
      },

      setMissionName: (name: string) => {
        set({ missionName: name });
      },

      // ========================================
      // Setup Task Actions
      // ========================================

      updateSetupTask: (taskId: SetupTaskId, status: SetupTaskStatus) => {
        set((state) => ({
          setupTasks: state.setupTasks.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  status,
                  completedAt: status === 'completed' ? new Date().toISOString() : task.completedAt,
                }
              : task
          ),
        }));
      },

      dismissSetupWidget: () => {
        set({ setupWidgetDismissed: true });
      },

      showSetupWidget: () => {
        set({ setupWidgetDismissed: false });
      },

      // ========================================
      // Compatibility Alias Properties
      // ========================================

      get currentStep() {
        return getStepIndex(get().currentStepId);
      },

      get llmProvider() {
        return get().llmConfig?.provider ?? null;
      },

      get selectedAgent() {
        return get().selectedAgentId;
      },

      get startedAt() {
        return get().wizardStartedAt;
      },

      get completedAt() {
        return get().wizardCompletedAt;
      },

      get selectedMissionTemplate() {
        return get().usedTemplateId;
      },

      // ========================================
      // Compatibility Alias Actions
      // ========================================

      clearValidation: () => {
        set({ validationError: null });
      },

      setSelectedAgent: (agentId: string | null) => {
        set({ selectedAgentId: agentId });
      },

      setSelectedMissionTemplate: (templateId: string | null) => {
        set({ usedTemplateId: templateId });
      },

      restoreState: (persistedState) => {
        const updates: Partial<OnboardingState> = {};
        if (persistedState.wizardCompleted !== undefined) updates.wizardCompleted = persistedState.wizardCompleted;
        if (persistedState.wizardSkipped !== undefined) updates.wizardSkipped = persistedState.wizardSkipped;
        if (persistedState.completedSteps !== undefined) updates.completedSteps = persistedState.completedSteps as WizardStepId[];
        if (persistedState.llmValidated !== undefined) updates.llmValidated = persistedState.llmValidated;
        if (persistedState.startedAt !== undefined) updates.wizardStartedAt = persistedState.startedAt;
        if (persistedState.completedAt !== undefined) updates.wizardCompletedAt = persistedState.completedAt;
        if (persistedState.createdMissionId !== undefined) updates.createdMissionId = persistedState.createdMissionId;
        if (persistedState.selectedAgent !== undefined) updates.selectedAgentId = persistedState.selectedAgent;
        if (persistedState.selectedMissionTemplate !== undefined) updates.usedTemplateId = persistedState.selectedMissionTemplate;
        if (persistedState.currentStep !== undefined) {
          const stepId = STEP_ORDER[persistedState.currentStep] ?? 'welcome';
          updates.currentStepId = stepId;
        }
        if (persistedState.llmProvider !== undefined) {
          const currentConfig = get().llmConfig;
          updates.llmConfig = currentConfig
            ? { ...currentConfig, provider: persistedState.llmProvider as LLMConfig['provider'] }
            : { provider: persistedState.llmProvider as LLMConfig['provider'], model: '', isValidated: false };
        }
        set(updates);
      },

      // ========================================
      // Reset Action
      // ========================================

      resetOnboarding: () => {
        set({
          currentStepId: 'welcome',
          completedSteps: [],
          skippedSteps: [],
          wizardCompleted: false,
          wizardSkipped: false,
          wizardInProgress: false,
          stepValidation: { ...initialStepValidation },
          isValidating: false,
          validationError: null,
          llmConfig: null,
          llmValidated: false,
          selectedAgentId: null,
          createdMissionId: null,
          usedTemplateId: null,
          missionTarget: null,
          missionName: null,
          setupTasks: [...DEFAULT_SETUP_TASKS],
          setupWidgetDismissed: false,
          wizardStartedAt: null,
          wizardCompletedAt: null,
          stepTimes: { ...initialStepTimes },
          currentStepStartedAt: null,
        });
      },

      // ========================================
      // Computed Helpers
      // ========================================

      canAdvance: () => {
        const state = get();
        const { currentStepId, stepValidation, isValidating } = state;

        // Can't advance while validating
        if (isValidating) return false;

        // Welcome step doesn't require validation
        if (currentStepId === 'welcome') return true;

        // Completion step can always advance (to finish)
        if (currentStepId === 'completion') return true;

        // Check step validation
        return stepValidation[currentStepId] === true;
      },

      canGoBack: () => {
        const state = get();
        return getStepIndex(state.currentStepId) > 0;
      },

      getProgress: () => {
        const state = get();
        const { completedSteps, skippedSteps } = state;
        const totalSteps = STEP_ORDER.length;
        const handledSteps = new Set([...completedSteps, ...skippedSteps]).size;
        return Math.round((handledSteps / totalSteps) * 100);
      },

      getCurrentStepIndex: () => {
        const state = get();
        return getStepIndex(state.currentStepId);
      },

      isStepComplete: (stepId: WizardStepId) => {
        const state = get();
        return state.completedSteps.includes(stepId);
      },
    }),
    {
      name: 'gibson-onboarding',
      // Persist most fields for wizard resumption
      partialize: (state) => ({
        currentStepId: state.currentStepId,
        completedSteps: state.completedSteps,
        skippedSteps: state.skippedSteps,
        wizardCompleted: state.wizardCompleted,
        wizardSkipped: state.wizardSkipped,
        stepValidation: state.stepValidation,
        llmConfig: state.llmConfig,
        llmValidated: state.llmValidated,
        selectedAgentId: state.selectedAgentId,
        createdMissionId: state.createdMissionId,
        usedTemplateId: state.usedTemplateId,
        setupTasks: state.setupTasks,
        setupWidgetDismissed: state.setupWidgetDismissed,
        wizardStartedAt: state.wizardStartedAt,
        wizardCompletedAt: state.wizardCompletedAt,
        stepTimes: state.stepTimes,
      }),
    }
  )
);

// ============================================================================
// Convenience Hooks
// ============================================================================

/**
 * Hook for wizard navigation state and actions.
 */
export const useWizardNavigation = () =>
  useOnboardingStore(
    useShallow((state) => ({
      currentStepId: state.currentStepId,
      completedSteps: state.completedSteps,
      skippedSteps: state.skippedSteps,
      wizardCompleted: state.wizardCompleted,
      wizardSkipped: state.wizardSkipped,
      wizardInProgress: state.wizardInProgress,
      startWizard: state.startWizard,
      nextStep: state.nextStep,
      previousStep: state.previousStep,
      goToStep: state.goToStep,
      completeWizard: state.completeWizard,
      skipWizard: state.skipWizard,
      skipCurrentStep: state.skipCurrentStep,
      canAdvance: state.canAdvance,
      canGoBack: state.canGoBack,
      getProgress: state.getProgress,
      getCurrentStepIndex: state.getCurrentStepIndex,
      isStepComplete: state.isStepComplete,
    }))
  );

/**
 * Hook for wizard validation state.
 */
export const useWizardValidation = () =>
  useOnboardingStore(
    useShallow((state) => ({
      stepValidation: state.stepValidation,
      isValidating: state.isValidating,
      validationError: state.validationError,
      setStepValid: state.setStepValid,
      setValidating: state.setValidating,
      setValidationError: state.setValidationError,
      clearValidationError: state.clearValidationError,
    }))
  );

/**
 * Hook for LLM configuration during onboarding.
 */
export const useOnboardingLLMConfig = () =>
  useOnboardingStore(
    useShallow((state) => ({
      llmConfig: state.llmConfig,
      llmValidated: state.llmValidated,
      setLLMConfig: state.setLLMConfig,
      setLLMProvider: state.setLLMProvider,
      setLLMApiKey: state.setLLMApiKey,
      setLLMBaseUrl: state.setLLMBaseUrl,
      setLLMModel: state.setLLMModel,
      setLLMValidated: state.setLLMValidated,
    }))
  );

/**
 * Hook for agent selection during onboarding.
 */
export const useOnboardingAgentSelection = () =>
  useOnboardingStore(
    useShallow((state) => ({
      selectedAgentId: state.selectedAgentId,
      setSelectedAgentId: state.setSelectedAgentId,
    }))
  );

/**
 * Hook for mission creation during onboarding.
 */
export const useOnboardingMission = () =>
  useOnboardingStore(
    useShallow((state) => ({
      createdMissionId: state.createdMissionId,
      usedTemplateId: state.usedTemplateId,
      missionTarget: state.missionTarget,
      missionName: state.missionName,
      setCreatedMissionId: state.setCreatedMissionId,
      setUsedTemplateId: state.setUsedTemplateId,
      setMissionTarget: state.setMissionTarget,
      setMissionName: state.setMissionName,
      // Computed missionConfig for component compatibility
      missionConfig: {
        templateId: state.usedTemplateId,
        target: state.missionTarget || '',
        name: state.missionName || '',
      },
      setMissionTemplate: state.setUsedTemplateId,
    }))
  );

/**
 * Hook for setup task progress tracking.
 */
export const useSetupProgress = () => {
  const state = useOnboardingStore(
    useShallow((s) => ({
      setupTasks: s.setupTasks,
      setupWidgetDismissed: s.setupWidgetDismissed,
      updateSetupTask: s.updateSetupTask,
      dismissSetupWidget: s.dismissSetupWidget,
      showSetupWidget: s.showSetupWidget,
    }))
  );

  // Calculate progress
  const completedTasks = state.setupTasks.filter((t) => t.status === 'completed').length;
  const totalTasks = state.setupTasks.length;
  const progressPercentage = Math.round((completedTasks / totalTasks) * 100);

  // Calculate estimated time remaining
  const pendingTasks = state.setupTasks.filter((t) => t.status !== 'completed' && t.status !== 'skipped');
  const estimatedMinutesRemaining = pendingTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);

  return {
    ...state,
    completedTasks,
    totalTasks,
    progressPercentage,
    estimatedMinutesRemaining,
  };
};

/**
 * Hook to check if onboarding should be shown.
 */
export const useShouldShowOnboarding = () => {
  const wizardCompleted = useOnboardingStore((state) => state.wizardCompleted);
  const wizardSkipped = useOnboardingStore((state) => state.wizardSkipped);

  return !wizardCompleted && !wizardSkipped;
};

/**
 * Hook to check if setup widget should be shown.
 */
export const useShouldShowSetupWidget = () => {
  const wizardCompleted = useOnboardingStore((state) => state.wizardCompleted);
  const wizardSkipped = useOnboardingStore((state) => state.wizardSkipped);
  const setupWidgetDismissed = useOnboardingStore((state) => state.setupWidgetDismissed);
  const setupTasks = useOnboardingStore((state) => state.setupTasks);

  // Show widget if wizard completed/skipped but setup not fully complete
  const allTasksComplete = setupTasks.every(
    (t) => t.status === 'completed' || t.status === 'skipped'
  );

  return (wizardCompleted || wizardSkipped) && !allTasksComplete && !setupWidgetDismissed;
};
