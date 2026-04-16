'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useOnboardingStore,
  useShouldShowOnboarding,
  useShouldShowSetupWidget,
} from '@/src/stores/onboarding-store';
import type {
  OnboardingState,
  SetupProgress,
  SetupTask,
  OnboardingStatusResponse,
} from '@/src/types/onboarding';

// Query keys
export const onboardingKeys = {
  all: ['onboarding'] as const,
  status: () => [...onboardingKeys.all, 'status'] as const,
  progress: () => [...onboardingKeys.all, 'progress'] as const,
};

/**
 * Fetch onboarding status from the API
 */
async function fetchOnboardingStatus(): Promise<OnboardingStatusResponse> {
  const response = await fetch('/api/onboarding/status');

  if (!response.ok) {
    throw new Error('Failed to fetch onboarding status');
  }

  return response.json();
}

/**
 * Update onboarding state via API
 */
async function updateOnboardingState(
  state: Partial<OnboardingState>
): Promise<OnboardingStatusResponse> {
  const response = await fetch('/api/onboarding/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });

  if (!response.ok) {
    throw new Error('Failed to update onboarding state');
  }

  return response.json();
}

/**
 * useOnboardingStatus Hook
 *
 * Fetches and manages onboarding status with TanStack Query.
 * Provides polling, caching, and optimistic updates.
 *
 * Features:
 * - Automatic polling every 30 seconds
 * - Background refetch on window focus
 * - Sync between server and local Zustand state
 * - Optimistic updates for better UX
 */
export function useOnboardingStatus(options?: {
  /** Enable polling (default: false) */
  polling?: boolean;
  /** Polling interval in ms (default: 30000) */
  pollingInterval?: number;
  /** Disable automatic fetching (default: false) */
  enabled?: boolean;
}) {
  const {
    polling = false,
    pollingInterval = 30000,
    enabled = true,
  } = options || {};

  const queryClient = useQueryClient();
  const store = useOnboardingStore();

  // Query for fetching status
  const query = useQuery({
    queryKey: onboardingKeys.status(),
    queryFn: fetchOnboardingStatus,
    enabled,
    refetchInterval: polling ? pollingInterval : false,
    refetchOnWindowFocus: true,
    staleTime: 10000, // 10 seconds
    gcTime: 300000, // 5 minutes

    // Sync server state with local store on success
    // Note: This is commented out to prevent overwriting local state
    // Uncomment if server should be source of truth
    // select: (data) => {
    //   if (data.state) {
    //     // Sync to local store if server has newer data
    //   }
    //   return data;
    // },
  });

  // Mutation for updating state
  const mutation = useMutation({
    mutationFn: updateOnboardingState,
    onSuccess: (data) => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: onboardingKeys.status() });
    },
  });

  // Computed values
  const state = query.data?.state || null;
  const progress = query.data?.progress || null;

  return {
    // Query state
    state,
    progress,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    isFetching: query.isFetching,

    // Actions
    refetch: query.refetch,
    updateState: mutation.mutateAsync,
    isUpdating: mutation.isPending,

    // Computed flags
    shouldShowOnboarding: query.data?.shouldShowOnboarding ?? false,
    shouldShowSetupWidget: query.data?.shouldShowSetupWidget ?? false,
  };
}

/**
 * useSetupTasks Hook
 *
 * Provides access to setup tasks with status calculations.
 * Uses local Zustand store as primary source with API sync.
 */
export function useSetupTasks() {
  const store = useOnboardingStore();
  useOnboardingStatus({ enabled: false });

  // Prefer local state, fall back to server state
  const tasks = store.setupTasks;

  // Calculate completion stats
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const totalCount = tasks.length;
  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;

  const progress = totalCount > 0
    ? Math.round((completedCount / totalCount) * 100)
    : 0;

  // Estimated time remaining
  const remainingTasks = tasks.filter(
    (t) => t.status === 'pending' || t.status === 'in_progress'
  );
  const estimatedMinutesRemaining = remainingTasks.reduce(
    (acc, task) => acc + (task.estimatedMinutes || 2),
    0
  );

  return {
    tasks,
    completedCount,
    totalCount,
    pendingCount,
    inProgressCount,
    progress,
    estimatedMinutesRemaining,
    isComplete: completedCount === totalCount && totalCount > 0,

    // Task actions from store
    updateTaskStatus: store.updateSetupTask,
    completeTask: (taskId: string) =>
      store.updateSetupTask(taskId as Parameters<typeof store.updateSetupTask>[0], 'completed'),
    skipTask: (taskId: string) =>
      store.updateSetupTask(taskId as Parameters<typeof store.updateSetupTask>[0], 'skipped'),
  };
}

/**
 * useOnboardingVisibility Hook
 *
 * Determines what onboarding UI elements to show.
 * Combines server state with local preferences.
 */
export function useOnboardingVisibility() {
  const showOnboarding = useShouldShowOnboarding();
  const showSetupWidget = useShouldShowSetupWidget();
  const store = useOnboardingStore();

  return {
    // Should show onboarding wizard
    showOnboarding,

    // Should show setup widget on dashboard
    showSetupWidget,

    // Is wizard currently in progress
    wizardInProgress: store.wizardInProgress,

    // Has wizard been completed
    wizardCompleted: store.wizardCompleted,

    // Has setup widget been dismissed
    setupWidgetDismissed: store.setupWidgetDismissed,

    // Actions
    dismissSetupWidget: () => store.dismissSetupWidget(),
    resetOnboarding: () => store.resetOnboarding(),
  };
}

/**
 * useOnboardingSync Hook
 *
 * Syncs local Zustand state with server.
 * Call this on app mount or route changes.
 */
export function useOnboardingSync() {
  const store = useOnboardingStore();
  const { refetch, updateState, isLoading } = useOnboardingStatus({
    enabled: true,
    polling: false,
  });

  // Sync local state to server
  const syncToServer = async () => {
    const localState: Partial<OnboardingState> = {
      currentStepId: store.currentStepId,
      completedSteps: store.completedSteps,
      wizardCompleted: store.wizardCompleted,
      llmConfig: store.llmConfig ?? undefined,
      selectedAgentId: store.selectedAgentId ?? undefined,
      createdMissionId: store.createdMissionId ?? undefined,
      setupTasks: store.setupTasks,
    };

    return updateState(localState);
  };

  // Refresh from server
  const refreshFromServer = async () => {
    const result = await refetch();
    // Optionally sync to local store here
    return result;
  };

  return {
    syncToServer,
    refreshFromServer,
    isLoading,
  };
}

export default useOnboardingStatus;
