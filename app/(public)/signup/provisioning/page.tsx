"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, XCircle, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProvisioningStep {
  name: string;
  displayLabel: string;
  status: "pending" | "running" | "completed" | "failed";
}

interface ProvisioningStatusResponse {
  status: "provisioning" | "completed" | "failed" | "not_found" | "error" | string;
  steps: ProvisioningStep[];
  currentStep: string;
}

// Step display definitions — must match daemon step names exactly.
const STEP_LABELS: Record<string, string> = {
  org: "Creating organization",
  fga: "Setting up permissions",
  provision: "Provisioning workspace",
};

// ---------------------------------------------------------------------------
// Step icon
// ---------------------------------------------------------------------------

function StepIcon({ status }: { status: ProvisioningStep["status"] }) {
  switch (status) {
    case "running":
      return <Loader2 className="h-5 w-5 animate-spin text-blue-500 shrink-0" />;
    case "completed":
      return <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />;
    case "failed":
      return <XCircle className="h-5 w-5 text-red-500 shrink-0" />;
    case "pending":
    default:
      return <Circle className="h-5 w-5 text-muted-foreground shrink-0" />;
  }
}

// ---------------------------------------------------------------------------
// Main provisioning component
// ---------------------------------------------------------------------------

function ProvisioningStatus() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tenant = searchParams.get("tenant");
  const userId = searchParams.get("user");

  const [status, setStatus] = useState<ProvisioningStatusResponse | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [networkError, setNetworkError] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCompletedRef = useRef(false);

  function stopPolling() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function stopTimeout() {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  function handleProvisioningComplete() {
    stopPolling();
    stopTimeout();
    isCompletedRef.current = true;

    // signUpAction already created a Better Auth session and committed
    // the cookie via nextCookies(), so the user is signed in. Go
    // straight to the dashboard. If the cookie is missing for any
    // reason (e.g., the anti-enumeration existing-user path), the
    // middleware session guard will redirect to login.
    router.push("/dashboard/default");
  }

  useEffect(() => {
    if (!userId && !tenant) {
      setNetworkError(true);
      return;
    }

    async function poll() {
      try {
        const params = new URLSearchParams();
        if (userId) params.set("user", userId);
        if (tenant) params.set("tenant", tenant);

        const res = await fetch(`/api/signup/status?${params.toString()}`);
        if (!res.ok) {
          setNetworkError(true);
          stopPolling();
          stopTimeout();
          return;
        }

        const data = (await res.json()) as ProvisioningStatusResponse;
        setStatus(data);

        // The status route maps Tenant phase=Ready -> "active" (legacy
        // signup mapping). Treat both "completed" and "active" as done so
        // the page redirects once provisioning finishes.
        if (data.status === "completed" || data.status === "active") {
          if (!isCompletedRef.current) {
            handleProvisioningComplete();
          }
        } else if (data.status === "failed" || data.status === "provisioning_failed") {
          stopPolling();
          stopTimeout();
        }
      } catch {
        setNetworkError(true);
        stopPolling();
        stopTimeout();
      }
    }

    // Start polling immediately, then every 2 seconds
    poll();
    intervalRef.current = setInterval(poll, 2000);

    // 60-second timeout — if not completed, show failure message
    timeoutRef.current = setTimeout(() => {
      if (!isCompletedRef.current) {
        setTimedOut(true);
        stopPolling();
      }
    }, 60_000);

    return () => {
      stopPolling();
      stopTimeout();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, tenant]);

  const isComplete = status?.status === "completed";
  const isFailed = status?.status === "failed" || networkError || timedOut;

  // Build a normalized step list. The API may return steps from the daemon,
  // or we fall back to showing the three known steps as pending.
  const steps: ProvisioningStep[] =
    status?.steps && status.steps.length > 0
      ? status.steps
      : (["org", "fga", "provision"] as const).map((name) => ({
          name,
          displayLabel: STEP_LABELS[name],
          status: "pending" as const,
        }));

  // "Almost done..." row — shown when all three steps are completed
  const allStepsCompleted =
    steps.length >= 3 && steps.every((s) => s.status === "completed");

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-start justify-center px-4 py-12">
      <Card className="max-w-md w-full mx-auto mt-20">
        <CardHeader>
          <CardTitle className="text-xl">
            {isComplete
              ? "Your workspace is ready!"
              : isFailed
              ? "Setup incomplete"
              : "Setting up your workspace"}
          </CardTitle>
          {!isComplete && !isFailed && (
            <p className="text-sm text-muted-foreground mt-1">
              This usually takes less than 30 seconds.
            </p>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Steps list */}
          {!isFailed && (
            <ul className="space-y-3" aria-label="Provisioning steps">
              {steps.map((step) => {
                const label = step.displayLabel || STEP_LABELS[step.name] || step.name;
                return (
                  <li key={step.name} className="flex items-center gap-3">
                    <StepIcon status={step.status} />
                    <span
                      className={
                        step.status === "completed"
                          ? "text-sm"
                          : step.status === "failed"
                          ? "text-sm text-red-500"
                          : step.status === "running"
                          ? "text-sm font-medium"
                          : "text-sm text-muted-foreground"
                      }
                    >
                      {label}
                    </span>
                  </li>
                );
              })}

              {/* "Almost done..." — shown when all three real steps complete */}
              {allStepsCompleted && (
                <li className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500 shrink-0" />
                  <span className="text-sm font-medium">Almost done...</span>
                </li>
              )}
            </ul>
          )}

          {/* Loading state before first response */}
          {!status && !networkError && !timedOut && (
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-blue-500 shrink-0" />
              <span className="text-sm text-muted-foreground">Starting provisioning...</span>
            </div>
          )}

          {/* Success message — briefly visible before auto-login redirect */}
          {isComplete && (
            <div className="flex items-center gap-3 rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
              <p className="text-sm text-green-700 dark:text-green-400">
                Workspace provisioned. Signing you in...
              </p>
            </div>
          )}

          {/* Failure message */}
          {isFailed && !isComplete && (
            <div className="rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500 shrink-0" />
                <p className="text-sm font-medium text-red-700 dark:text-red-400">
                  We had trouble setting up your workspace.
                </p>
              </div>
              <p className="text-sm text-red-600 dark:text-red-500 pl-7">
                Your account has been created. Please{" "}
                <Link
                  href="/dashboard/login/v2"
                  className="underline underline-offset-4 hover:no-underline"
                >
                  try signing in
                </Link>
                , or contact{" "}
                <a
                  href="mailto:support@zero-day.ai"
                  className="underline underline-offset-4 hover:no-underline"
                >
                  support@zero-day.ai
                </a>{" "}
                for assistance.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page export
// ---------------------------------------------------------------------------

export default function ProvisioningPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <ProvisioningStatus />
    </Suspense>
  );
}
