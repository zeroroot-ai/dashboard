/**
 * GET/POST/DELETE /api/onboarding/status
 *
 * Proxies per-user onboarding state through the daemon's UserService RPCs
 * (GetUserOnboardingState / UpdateUserOnboardingState / ResetUserOnboardingState).
 * Tenant is resolved via requireActiveTenant(), fail-closed, no default fallback.
 *
 * Replaces the previous direct-Redis implementation.
 * Spec: dashboard-no-backing-store-clients (Module 5 / issue #589 + #579).
 */

import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client';
import { UserService } from '@/src/gen/gibson/tenant/v1/user_pb';
import { create } from '@bufbuild/protobuf';
import { UserOnboardingStateSchema } from '@/src/gen/gibson/tenant/v1/user_pb';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import type {
  OnboardingState,
  OnboardingStatusResponse,
  UpdateOnboardingStateRequest,
  SetupProgress,
  SetupTask,
  SetupTaskId,
  SetupTaskStatus,
  WizardStepId,
} from '@/src/types/onboarding';
import { DEFAULT_SETUP_TASKS } from '@/src/types/onboarding';

// ============================================================================
// Helpers, local-only presentation logic (no store access)
// ============================================================================

function calculateProgress(state: OnboardingState): SetupProgress {
  const tasks = state.setupTasks;
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const skippedTasks = tasks.filter((t) => t.status === 'skipped').length;
  const totalTasks = tasks.length;
  const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const pendingTasks = tasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'skipped',
  );
  const estimatedMinutesRemaining = pendingTasks.reduce((sum, t) => sum + t.estimatedMinutes, 0);
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
      essential: { total: essential.length, completed: essential.filter((t) => t.status === 'completed').length },
      recommended: { total: recommended.length, completed: recommended.filter((t) => t.status === 'completed').length },
      optional: { total: optional.length, completed: optional.filter((t) => t.status === 'completed').length },
    },
  };
}

function shouldShowOnboarding(state: OnboardingState): boolean {
  return !state.wizardCompleted && !state.wizardSkipped;
}

function shouldShowSetupWidget(state: OnboardingState): boolean {
  if (!state.wizardCompleted && !state.wizardSkipped) return false;
  const essentialTasks = state.setupTasks.filter((t) => t.category === 'essential');
  return !essentialTasks.every((t) => t.status === 'completed' || t.status === 'skipped');
}

// ============================================================================
// Conversion: daemon proto → local OnboardingState
// ============================================================================

import type { UserOnboardingState } from '@/src/gen/gibson/tenant/v1/user_pb';

/** Index of default task metadata by id for fast lookup during proto conversion. */
const DEFAULT_TASK_META: Map<string, SetupTask> = new Map(
  DEFAULT_SETUP_TASKS.map((t) => [t.id, t]),
);

function protoToState(proto: UserOnboardingState): OnboardingState {
  // Merge proto task data with default task metadata.
  // The proto stores only mutable fields (status, completedAt).
  // Static fields (title, description, actionUrl, order) come from DEFAULT_SETUP_TASKS.
  const setupTasks: SetupTask[] = proto.setupTasks.length > 0
    ? proto.setupTasks.map((t) => {
        const def = DEFAULT_TASK_META.get(t.id);
        if (!def) {
          // Unknown task id, should not happen in practice but handle gracefully.
          return {
            id: t.id as SetupTaskId,
            title: t.id,
            description: '',
            status: (t.status || 'pending') as SetupTaskStatus,
            category: (t.category || 'essential') as 'essential' | 'recommended' | 'optional',
            actionUrl: '',
            estimatedMinutes: t.estimatedMinutes,
            order: 999,
            completedAt: t.completedAt || undefined,
          };
        }
        return {
          ...def,
          status: (t.status || def.status) as SetupTaskStatus,
          category: (t.category || def.category) as 'essential' | 'recommended' | 'optional',
          estimatedMinutes: t.estimatedMinutes || def.estimatedMinutes,
          completedAt: t.completedAt || undefined,
        };
      })
    : [...DEFAULT_SETUP_TASKS];

  return {
    userId: proto.userId,
    tenantId: proto.tenantId,
    wizardCompleted: proto.wizardCompleted,
    wizardSkipped: proto.wizardSkipped,
    currentStepId: (proto.currentStepId || 'welcome') as WizardStepId,
    completedSteps: [...proto.completedSteps] as WizardStepId[],
    skippedSteps: [...proto.skippedSteps] as WizardStepId[],
    setupTasks,
    llmConfig: proto.llmConfigJson ? JSON.parse(proto.llmConfigJson) : undefined,
    selectedAgentId: proto.selectedAgentId || undefined,
    createdMissionId: proto.createdMissionId || undefined,
    startedAt: proto.startedAt || new Date().toISOString(),
    completedAt: proto.completedAt || undefined,
    updatedAt: proto.updatedAt || new Date().toISOString(),
    version: proto.version,
  };
}

// ============================================================================
// GET /api/onboarding/status
// ============================================================================

export async function GET(_request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 },
    );
  }
  if (!session.user?.id) {
    return NextResponse.json(
      { error: { code: 'INVALID_SESSION', message: 'User ID not found in session' } },
      { status: 400 },
    );
  }

  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  try {
    const resp = await userClient(UserService).getUserOnboardingState({
      tenantId,
      userId: session.user.id,
    });
    const state = protoToState(resp.state ?? create(UserOnboardingStateSchema));
    const progress = calculateProgress(state);
    const response: OnboardingStatusResponse = {
      state,
      progress,
      shouldShowOnboarding: shouldShowOnboarding(state),
      shouldShowSetupWidget: shouldShowSetupWidget(state),
    };
    return NextResponse.json(response);
  } catch (err) {
    return daemonErrorResponse(err);
  }
}

// ============================================================================
// POST /api/onboarding/status
// ============================================================================

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 },
    );
  }
  if (!session.user?.id) {
    return NextResponse.json(
      { error: { code: 'INVALID_SESSION', message: 'User ID not found in session' } },
      { status: 400 },
    );
  }

  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  let body: UpdateOnboardingStateRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_REQUEST', message: 'Invalid JSON in request body' } },
      { status: 400 },
    );
  }

  try {
    const client = userClient(UserService);

    // Fetch current state first to apply partial updates.
    const current = await client.getUserOnboardingState({
      tenantId,
      userId: session.user.id,
    });
    const state = protoToState(current.state ?? create(UserOnboardingStateSchema));
    const now = new Date().toISOString();

    if (body.completedStep) {
      if (!state.completedSteps.includes(body.completedStep)) {
        state.completedSteps = [...state.completedSteps, body.completedStep];
      }
      state.skippedSteps = state.skippedSteps.filter((s) => s !== body.completedStep);
    }
    if (body.skippedStep && !state.skippedSteps.includes(body.skippedStep)) {
      state.skippedSteps = [...state.skippedSteps, body.skippedStep];
    }
    if (body.navigateToStep) state.currentStepId = body.navigateToStep;
    if (body.llmConfig) {
      state.llmConfig = { ...state.llmConfig, ...body.llmConfig } as OnboardingState['llmConfig'];
      if (body.llmConfig.isValidated) {
        state.setupTasks = state.setupTasks.map((t) =>
          t.id === 'configure_llm' ? { ...t, status: 'completed' as SetupTaskStatus, completedAt: now } : t,
        );
      }
    }
    if (body.selectedAgentId) {
      state.selectedAgentId = body.selectedAgentId;
      state.setupTasks = state.setupTasks.map((t) =>
        t.id === 'select_agent' ? { ...t, status: 'completed' as SetupTaskStatus, completedAt: now } : t,
      );
    }
    if (body.createdMissionId) {
      state.createdMissionId = body.createdMissionId;
      state.setupTasks = state.setupTasks.map((t) =>
        t.id === 'create_mission' ? { ...t, status: 'completed' as SetupTaskStatus, completedAt: now } : t,
      );
    }
    if (body.setupTaskUpdate) {
      const { taskId, status } = body.setupTaskUpdate;
      state.setupTasks = state.setupTasks.map((t) =>
        t.id === taskId ? { ...t, status, completedAt: status === 'completed' ? now : t.completedAt } : t,
      );
    }
    if (body.completeWizard) {
      state.wizardCompleted = true;
      state.completedAt = now;
      if (!state.completedSteps.includes('completion')) {
        state.completedSteps = [...state.completedSteps, 'completion'];
      }
    }
    if (body.skipWizard) {
      state.wizardSkipped = true;
      state.completedAt = now;
    }
    state.updatedAt = now;

    // Persist via daemon.
    const updateResp = await client.updateUserOnboardingState({
      tenantId,
      userId: session.user.id,
      state: {
        userId: state.userId,
        tenantId: state.tenantId,
        wizardCompleted: state.wizardCompleted,
        wizardSkipped: state.wizardSkipped,
        currentStepId: state.currentStepId,
        completedSteps: state.completedSteps,
        skippedSteps: state.skippedSteps,
        setupTasks: state.setupTasks.map((t) => ({
          id: t.id,
          status: t.status,
          completedAt: t.completedAt ?? '',
          category: t.category,
          estimatedMinutes: t.estimatedMinutes,
        })),
        llmConfigJson: state.llmConfig ? JSON.stringify(state.llmConfig) : '',
        selectedAgentId: state.selectedAgentId ?? '',
        createdMissionId: state.createdMissionId ?? '',
        startedAt: state.startedAt,
        completedAt: state.completedAt ?? '',
        updatedAt: state.updatedAt,
        version: state.version,
      },
    });

    const saved = protoToState(updateResp.state ?? create(UserOnboardingStateSchema));
    const progress = calculateProgress(saved);
    const response: OnboardingStatusResponse = {
      state: saved,
      progress,
      shouldShowOnboarding: shouldShowOnboarding(saved),
      shouldShowSetupWidget: shouldShowSetupWidget(saved),
    };
    return NextResponse.json(response);
  } catch (err) {
    return daemonErrorResponse(err);
  }
}

// ============================================================================
// DELETE /api/onboarding/status
// ============================================================================

export async function DELETE(_request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 },
    );
  }
  if (!session.user?.id) {
    return NextResponse.json(
      { error: { code: 'INVALID_SESSION', message: 'User ID not found in session' } },
      { status: 400 },
    );
  }

  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  try {
    const resp = await userClient(UserService).resetUserOnboardingState({
      tenantId,
      userId: session.user.id,
    });
    const state = protoToState(resp.state ?? create(UserOnboardingStateSchema));
    const progress = calculateProgress(state);
    const response: OnboardingStatusResponse = {
      state,
      progress,
      shouldShowOnboarding: true,
      shouldShowSetupWidget: false,
    };
    return NextResponse.json(response);
  } catch (err) {
    return daemonErrorResponse(err);
  }
}
