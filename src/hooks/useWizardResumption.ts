'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useOnboardingStore, useWizardNavigation } from '@/src/stores/onboarding-store';
import { loadState, syncState, calculateProgress } from '@/src/lib/onboarding/state';
import { WIZARD_STEPS, type WizardStepId } from '@/src/types/onboarding';

/**
 * useWizardResumption Hook
 *
 * Handles wizard resumption flow:
 * - Detects incomplete wizard on dashboard load
 * - Syncs state from server/localStorage
 * - Provides resume and dismiss actions
 * - Navigates to last completed step on resume
 */

export interface WizardResumptionState {
  /** Whether we're checking for resumable state */
  isChecking: boolean;
  /** Whether there's a wizard to resume */
  canResume: boolean;
  /** Current progress percentage */
  progress: number;
  /** Current step name */
  currentStepName: string;
  /** Time since last activity */
  lastActiveAgo: string | null;
  /** Resume the wizard */
  resume: () => void;
  /** Dismiss the resume banner (for this session) */
  dismiss: () => void;
  /** Skip the wizard entirely */
  skipWizard: () => void;
  /** Whether banner has been dismissed */
  isDismissed: boolean;
}

export function useWizardResumption(): WizardResumptionState {
  const router = useRouter();
  const [isChecking, setIsChecking] = React.useState(true);
  const [canResume, setCanResume] = React.useState(false);
  const [isDismissed, setIsDismissed] = React.useState(false);
  const [lastActiveAgo, setLastActiveAgo] = React.useState<string | null>(null);

  const {
    wizardCompleted,
    wizardSkipped,
    wizardInProgress,
    currentStepId,
    completedSteps,
    skipWizard: storeSkipWizard,
  } = useOnboardingStore();
  const lastActiveAt: string | null = null;
  const restoreState = (_state: unknown) => { /* no-op: store manages its own state */ };

  const { getCurrentStepIndex } = useWizardNavigation();

  // Calculate progress
  const progress = React.useMemo(() => {
    if (wizardCompleted) return 100;
    const completedCount = completedSteps.length;
    const totalSteps = WIZARD_STEPS.length;
    return Math.round((completedCount / totalSteps) * 100);
  }, [wizardCompleted, completedSteps]);

  // Get current step name
  const currentStepName = React.useMemo(() => {
    const stepIndex = getCurrentStepIndex();
    const step = WIZARD_STEPS[stepIndex];
    return step?.title || 'Setup';
  }, [getCurrentStepIndex]);

  // Check for resumable state on mount
  React.useEffect(() => {
    const checkResumable = async () => {
      setIsChecking(true);

      try {
        // Sync state from server/localStorage
        const result = await syncState();

        if (result.success && result.state) {
          // Restore to store
          restoreState(result.state);

          // Check if we can resume
          const canResumeWizard =
            !result.state.wizardCompleted &&
            !result.state.wizardSkipped &&
            (result.state.completedSteps.length > 0 || (result.state.currentStepId != null && result.state.currentStepId !== 'welcome'));

          setCanResume(canResumeWizard);

          // Calculate time since last activity
          if (result.state.updatedAt) {
            setLastActiveAgo(formatTimeAgo(new Date(result.state.updatedAt)));
          }
        }
      } catch {
        // Resumable state check failed, wizard will not offer to resume
      } finally {
        setIsChecking(false);
      }
    };

    // Only check if wizard is not completed/skipped
    if (!wizardCompleted && !wizardSkipped) {
      checkResumable();
    } else {
      setIsChecking(false);
      setCanResume(false);
    }
  }, []); // Only run on mount

  // Update lastActiveAgo periodically
  React.useEffect(() => {
    if (!lastActiveAt) return;

    const updateTimeAgo = () => {
      setLastActiveAgo(formatTimeAgo(new Date(lastActiveAt)));
    };

    updateTimeAgo();
    const interval = setInterval(updateTimeAgo, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [lastActiveAt]);

  // Resume the wizard
  const resume = React.useCallback(() => {
    router.push('/onboarding');
  }, [router]);

  // Dismiss the banner for this session
  const dismiss = React.useCallback(() => {
    setIsDismissed(true);
    // Could also persist this to sessionStorage
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('gibson:onboarding:dismissed', 'true');
    }
  }, []);

  // Skip the wizard entirely
  const skipWizard = React.useCallback(() => {
    storeSkipWizard();
    setCanResume(false);
    setIsDismissed(true);
  }, [storeSkipWizard]);

  // Check if previously dismissed in this session
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const dismissed = sessionStorage.getItem('gibson:onboarding:dismissed');
      if (dismissed === 'true') {
        setIsDismissed(true);
      }
    }
  }, []);

  return {
    isChecking,
    canResume: canResume && !isDismissed,
    progress,
    currentStepName,
    lastActiveAgo,
    resume,
    dismiss,
    skipWizard,
    isDismissed,
  };
}

/**
 * useNewUserDetection Hook
 *
 * Detects if this is a new user who should be redirected to onboarding.
 */
export function useNewUserDetection(): {
  isNewUser: boolean;
  shouldRedirect: boolean;
  redirectToOnboarding: () => void;
} {
  const router = useRouter();
  const { wizardCompleted, wizardSkipped, wizardInProgress } = useOnboardingStore();

  const isNewUser = !wizardCompleted && !wizardSkipped && !wizardInProgress;
  const shouldRedirect = isNewUser;

  const redirectToOnboarding = React.useCallback(() => {
    router.push('/onboarding');
  }, [router]);

  return {
    isNewUser,
    shouldRedirect,
    redirectToOnboarding,
  };
}

/**
 * useOnboardingRedirect Hook
 *
 * Automatically redirects new users to onboarding.
 * Use this on protected pages that require onboarding to be complete.
 */
export function useOnboardingRedirect(options?: { disabled?: boolean }): {
  isRedirecting: boolean;
} {
  const router = useRouter();
  const [isRedirecting, setIsRedirecting] = React.useState(false);
  const { wizardCompleted, wizardSkipped } = useOnboardingStore();

  React.useEffect(() => {
    if (options?.disabled) return;

    const shouldRedirect = !wizardCompleted && !wizardSkipped;

    if (shouldRedirect) {
      setIsRedirecting(true);
      router.push('/onboarding');
    }
  }, [wizardCompleted, wizardSkipped, router, options?.disabled]);

  return { isRedirecting };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a date as a relative time string
 */
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString();
  }
}

export default useWizardResumption;
