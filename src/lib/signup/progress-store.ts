/**
 * Signup progress store — Redis-backed state for the provisioning panel.
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
 */
import { getJSON, setJSON } from "@/src/lib/redis-store";
import type {
  ProvisioningProgress,
  ProvisioningStep,
  SignupFailureCode,
} from "@/app/(public)/signup/types";

const PROGRESS_KEY_PREFIX = "signup-progress:";
const PROGRESS_TTL_SECONDS = 300;

function key(attemptId: string): string {
  return `${PROGRESS_KEY_PREFIX}${attemptId}`;
}

export async function setProgress(
  attemptId: string,
  progress: ProvisioningProgress,
): Promise<void> {
  await setJSON(key(attemptId), progress, PROGRESS_TTL_SECONDS);
}

export async function getProgress(
  attemptId: string,
): Promise<ProvisioningProgress | null> {
  return await getJSON<ProvisioningProgress>(key(attemptId));
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
    step: "done",
    stepStartedAt: Date.now(),
    terminalState: "ok",
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
    terminalState: code === "PROVISIONING_TIMEOUT" || code === "MEMBERSHIP_TIMEOUT"
      ? "timeout"
      : "failed",
    error: { code, userMessage },
  });
}
