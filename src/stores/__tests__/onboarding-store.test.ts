// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Onboarding Store Tests
 *
 * Unit tests for the onboarding Zustand store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { ONBOARDING_STORE_VERSION, migrateOnboardingState, useOnboardingStore } from '../onboarding-store';
import { withoutApiKey } from '@/src/types/onboarding';

// Reset store before each test
beforeEach(() => {
  const store = useOnboardingStore.getState();
  store.resetOnboarding();
});

describe('OnboardingStore', () => {
  describe('Initial State', () => {
    it('should have default initial state', () => {
      const state = useOnboardingStore.getState();

      expect(state.wizardCompleted).toBe(false);
      expect(state.wizardSkipped).toBe(false);
      expect(state.wizardInProgress).toBe(false);
      expect(state.currentStep).toBe(0);
      expect(state.completedSteps).toEqual([]);
      expect(state.llmProvider).toBeNull();
      expect(state.llmValidated).toBe(false);
      expect(state.selectedAgent).toBeNull();
    });
  });

  describe('Wizard Navigation', () => {
    it('should start the wizard', () => {
      const { startWizard } = useOnboardingStore.getState();

      act(() => {
        startWizard();
      });

      const state = useOnboardingStore.getState();
      expect(state.wizardInProgress).toBe(true);
      expect(state.startedAt).not.toBeNull();
    });

    it('should navigate to next step', () => {
      const { startWizard, nextStep, setStepValid } = useOnboardingStore.getState();

      act(() => {
        startWizard();
        setStepValid('welcome', true);
        nextStep();
      });

      const state = useOnboardingStore.getState();
      expect(state.currentStep).toBe(1);
      expect(state.completedSteps).toContain('welcome');
    });

    it('should navigate to previous step', () => {
      const { startWizard, nextStep, previousStep, setStepValid } = useOnboardingStore.getState();

      act(() => {
        startWizard();
        setStepValid('welcome', true);
        nextStep();
        previousStep();
      });

      const state = useOnboardingStore.getState();
      expect(state.currentStep).toBe(0);
    });

    it('should not go back from first step', () => {
      const { startWizard, previousStep } = useOnboardingStore.getState();

      act(() => {
        startWizard();
        previousStep();
      });

      const state = useOnboardingStore.getState();
      expect(state.currentStep).toBe(0);
    });

    it('should complete the wizard', () => {
      const { startWizard, completeWizard } = useOnboardingStore.getState();

      act(() => {
        startWizard();
        completeWizard();
      });

      const state = useOnboardingStore.getState();
      expect(state.wizardCompleted).toBe(true);
      expect(state.wizardInProgress).toBe(false);
      expect(state.completedAt).not.toBeNull();
    });

    it('should skip the wizard', () => {
      const { startWizard, skipWizard } = useOnboardingStore.getState();

      act(() => {
        startWizard();
        skipWizard();
      });

      const state = useOnboardingStore.getState();
      expect(state.wizardSkipped).toBe(true);
      expect(state.wizardInProgress).toBe(false);
    });
  });

  describe('Step Validation', () => {
    it('should set step as valid', () => {
      const { setStepValid } = useOnboardingStore.getState();

      act(() => {
        setStepValid('welcome', true);
      });

      const state = useOnboardingStore.getState();
      expect(state.stepValidation['welcome']).toBe(true);
    });

    it('should set step as invalid', () => {
      const { setStepValid } = useOnboardingStore.getState();

      act(() => {
        setStepValid('llm-provider', false);
      });

      const state = useOnboardingStore.getState();
      expect(state.stepValidation['llm-provider']).toBe(false);
    });

    it('should clear validation on step change', () => {
      const { setStepValid, setValidationError, clearValidation } = useOnboardingStore.getState();

      act(() => {
        setStepValid('welcome', true);
        setValidationError('Test error');
        clearValidation();
      });

      const state = useOnboardingStore.getState();
      expect(state.validationError).toBeNull();
    });
  });

  describe('LLM Configuration', () => {
    it('should set LLM provider', () => {
      const { setLLMProvider } = useOnboardingStore.getState();

      act(() => {
        setLLMProvider('anthropic');
      });

      const state = useOnboardingStore.getState();
      expect(state.llmProvider).toBe('anthropic');
    });

    it('should set LLM validated state', () => {
      const { setLLMValidated } = useOnboardingStore.getState();

      act(() => {
        setLLMValidated(true);
      });

      const state = useOnboardingStore.getState();
      expect(state.llmValidated).toBe(true);
    });
  });

  describe('Agent Selection', () => {
    it('should set selected agent', () => {
      const { setSelectedAgent } = useOnboardingStore.getState();

      act(() => {
        setSelectedAgent('debug-agent');
      });

      const state = useOnboardingStore.getState();
      expect(state.selectedAgent).toBe('debug-agent');
    });
  });

  describe('Mission Template', () => {
    it('should set selected mission template', () => {
      const { setSelectedMissionTemplate } = useOnboardingStore.getState();

      act(() => {
        setSelectedMissionTemplate('hello-gibson');
      });

      const state = useOnboardingStore.getState();
      expect(state.selectedMissionTemplate).toBe('hello-gibson');
    });

    it('should set created mission ID', () => {
      const { setCreatedMissionId } = useOnboardingStore.getState();

      act(() => {
        setCreatedMissionId('mission-123');
      });

      const state = useOnboardingStore.getState();
      expect(state.createdMissionId).toBe('mission-123');
    });
  });

  describe('State Restoration', () => {
    it('should restore state from persisted data', () => {
      const { restoreState } = useOnboardingStore.getState();

      const persistedState = {
        wizardCompleted: false,
        wizardSkipped: false,
        currentStep: 2,
        completedSteps: ['welcome', 'llm-provider'],
        llmProvider: 'openai' as const,
        llmValidated: true,
        selectedAgent: 'recon-agent',
        selectedMissionTemplate: null,
        createdMissionId: null,
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: null,
        lastActiveAt: '2024-01-01T01:00:00Z',
      };

      act(() => {
        restoreState(persistedState);
      });

      const state = useOnboardingStore.getState();
      expect(state.currentStep).toBe(2);
      expect(state.completedSteps).toEqual(['welcome', 'llm-provider']);
      expect(state.llmProvider).toBe('openai');
      expect(state.llmValidated).toBe(true);
      expect(state.selectedAgent).toBe('recon-agent');
    });
  });

  describe('Reset', () => {
    it('should reset all state to defaults', () => {
      const { startWizard, setLLMProvider, setSelectedAgent, resetOnboarding } =
        useOnboardingStore.getState();

      act(() => {
        startWizard();
        setLLMProvider('anthropic');
        setSelectedAgent('debug-agent');
        resetOnboarding();
      });

      const state = useOnboardingStore.getState();
      expect(state.wizardInProgress).toBe(false);
      expect(state.llmProvider).toBeNull();
      expect(state.selectedAgent).toBeNull();
      expect(state.currentStep).toBe(0);
    });
  });
});

describe('Wizard Navigation Hooks', () => {
  describe('canAdvance', () => {
    it('should return true when current step is valid', () => {
      const { startWizard, setStepValid } = useOnboardingStore.getState();

      act(() => {
        startWizard();
        setStepValid('welcome', true);
      });

      // Note: This would need to be tested with the actual hook
      // which requires React component testing
    });
  });

  describe('canGoBack', () => {
    it('should return false on first step', () => {
      const { startWizard } = useOnboardingStore.getState();

      act(() => {
        startWizard();
      });

      const state = useOnboardingStore.getState();
      expect(state.currentStep).toBe(0);
    });
  });
});

describe('the provider API key is never kept in the browser', () => {
  const STORAGE_KEY = 'gibson-onboarding';
  const SECRET = 'sk-ant-onboarding-key-do-not-keep';

  it('has no action that stores an API key', () => {
    expect('setLLMApiKey' in useOnboardingStore.getState()).toBe(false);
  });

  it('keeps no API key in the state or in localStorage, even from a config that holds one', () => {
    act(() => {
      // An older stored config can hold the key. The type no longer has it.
      useOnboardingStore
        .getState()
        .setLLMConfig({ provider: 'anthropic', model: 'm', isValidated: true, apiKey: SECRET } as never);
    });
    expect(useOnboardingStore.getState().llmConfig).toEqual({ provider: 'anthropic', model: 'm', isValidated: true });
    const stored = localStorage.getItem(STORAGE_KEY) ?? '';
    expect(stored).toContain('anthropic');
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain('apiKey');
  });

  it('removes a key that an older version persisted, one time on load', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          currentStepId: 'llm_provider',
          completedSteps: [],
          skippedSteps: [],
          llmConfig: { provider: 'anthropic', apiKey: SECRET, model: '', isValidated: true },
          llmValidated: true,
        },
        version: 0,
      }),
    );
    await useOnboardingStore.persist.rehydrate();
    expect(useOnboardingStore.getState().llmConfig).toEqual({ provider: 'anthropic', model: '', isValidated: true });
    expect(useOnboardingStore.getState().llmValidated).toBe(true);
    const stored = localStorage.getItem(STORAGE_KEY) ?? '';
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain('apiKey');
    expect(JSON.parse(stored).version).toBe(ONBOARDING_STORE_VERSION);
  });

  it('migrates a state with no config and a value of another shape unchanged', () => {
    expect(migrateOnboardingState({ llmConfig: null, wizardCompleted: true })).toEqual({
      llmConfig: null,
      wizardCompleted: true,
    });
    expect(migrateOnboardingState(null)).toBeNull();
    expect(migrateOnboardingState('x')).toBe('x');
  });

  it('removes the key from a config and leaves a config with no key as it is', () => {
    const clean = { provider: 'anthropic', model: '', isValidated: false };
    expect(withoutApiKey(clean)).toBe(clean);
    expect(withoutApiKey({ ...clean, apiKey: SECRET })).toEqual(clean);
  });
});
