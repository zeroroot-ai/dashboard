/**
 * Signup progress store — daemon-backed state for the provisioning panel.
 *
 * `signupAction` writes the current pipeline step after every transition;
 * the `/api/signup/progress/:id` endpoint reads it and the client-side
 * <ProvisioningPanel /> polls that endpoint every second.
 *
 * Keys are opaque UUIDs minted at action entry (the "attemptId") — they
 * function as single-use capabilities so the GET endpoint can stay
 * unauthenticated without leaking PII. Values carry only step names +
 * terminal codes + human-facing error messages, never raw Zitadel
 * responses / user credentials.
 *
 * TTL: 5 minutes. Provisioning should finish in <30s; the extra window
 * gives the UI a chance to render the final "done" state before the key
 * expires.
 *
 * Replaces the previous direct-Redis implementation.
 * Spec: dashboard-no-backing-store-clients (Module 5 / issue #589).
 */

import 'server-only';

import { userClient } from '@/src/lib/gibson-client';
import { UserService } from '@/src/gen/gibson/tenant/v1/user_pb';
import type {
  ProvisioningProgress,
  ProvisioningStep,
  SignupFailureCode,
} from '@/app/(public)/signup/types';

const PROGRESS_TTL_SECONDS = 300;

// ============================================================================
// Core helpers
// ============================================================================

function progressToProto(progress: ProvisioningProgress) {
  return {
    step: progress.step,
    stepStartedAtUnix: BigInt(progress.stepStartedAt ?? 0),
    terminalState: progress.terminalState ?? '',
    errorCode: progress.error?.code ?? '',
    errorMessage: progress.error?.userMessage ?? '',
  };
}

function protoToProgress(proto: {
  step: string;
  stepStartedAtUnix: bigint;
  terminalState: string;
  errorCode: string;
  errorMessage: string;
}): ProvisioningProgress {
  const base: ProvisioningProgress = {
    step: proto.step as ProvisioningStep,
    stepStartedAt: Number(proto.stepStartedAtUnix),
  };
  if (proto.terminalState) {
    (base as ProvisioningProgress).terminalState = proto.terminalState as ProvisioningProgress['terminalState'];
  }
  if (proto.errorCode && proto.errorMessage) {
    (base as ProvisioningProgress).error = {
      code: proto.errorCode as SignupFailureCode,
      userMessage: proto.errorMessage,
    };
  }
  return base;
}

export async function setProgress(
  attemptId: string,
  progress: ProvisioningProgress,
): Promise<void> {
  await userClient(UserService).setSignupProgress({
    attemptId,
    progress: progressToProto(progress),
    ttlSeconds: PROGRESS_TTL_SECONDS,
  });
}

export async function getProgress(
  attemptId: string,
): Promise<ProvisioningProgress | null> {
  const resp = await userClient(UserService).getSignupProgress({ attemptId });
  if (!resp.found || !resp.progress) return null;
  return protoToProgress(resp.progress);
}

/**
 * Advance to a new in-flight step (non-terminal).
 */
export async function advanceStep(
  attemptId: string,
  step: ProvisioningStep,
): Promise<void> {
  await setProgress(attemptId, {
    step,
    stepStartedAt: Date.now(),
  });
}

/**
 * Mark the attempt as successfully completed.
 */
export async function completeProgress(attemptId: string): Promise<void> {
  await setProgress(attemptId, {
    step: 'done',
    stepStartedAt: Date.now(),
    terminalState: 'ok',
  });
}

/**
 * Mark the attempt as failed with a typed error code + user-facing message.
 * Never includes raw Zitadel error bodies or any user credential.
 */
export async function failProgress(
  attemptId: string,
  step: ProvisioningStep,
  code: SignupFailureCode,
  userMessage: string,
): Promise<void> {
  await setProgress(attemptId, {
    step,
    stepStartedAt: Date.now(),
    terminalState: code === 'PROVISIONING_TIMEOUT' || code === 'MEMBERSHIP_TIMEOUT'
      ? 'timeout'
      : 'failed',
    error: { code, userMessage },
  });
}
