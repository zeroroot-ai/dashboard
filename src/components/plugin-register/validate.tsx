"use client";

/**
 * Step 2 — Server-side validation
 *
 * Calls validatePluginManifestAction (RegisterPlugin dry-run) to surface
 * semantic errors from the daemon. Automatically fires when the step mounts
 * and re-runs if the user edits the manifest and navigates back.
 *
 * Spec: secrets-tenant-lifecycle Task 14, Requirement 2.
 */

import { useEffect, useState } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Loader2Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import type { PluginManifestValidationError } from "@/src/lib/gibson-client/plugins-admin";
import { validatePluginManifestAction } from "@/app/actions/plugin-register";

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

export interface ValidateStepProps {
  manifestYaml: string;
  onValidated: (errors: PluginManifestValidationError[]) => void;
  onNext: () => void;
  onBack: () => void;
}

type ValidateState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "success" }
  | { phase: "errors"; errors: PluginManifestValidationError[] }
  | { phase: "failed"; message: string };

// ---------------------------------------------------------------------------
// ValidateStep component
// ---------------------------------------------------------------------------

export function ValidateStep({
  manifestYaml,
  onValidated,
  onNext,
  onBack,
}: ValidateStepProps) {
  const [state, setState] = useState<ValidateState>({ phase: "idle" });

  async function runValidation() {
    setState({ phase: "running" });
    try {
      const result = await validatePluginManifestAction(manifestYaml);
      if (!result.ok) {
        setState({ phase: "failed", message: result.error });
        onValidated([]);
        return;
      }
      if (!result.data.valid) {
        setState({ phase: "errors", errors: result.data.errors });
        onValidated(result.data.errors);
        return;
      }
      setState({ phase: "success" });
      onValidated([]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Validation failed";
      setState({ phase: "failed", message: msg });
      onValidated([]);
    }
  }

  // Auto-run on mount
  useEffect(() => {
    void runValidation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canAdvance = state.phase === "success";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Server-side validation</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          The manifest is being validated against the Gibson daemon. No state is
          created — this is a dry run.
        </p>
      </div>

      {/* Running */}
      {state.phase === "running" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
          <span>Validating manifest…</span>
        </div>
      )}

      {/* Success */}
      {state.phase === "success" && (
        <Alert className="border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400">
          <CheckCircle2Icon className="size-4" aria-hidden="true" />
          <AlertTitle>Manifest is valid</AlertTitle>
          <AlertDescription className="text-xs">
            All checks passed. Proceed to configure secret bindings.
          </AlertDescription>
        </Alert>
      )}

      {/* Semantic errors from daemon */}
      {state.phase === "errors" && state.errors.length > 0 && (
        <Alert variant="destructive" role="alert">
          <AlertTriangleIcon className="size-4" aria-hidden="true" />
          <AlertTitle>Validation errors</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-0.5 text-xs">
              {state.errors.map((err, idx) => (
                <li key={idx} className="font-mono">
                  <span className="text-destructive-foreground/70">
                    Line {err.line}
                  </span>{" "}
                  [{err.field}] [{err.code}] {err.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* RPC / transport failure */}
      {state.phase === "failed" && (
        <Alert variant="destructive" role="alert">
          <AlertTriangleIcon className="size-4" aria-hidden="true" />
          <AlertTitle>Validation failed</AlertTitle>
          <AlertDescription className="text-xs">
            {state.message}. Check your daemon connectivity and try again.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBack}
          disabled={state.phase === "running"}
        >
          Back
        </Button>
        <div className="flex items-center gap-2">
          {(state.phase === "errors" || state.phase === "failed") && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runValidation()}
            >
              Retry
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={onNext}
            disabled={!canAdvance}
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
