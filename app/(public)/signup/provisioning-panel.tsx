"use client";

/**
 * ProvisioningPanel, Client Component.
 *
 * Rendered by `<SignupForm>` immediately after `signupAction` returns an
 * `attemptId`. Polls `GET /api/signup/progress/:id` every 1 second, renders
 * a live step list, and:
 *
 *  - On `terminalState === "ok"`: waits 1 500 ms then navigates to the
 *    success redirect URL via `window.location.assign`.
 *  - On `terminalState === "failed"`: shows the error message and a "Try
 *    again" button that calls `onRetry()` to reset the parent form.
 *  - On `terminalState === "timeout"`: shows the "We'll email you" message
 *    with a dismiss button.
 *  - Hard cap at 120 iterations (~2 minutes) as a runaway guard.
 *
 * Accessibility: a `role="status"` + `aria-live="polite"` region announces
 * step transitions to screen readers without interrupting active speech.
 */

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  XCircle,
  Circle,
  Mail,
} from "lucide-react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ProvisioningProgress, ProvisioningStep } from "./types";

// ---------------------------------------------------------------------------
// Visible step groups
//
// The 8 internal steps are collapsed into 6 user-facing groups so the UI
// is concise. Steps that represent sub-phases of the same concept share a
// label.
// ---------------------------------------------------------------------------

interface StepGroup {
  /** At least one of these ProvisioningStep values must be current to show "running". */
  steps: ProvisioningStep[];
  label: string;
}

// Hacker-themed step labels, each maps to a real provisioning sub-phase
// but reads like a terminal session, matching the landing page's CRT-scanline
// + monospace aesthetic. Keep these short; long lines wrap on mobile.
const STEP_GROUPS: StepGroup[] = [
  {
    steps: ["rate_limit", "policy"],
    label: "$ validating credentials",
  },
  {
    steps: ["create_user", "send_verify_email"],
    label: "$ creating account",
  },
  {
    steps: ["apply_tenant"],
    label: "$ allocating tenant namespace",
  },
  {
    // Card-first signup (dashboard#769): plain-English label, not hacker-
    // theme — it appears beside the Payment Element where a paying customer
    // is entering card details.
    steps: ["await_payment"],
    label: "$ confirming payment method",
  },
  {
    steps: ["setup_workspace"],
    label: "$ provisioning control plane",
  },
  {
    steps: ["apply_member"],
    label: "$ configuring access",
  },
  {
    steps: ["grant_owner_role"],
    label: "$ granting root",
  },
  // Spec 4 Task 20: Vault namespace step published by the tenant-operator saga.
  // The label intentionally uses plain English (not hacker-theme) because it
  // appears during the SaaS onboarding flow where tenants may not be engineers.
  {
    steps: ["provisioning_secrets_backend"],
    label: "$ provisioning secrets backend",
  },
  {
    steps: ["done"],
    label: "$ access granted",
  },
];

// Ordered flat list of all steps, used to determine which groups are "done"
// (i.e. their steps have been passed).
const STEP_ORDER: ProvisioningStep[] = [
  "rate_limit",
  "policy",
  "create_user",
  "send_verify_email",
  "apply_tenant",
  "setup_workspace",
  "apply_member",
  "grant_owner_role",
  // New step: published by the tenant-operator after ensureVaultNamespace
  // completes.  The ProvisioningPanel renders it automatically because
  // STEP_GROUPS above already references it.
  "provisioning_secrets_backend",
  "done",
];

type GroupStatus = "pending" | "running" | "done" | "failed";

function resolveGroupStatus(
  group: StepGroup,
  currentStep: ProvisioningStep | null,
  terminalState: ProvisioningProgress["terminalState"],
  isFailed: boolean,
): GroupStatus {
  if (currentStep === null) return "pending";

  const currentIndex = STEP_ORDER.indexOf(currentStep);
  const groupIndices = group.steps.map((s) => STEP_ORDER.indexOf(s));
  const groupMin = Math.min(...groupIndices);
  const groupMax = Math.max(...groupIndices);

  // The current step is inside this group → running (unless terminal failure)
  if (currentIndex >= groupMin && currentIndex <= groupMax) {
    if (isFailed) return "failed";
    return "running";
  }

  // Current step is past this group → done
  if (currentIndex > groupMax) {
    return "done";
  }

  // Current step has not reached this group yet
  return "pending";
}

// ---------------------------------------------------------------------------
// Step icon
// ---------------------------------------------------------------------------

function StepIcon({ status }: { status: GroupStatus }) {
  switch (status) {
    case "running":
      return (
        <Loader2
          className="h-5 w-5 shrink-0 animate-spin text-primary"
          aria-hidden="true"
        />
      );
    case "done":
      return (
        <CheckCircle2
          className="h-5 w-5 shrink-0 text-highlight"
          aria-hidden="true"
        />
      );
    case "failed":
      return (
        <XCircle
          className="h-5 w-5 shrink-0 text-destructive"
          aria-hidden="true"
        />
      );
    case "pending":
    default:
      return (
        <Circle
          className="h-5 w-5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProvisioningPanelProps {
  /** The opaque attempt UUID returned by `signupAction`. */
  attemptId: string;
  /** URL to navigate to when `terminalState === "ok"`. */
  redirectOnSuccess: string;
  /** Called when the user clicks "Try again", should reset the parent form. */
  onRetry: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_ITERATIONS = 120; // 2-minute hard cap

export function ProvisioningPanel({
  attemptId,
  redirectOnSuccess,
  onRetry,
}: ProvisioningPanelProps) {
  const [progress, setProgress] = useState<ProvisioningProgress | null>(null);
  const [pollError, setPollError] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  // Track previous step label to diff for aria-live announcements.
  const prevStepRef = useRef<ProvisioningStep | null>(null);
  const iterationsRef = useRef(0);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentStep = progress?.step ?? null;
  const terminalState = progress?.terminalState;

  const isOk = terminalState === "ok";
  const isFailed = terminalState === "failed";
  const isTimeout = terminalState === "timeout";
  const isTerminal = isOk || isFailed || isTimeout;

  // Polling
  useEffect(() => {
    let cancelled = false;

    const id = setInterval(async () => {
      if (cancelled) return;

      iterationsRef.current += 1;
      if (iterationsRef.current > MAX_POLL_ITERATIONS) {
        clearInterval(id);
        // Treat runaway as a timeout for the UI.
        setProgress((prev) =>
          prev
            ? { ...prev, terminalState: "timeout" }
            : {
                step: "done",
                stepStartedAt: Date.now(),
                terminalState: "timeout",
              },
        );
        return;
      }

      try {
        const res = await fetch(`/api/signup/progress/${encodeURIComponent(attemptId)}`, {
          cache: "no-store",
        });

        if (cancelled) return;

        if (res.status === 404) {
          // ID not yet written, normal for the first few ticks. Keep polling.
          return;
        }

        if (!res.ok) {
          setPollError(true);
          clearInterval(id);
          return;
        }

        const data = (await res.json()) as ProvisioningProgress;
        if (cancelled) return;

        setProgress(data);

        // Announce step transitions for screen readers.
        if (data.step !== prevStepRef.current) {
          const group = STEP_GROUPS.find((g) => g.steps.includes(data.step));
          if (group) {
            setAnnouncement(`Step in progress: ${group.label}`);
          }
          prevStepRef.current = data.step;
        }

        if (data.terminalState) {
          clearInterval(id);
          if (data.terminalState === "ok") {
            setAnnouncement("Your workspace is ready. Signing you in now.");
          } else if (data.terminalState === "failed") {
            setAnnouncement("Setup failed. You can try again.");
          } else {
            setAnnouncement(
              "Setup is taking longer than expected. We'll email you when it's ready.",
            );
          }
        }
      } catch {
        if (!cancelled) {
          setPollError(true);
          clearInterval(id);
        }
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [attemptId]);

  // Navigate on success after a brief celebratory pause.
  useEffect(() => {
    if (isOk) {
      successTimerRef.current = setTimeout(() => {
        window.location.assign(redirectOnSuccess);
      }, 1_500);
    }
    return () => {
      if (successTimerRef.current !== null) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, [isOk, redirectOnSuccess]);

  if (dismissed) return null;

  // Build the group status list for rendering.
  const groupStatuses = STEP_GROUPS.map((group) => ({
    ...group,
    status: resolveGroupStatus(
      group,
      currentStep,
      terminalState,
      isFailed || pollError,
    ),
  }));

  return (
    <Card className="w-full max-w-md mx-auto">
      {/* aria-live region for screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>

      <CardHeader>
        <CardTitle className="text-xl font-mono">
          {isOk
            ? "$ access granted"
            : isFailed || pollError
              ? "$ exit 1: setup_failed"
              : isTimeout
                ? "$ still working..."
                : "$ initializing tenant runtime"}
        </CardTitle>
        {!isTerminal && !pollError && (
          <p className="text-sm text-muted-foreground font-mono">
            # spinning up your slice of the control plane (~30s)
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Step list, hidden on timeout to avoid confusion */}
        {!isTimeout && !pollError && (
          <ul className="space-y-3" aria-label="Provisioning steps">
            {groupStatuses.map((group) => (
              <li key={group.label} className="flex items-center gap-3">
                <StepIcon status={group.status} />
                <span
                  className={
                    group.status === "done"
                      ? "text-sm"
                      : group.status === "failed"
                        ? "text-sm text-destructive"
                        : group.status === "running"
                          ? "text-sm font-medium"
                          : "text-sm text-muted-foreground"
                  }
                >
                  {group.label}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Success state */}
        {isOk && (
          <div className="flex items-center gap-3 rounded-md bg-highlight/10 border border-highlight/40 px-4 py-3">
            <CheckCircle2
              className="h-5 w-5 shrink-0 text-highlight"
              aria-hidden="true"
            />
            <p className="text-sm text-highlight">
              Workspace provisioned. Signing you in&hellip;
            </p>
          </div>
        )}

        {/* Failure state, keep it light + actionable. The hacker theme of
            the rest of the page is the brand voice; failure messages should
            sound confident, not apologetic.
            SECRETS_NAMESPACE_FAILED gets a dedicated message because Vault
            provisioning failures need a slightly different remediation path.*/}
        {(isFailed || pollError) && (() => {
          const isVaultFailure =
            progress?.error?.code === "SECRETS_NAMESPACE_FAILED";
          return (
            <div className="rounded-md bg-alt/10 border border-alt/30 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <XCircle
                  className="h-5 w-5 shrink-0 text-alt"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium font-mono text-alt">
                  {isVaultFailure
                    ? "# secrets backend provisioning failed"
                    : "# one of the daemons hiccupped"}
                </p>
              </div>
              <p className="text-sm text-muted-foreground pl-7 font-mono">
                {isVaultFailure ? (
                  <>
                    your account is ready but the secrets backend didn&apos;t
                    come up, retry to try again, or ping{" "}
                    <a
                      href="mailto:support@zeroroot.ai"
                      className="underline underline-offset-4 hover:no-underline"
                    >
                      support@zeroroot.ai
                    </a>{" "}
                    if it keeps happening.
                  </>
                ) : (
                  <>
                    hit the button again, usually clears it. if it sticks,
                    ping{" "}
                    <a
                      href="mailto:support@zeroroot.ai"
                      className="underline underline-offset-4 hover:no-underline"
                    >
                      support@zeroroot.ai
                    </a>{" "}
                    and we&apos;ll dig in.
                  </>
                )}
              </p>
            </div>
          );
        })()}

        {/* Timeout state, same vibe; the workspace IS coming, just slowly. */}
        {isTimeout && (
          <div className="rounded-md bg-muted border border-border px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <Mail
                className="h-5 w-5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm font-medium font-mono">
                # taking the scenic route
              </p>
            </div>
            <p className="text-sm text-muted-foreground pl-7 font-mono">
              still wiring things up, we&apos;ll drop you an email the moment
              your workspace is live.
            </p>
          </div>
        )}
      </CardContent>

      {/* Action buttons, shown only on non-success terminal states */}
      {(isFailed || pollError || isTimeout) && (
        <CardFooter className="flex gap-3 flex-wrap">
          {(isFailed || pollError) && (
            <Button onClick={onRetry} variant="default">
              Try again
            </Button>
          )}
          {isTimeout && (
            <Button onClick={() => setDismissed(true)} variant="outline">
              Dismiss
            </Button>
          )}
          <Button variant="ghost" asChild>
            <Link href="/login">Sign in instead</Link>
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
