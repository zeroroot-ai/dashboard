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
 *    with a sign-in link (the account exists; signing in once the email
 *    lands is the resume path, dashboard#962).
 *  - Hard cap at 360 iterations (~6 minutes) as a runaway guard — must
 *    exceed the signup action's worst-case duration (~255s).
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
import { POST_SIGNUP_REDIRECT } from "./types";
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
    // Card-first signup (dashboard#785): the card is already confirmed by the
    // time the panel shows; this is the server creating the trialing
    // subscription before any account/company is provisioned.
    steps: ["create_billing"],
    label: "$ starting trial subscription",
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

interface ProvisioningPanelProps {
  /** The opaque attempt UUID returned by `signupAction`. */
  attemptId: string;
  /** URL to navigate to when `terminalState === "ok"`. */
  redirectOnSuccess: string;
  /**
   * Workspace slug from a non-fatal PROVISIONING_TIMEOUT result
   * (dashboard#967). When set, a server-reported timeout does NOT stop the
   * poll: the panel keeps polling with `?slug=` so the progress endpoint
   * can probe live tenant readiness and flip the holding state to
   * "access granted" once the operator finishes the saga. Absent on the
   * happy path and for genuinely failed attempts.
   */
  tenantSlug?: string;
  /** Called when the user clicks "Try again", should reset the parent form. */
  onRetry: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 1_000;
// Runaway guard. Must comfortably exceed the server action's worst-case
// duration (TENANT_READY_TIMEOUT_MS=240s wait + preamble ≈ 255s,
// dashboard#962) so the panel is still polling when the action writes its
// terminal progress record; 6 minutes gives ~2 minutes of slack.
const MAX_POLL_ITERATIONS = 360; // 6-minute hard cap
// Extended cap while the live-readiness fallback holds (dashboard#967):
// a server-reported timeout with a known slug keeps polling — every 3rd
// tick, 20 probes/min, within the endpoint's 60/min budget — for up to 15
// minutes total before giving up and leaving the "Sign in instead" path.
const FALLBACK_TICK_MODULUS = 3;
const MAX_FALLBACK_POLL_ITERATIONS = 900; // 15-minute hard cap

export function ProvisioningPanel({
  attemptId,
  redirectOnSuccess,
  tenantSlug,
  onRetry,
}: ProvisioningPanelProps) {
  const [progress, setProgress] = useState<ProvisioningProgress | null>(null);
  const [pollError, setPollError] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  // Track previous step label to diff for aria-live announcements.
  const prevStepRef = useRef<ProvisioningStep | null>(null);
  const prevTerminalRef = useRef<ProvisioningProgress["terminalState"]>(
    undefined,
  );
  const iterationsRef = useRef(0);
  // True once a server-reported timeout arrived while a slug is known:
  // the live-readiness fallback is holding (dashboard#967). A ref, not
  // state — the interval callback closes over state from mount time.
  const fallbackHoldingRef = useRef(false);
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
      const maxIterations = fallbackHoldingRef.current
        ? MAX_FALLBACK_POLL_ITERATIONS
        : MAX_POLL_ITERATIONS;
      if (iterationsRef.current > maxIterations) {
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

      // While the fallback holds, probe every 3rd tick — the endpoint's
      // live-readiness branch dials the daemon, so keep it to 20/min.
      if (
        fallbackHoldingRef.current &&
        iterationsRef.current % FALLBACK_TICK_MODULUS !== 0
      ) {
        return;
      }

      try {
        const slugParam = tenantSlug
          ? `?slug=${encodeURIComponent(tenantSlug)}`
          : "";
        const res = await fetch(
          `/api/signup/progress/${encodeURIComponent(attemptId)}${slugParam}`,
          {
            cache: "no-store",
          },
        );

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
          // A server-reported timeout is NOT terminal when the slug is
          // known (dashboard#967): the Server Action — the only progress
          // writer — has returned, so only this poll's live-readiness
          // fallback can still flip the attempt to ok. Keep polling.
          if (data.terminalState === "timeout" && tenantSlug) {
            fallbackHoldingRef.current = true;
          } else {
            clearInterval(id);
          }
          // Announce once per terminal-state transition; the fallback
          // hold re-receives the same timeout record every probe.
          if (data.terminalState !== prevTerminalRef.current) {
            prevTerminalRef.current = data.terminalState;
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
  }, [attemptId, tenantSlug]);

  // Navigate on success after a brief celebratory pause. When the
  // live-readiness fallback resolved a timed-out attempt (dashboard#967)
  // no action-supplied redirect exists — fall back to the canonical
  // post-signup destination.
  useEffect(() => {
    if (isOk) {
      successTimerRef.current = setTimeout(() => {
        window.location.assign(redirectOnSuccess || POST_SIGNUP_REDIRECT);
      }, 1_500);
    }
    return () => {
      if (successTimerRef.current !== null) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, [isOk, redirectOnSuccess]);

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
          {/* On timeout the account exists and the workspace is still coming
              (dashboard#962): "Sign in" is the resume path, so it gets primary
              weight here. The old "Dismiss" button nulled this panel while the
              parent kept rendering the holding container — a blank page. */}
          <Button variant={isTimeout ? "default" : "ghost"} asChild>
            <Link href="/login">Sign in instead</Link>
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
