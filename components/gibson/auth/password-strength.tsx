"use client";

import { CheckIcon, XIcon, ShieldAlertIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/src/lib/utils";
/** Type for the HIBP password check server action. */
type CheckPasswordAction = (args: { password: string }) => Promise<
  { ok: true; breached: boolean; count?: number } | { ok: false; reason: string }
>;

interface Requirement {
  label: string;
  test: (password: string) => boolean;
}

const REQUIREMENTS: Requirement[] = [
  {
    label: "At least 12 characters",
    test: (p) => p.length >= 12,
  },
  {
    label: "Uppercase letter",
    test: (p) => /[A-Z]/.test(p),
  },
  {
    label: "Lowercase letter",
    test: (p) => /[a-z]/.test(p),
  },
  {
    label: "Number",
    test: (p) => /[0-9]/.test(p),
  },
  {
    label: "Special character",
    test: (p) => /[^A-Za-z0-9]/.test(p),
  },
];

const DEBOUNCE_MS = 500;

/** All possible states for the HIBP breach indicator. */
type BreachState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "breached"; count?: number }
  | { status: "clean" }
  | { status: "unknown"; reason: string };

interface PasswordStrengthProps {
  password: string;
  id?: string;
  /**
   * Injected Server Action for the HIBP live check. When omitted (e.g. in
   * tests that only exercise the rule checklist), breach checking is skipped.
   */
  onCheckPassword?: CheckPasswordAction;
  /**
   * Pass `false` to disable the HIBP live-check UI entirely — behaves as if
   * NEXT_PUBLIC_DASHBOARD_HIBP_ENABLED is not 'true'. Defaults to the env var.
   */
  hibpEnabled?: boolean;
}

function allRulesPass(password: string): boolean {
  return REQUIREMENTS.every((r) => r.test(password));
}

/**
 * PasswordStrength displays five real-time password requirements with
 * pass/fail indicators. When HIBP checking is enabled and all rules pass,
 * it debounces keystrokes and calls the provided Server Action to check for
 * known breaches, showing distinct UI for each outcome.
 *
 * Purely controlled by the `password` prop for the rule checklist.
 * The breach indicator uses internal state driven by debounced async calls.
 */
export function PasswordStrength({
  password,
  id,
  onCheckPassword,
  hibpEnabled = process.env.NEXT_PUBLIC_DASHBOARD_HIBP_ENABLED === "true",
}: PasswordStrengthProps) {
  const [breach, setBreach] = useState<BreachState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hibpActive = hibpEnabled && typeof onCheckPassword === "function";

  useEffect(() => {
    // Clear any pending debounce and abort any in-flight request.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    if (!hibpActive || password.length === 0) {
      setBreach({ status: "idle" });
      return;
    }

    if (!allRulesPass(password)) {
      setBreach({ status: "idle" });
      return;
    }

    // Rules all pass — schedule a debounced HIBP check.
    setBreach({ status: "checking" });

    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // The Server Action itself uses an internal AbortController for the
        // network call. We use our local controller only to detect whether
        // this particular scheduled invocation has been superseded.
        const result = await onCheckPassword!({ password });

        if (controller.signal.aborted) return;

        if (!result.ok) {
          setBreach({ status: "unknown", reason: result.reason });
          return;
        }

        if (result.breached) {
          setBreach({ status: "breached", count: result.count });
        } else {
          setBreach({ status: "clean" });
        }
      } catch {
        if (controller.signal.aborted) return;
        setBreach({ status: "unknown", reason: "fetch_error" });
      } finally {
        abortRef.current = null;
        timerRef.current = null;
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password, hibpActive]);

  return (
    <div id={id} className="space-y-3">
      {/* Rule checklist */}
      <div role="list" className="space-y-1.5 text-sm">
        {REQUIREMENTS.map((req) => {
          const passes = req.test(password);
          return (
            <div
              key={req.label}
              role="listitem"
              aria-live="polite"
              aria-label={`${req.label}: ${passes ? "requirement met" : "requirement not met"}`}
              className="flex items-center gap-2"
            >
              {passes ? (
                <CheckIcon
                  className="h-4 w-4 shrink-0 text-green-500"
                  aria-hidden="true"
                />
              ) : (
                <XIcon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    password.length === 0
                      ? "text-muted-foreground"
                      : "text-destructive"
                  )}
                  aria-hidden="true"
                />
              )}
              <span
                className={cn(
                  passes
                    ? "text-green-700 dark:text-green-400"
                    : password.length === 0
                    ? "text-muted-foreground"
                    : "text-destructive"
                )}
              >
                {req.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Breach indicator — only rendered when HIBP is active and there's something to show */}
      {hibpActive && password.length > 0 && breach.status !== "idle" && (
        <BreachIndicator breach={breach} />
      )}
    </div>
  );
}

interface BreachIndicatorProps {
  breach: BreachState;
}

function BreachIndicator({ breach }: BreachIndicatorProps) {
  if (breach.status === "checking") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Checking for known breaches"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <LoaderCircleIcon className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
        <span>Checking for known breaches...</span>
      </div>
    );
  }

  if (breach.status === "breached") {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="space-y-1"
      >
        <div className="flex items-center gap-2">
          <ShieldAlertIcon className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span className="text-sm font-semibold text-destructive">Breached</span>
        </div>
        <p className="text-sm text-destructive pl-6">
          This password has appeared in a public breach. Please choose a different one.
        </p>
      </div>
    );
  }

  if (breach.status === "clean") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="space-y-0.5"
      >
        <div className="flex items-center gap-2">
          <CheckIcon className="h-4 w-4 shrink-0 text-green-500" aria-hidden="true" />
          <span className="text-sm font-semibold text-green-700 dark:text-green-400">Strong</span>
        </div>
        <p className="text-sm text-muted-foreground pl-6">Not found in public breaches</p>
      </div>
    );
  }

  if (breach.status === "unknown") {
    return (
      <p
        role="status"
        aria-live="polite"
        className="text-sm text-muted-foreground"
      >
        Breach check unavailable — you can still submit
      </p>
    );
  }

  return null;
}
