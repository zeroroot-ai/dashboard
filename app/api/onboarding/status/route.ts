import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { getJSON, setJSON, delKey } from '@/src/lib/redis-store';
import type {
  OnboardingState,
  OnboardingStatusResponse,
  UpdateOnboardingStateRequest,
  SetupProgress,
  SetupTask,
  WizardStepId,
  SetupTaskStatus,
} from '@/src/types/onboarding';
import { DEFAULT_SETUP_TASKS, ONBOARDING_STATE_VERSION } from '@/src/types/onboarding';

// ============================================================================
// Redis-backed state store (key: onboarding:{userId}, TTL 90 days)
// ============================================================================

/** TTL for onboarding state in seconds (90 days). */
const ONBOARDING_TTL_SECONDS = 7_776_000;

/**
 * Create default onboarding state for a new user.
 */
function createDefaultState(userId: string, tenantId: string): OnboardingState {
  const now = new Date().toISOString();
  return {
    userId,
    tenantId,
    wizardCompleted: false,
    wizardSkipped: false,
    currentStepId: 'welcome',
    completedSteps: [],
    skippedSteps: [],
    llmConfig: undefined,
    selectedAgentId: undefined,
    createdMissionId: undefined,
    setupTasks: [...DEFAULT_SETUP_TASKS],
    startedAt: now,
    version: ONBOARDING_STATE_VERSION,
    updatedAt: now,
  };
}

/**
 * Calculate setup progress from state.
 */
function calculateProgress(state: OnboardingState): SetupProgress {
  const tasks = state.setupTasks;

  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const skippedTasks = tasks.filter((t) => t.status === 'skipped').length;
  const totalTasks = tasks.length;

  const percentage = Math.round((completedTasks / totalTasks) * 100);

  const pendingTasks = tasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'skipped'
  );
  const estimatedMinutesRemaining = pendingTasks.reduce(
    (sum, t) => sum + t.estimatedMinutes,
    0
  );

  // Group by category
  const essential = tasks.filter((t) => t.category === 'essential');
  const recommended = tasks.filter((t) => t.category === 'recommended');
  const optional = tasks.filter((t) => t.category === 'optional');

  return {
    percentage,
    totalTasks,
    completedTasks,
    skippedTasks,
    estimatedMinutesRemaining,
    byCategory: {
      essential: {
        total: essential.length,
        completed: essential.filter((t) => t.status === 'completed').length,
      },
      recommended: {
        total: recommended.length,
        completed: recommended.filter((t) => t.status === 'completed').length,
      },
      optional: {
        total: optional.length,
        completed: optional.filter((t) => t.status === 'completed').length,
      },
    },
  };
}

/**
 * Determine if onboarding wizard should be shown.
 */
function shouldShowOnboarding(state: OnboardingState): boolean {
  return !state.wizardCompleted && !state.wizardSkipped;
}

/**
 * Determine if setup widget should be shown.
 */
function shouldShowSetupWidget(state: OnboardingState): boolean {
  // Show widget if wizard is done but essential tasks remain
  if (!state.wizardCompleted && !state.wizardSkipped) {
    return false; // Show wizard instead
  }

  const essentialTasks = state.setupTasks.filter((t) => t.category === 'essential');
  const allEssentialComplete = essentialTasks.every(
    (t) => t.status === 'completed' || t.status === 'skipped'
  );

  return !allEssentialComplete;
}

// ============================================================================
// GET /api/onboarding/status
// ============================================================================

/**
 * GET /api/onboarding/status
 *
 * Fetch the current onboarding state for the authenticated user.
 *
 * Returns:
 * - Current onboarding state
 * - Calculated setup progress
 * - Whether to show onboarding wizard or setup widget
 *
 * Requires authentication.
 */
export async function GET(request: NextRequest) {
  try {
    // Validate authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    const userId = session.user?.id;
    const tenantId = session.user?.tenantId || 'default';

    if (!userId) {
      return NextResponse.json(
        { error: { code: 'INVALID_SESSION', message: 'User ID not found in session' } },
        { status: 400 }
      );
    }

    // Pending: replace with daemon RPC call once GetOnboardingState is available.
    // gibsonClient.getOnboardingState({ userId, tenantId }) will supersede this block.
    let state = await getJSON<OnboardingState>(`onboarding:${userId}`);

    if (!state) {
      // New user — create default state and persist to Redis
      state = createDefaultState(userId, tenantId);
      await setJSON(`onboarding:${userId}`, state, ONBOARDING_TTL_SECONDS);
    }

    // Calculate progress
    const progress = calculateProgress(state);

    // Build response
    const response: OnboardingStatusResponse = {
      state,
      progress,
      shouldShowOnboarding: shouldShowOnboarding(state),
      shouldShowSetupWidget: shouldShowSetupWidget(state),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching onboarding status:', error);
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch onboarding status',
        },
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/onboarding/status
// ============================================================================

/**
 * POST /api/onboarding/status
 *
 * Update the onboarding state for the authenticated user.
 *
 * Request body: UpdateOnboardingStateRequest
 *
 * Requires authentication. User can only update their own state.
 */
export async function POST(request: NextRequest) {
  try {
    // Validate authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    const userId = session.user?.id;
    const tenantId = session.user?.tenantId || 'default';

    if (!userId) {
      return NextResponse.json(
        { error: { code: 'INVALID_SESSION', message: 'User ID not found in session' } },
        { status: 400 }
      );
    }

    // Parse request body
    const body: UpdateOnboardingStateRequest = await request.json();

    // Pending: replace with daemon RPC call once GetOnboardingState is available.
    let state = await getJSON<OnboardingState>(`onboarding:${userId}`);
    if (!state) {
      state = createDefaultState(userId, tenantId);
    }

    const now = new Date().toISOString();

    // Apply updates based on request
    if (body.completedStep) {
      // Mark step as completed
      if (!state.completedSteps.includes(body.completedStep)) {
        state.completedSteps = [...state.completedSteps, body.completedStep];
      }
      // Remove from skipped if it was there
      state.skippedSteps = state.skippedSteps.filter((s) => s !== body.completedStep);
    }

    if (body.skippedStep) {
      // Mark step as skipped
      if (!state.skippedSteps.includes(body.skippedStep)) {
        state.skippedSteps = [...state.skippedSteps, body.skippedStep];
      }
    }

    if (body.navigateToStep) {
      state.currentStepId = body.navigateToStep;
    }

    if (body.llmConfig) {
      state.llmConfig = {
        ...state.llmConfig,
        ...body.llmConfig,
      } as OnboardingState['llmConfig'];

      // Update setup task if LLM configured
      if (body.llmConfig.isValidated) {
        state.setupTasks = state.setupTasks.map((task) =>
          task.id === 'configure_llm'
            ? { ...task, status: 'completed' as SetupTaskStatus, completedAt: now }
            : task
        );
      }
    }

    if (body.selectedAgentId) {
      state.selectedAgentId = body.selectedAgentId;

      // Update setup task
      state.setupTasks = state.setupTasks.map((task) =>
        task.id === 'select_agent'
          ? { ...task, status: 'completed' as SetupTaskStatus, completedAt: now }
          : task
      );
    }

    if (body.createdMissionId) {
      state.createdMissionId = body.createdMissionId;

      // Update setup task
      state.setupTasks = state.setupTasks.map((task) =>
        task.id === 'create_mission'
          ? { ...task, status: 'completed' as SetupTaskStatus, completedAt: now }
          : task
      );
    }

    if (body.setupTaskUpdate) {
      const { taskId, status } = body.setupTaskUpdate;
      state.setupTasks = state.setupTasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status,
              completedAt: status === 'completed' ? now : task.completedAt,
            }
          : task
      );
    }

    if (body.completeWizard) {
      state.wizardCompleted = true;
      state.completedAt = now;

      // Ensure completion step is marked
      if (!state.completedSteps.includes('completion')) {
        state.completedSteps = [...state.completedSteps, 'completion'];
      }
    }

    if (body.skipWizard) {
      state.wizardSkipped = true;
      state.completedAt = now;
    }

    // Update timestamp and version
    state.updatedAt = now;

    // Pending: replace with daemon RPC call once UpdateOnboardingState is available.
    // gibsonClient.updateOnboardingState({ userId, tenantId, stateJson: JSON.stringify(state) })
    await setJSON(`onboarding:${userId}`, state, ONBOARDING_TTL_SECONDS);

    // Calculate progress
    const progress = calculateProgress(state);

    // Build response
    const response: OnboardingStatusResponse = {
      state,
      progress,
      shouldShowOnboarding: shouldShowOnboarding(state),
      shouldShowSetupWidget: shouldShowSetupWidget(state),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error updating onboarding status:', error);

    // Check for JSON parse error
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: { code: 'INVALID_REQUEST', message: 'Invalid JSON in request body' } },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to update onboarding status',
        },
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// DELETE /api/onboarding/status
// ============================================================================

/**
 * DELETE /api/onboarding/status
 *
 * Reset onboarding state for the authenticated user.
 * This is mainly for testing/development purposes.
 *
 * Requires authentication.
 */
export async function DELETE(request: NextRequest) {
  try {
    // Validate authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    const userId = session.user?.id;
    const tenantId = session.user?.tenantId || 'default';

    if (!userId) {
      return NextResponse.json(
        { error: { code: 'INVALID_SESSION', message: 'User ID not found in session' } },
        { status: 400 }
      );
    }

    // Pending: replace with daemon RPC UpdateOnboardingState once available.
    // Reset is modelled as writing a fresh default state so the store always has a valid record.
    const state = createDefaultState(userId, tenantId);
    await setJSON(`onboarding:${userId}`, state, ONBOARDING_TTL_SECONDS);

    const progress = calculateProgress(state);

    const response: OnboardingStatusResponse = {
      state,
      progress,
      shouldShowOnboarding: true,
      shouldShowSetupWidget: false,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error resetting onboarding status:', error);
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to reset onboarding status',
        },
      },
      { status: 500 }
    );
  }
}
