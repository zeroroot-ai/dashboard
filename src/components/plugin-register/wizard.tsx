"use client";

/**
 * Plugin Registration Wizard
 *
 * Five-step wizard for atomic plugin registration:
 *   Step 1, Manifest upload (client-side validation)
 *   Step 2, Server-side validation (daemon dry-run)
 *   Step 3, Secret bindings (per-secret existing-pick or inline-create)
 *   Step 4, Confirm (manifest summary + bindings review; atomic submit)
 *   Step 5, Enrollment (bootstrap token + CLI command)
 *
 * State is held in this client component and is NEVER persisted to
 * sessionStorage, localStorage, or any other browser storage. All values
 * are cleared when the user navigates away or closes the containing dialog.
 *
 * Atomicity guarantee:
 *   The final submit calls registerPluginAtomicAction which delegates to the
 *   daemon's RegisterPlugin RPC (per Spec 2 R3.1). On partial failure the
 *   daemon rolls back all created state (Zitadel SA, FGA tuples, inline
 *   secrets) and returns a failure code. The wizard maps that code to the
 *   relevant step so the user can fix and retry.
 *
 * Rollback navigation mapping:
 *   - "manifest_invalid"   → Step 1 (manifest-upload)
 *   - "binding_failed"     → Step 3 (bindings)
 *   - "precondition_failed"→ Step 3 (bindings; likely broker issue)
 *   - "already_registered" → Step 1 (already exists)
 *   - other codes          → stay on Step 4 (confirm) with error message
 *
 * Spec: secrets-tenant-lifecycle Task 14, Requirement 2.
 */

import { useState } from "react";
import {
  CheckCircle2Icon,
  ClipboardCheckIcon,
  FileScanIcon,
  KeyRoundIcon,
  ServerIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { ManifestUpload, type ClientValidationResult } from "./manifest-upload";
import { ValidateStep } from "./validate";
import { BindingsStep, type BindingEntry } from "./bindings";
import { ConfirmStep } from "./confirm";
import { EnrollmentStep } from "./enrollment";

import type { PluginManifestValidationError } from "@/src/lib/gibson-client/plugins-admin";
import type { RegisterResult } from "@/app/actions/plugin-register";

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

type WizardStep = 1 | 2 | 3 | 4 | 5;

const STEPS: Array<{
  id: WizardStep;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 1, label: "Upload", Icon: FileScanIcon },
  { id: 2, label: "Validate", Icon: ServerIcon },
  { id: 3, label: "Bindings", Icon: KeyRoundIcon },
  { id: 4, label: "Confirm", Icon: ClipboardCheckIcon },
  { id: 5, label: "Enroll", Icon: CheckCircle2Icon },
];

// ---------------------------------------------------------------------------
// Wizard state shape
// ---------------------------------------------------------------------------

interface WizardState {
  step: WizardStep;
  manifestYaml: string;
  clientValidation: ClientValidationResult | null;
  serverErrors: PluginManifestValidationError[];
  bindings: BindingEntry[];
  registerResult: RegisterResult | null;
  rollbackMessage: string | null;
}

const INITIAL_STATE: WizardState = {
  step: 1,
  manifestYaml: "",
  clientValidation: null,
  serverErrors: [],
  bindings: [],
  registerResult: null,
  rollbackMessage: null,
};

// ---------------------------------------------------------------------------
// WizardProps
// ---------------------------------------------------------------------------

interface PluginRegisterWizardProps {
  /** Called when the user clicks "Done" on the enrollment step. */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({
  steps,
  current,
}: {
  steps: typeof STEPS;
  current: WizardStep;
}) {
  return (
    <nav aria-label="Registration steps" className="mb-6">
      <ol className="flex items-center gap-0">
        {steps.map((s, idx) => {
          const isDone = current > s.id;
          const isActive = current === s.id;
          return (
            <li key={s.id} className="flex flex-1 items-center">
              <div
                className={cn(
                  "flex shrink-0 flex-col items-center gap-1",
                  "flex-1",
                )}
              >
                <div
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full border-2 transition-colors",
                    isDone &&
                      "border-primary bg-primary text-primary-foreground",
                    isActive &&
                      "border-primary bg-background text-primary",
                    !isDone &&
                      !isActive &&
                      "border-muted-foreground/30 bg-background text-muted-foreground/50",
                  )}
                  aria-current={isActive ? "step" : undefined}
                >
                  <s.Icon
                    className="size-3.5"
                    aria-hidden="true"
                  />
                </div>
                <span
                  className={cn(
                    "text-center text-xs",
                    isActive
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </span>
              </div>

              {/* Connector line between steps */}
              {idx < steps.length - 1 && (
                <div
                  className={cn(
                    "h-px flex-1 transition-colors",
                    isDone ? "bg-primary" : "bg-muted-foreground/20",
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// PluginRegisterWizard
// ---------------------------------------------------------------------------

export function PluginRegisterWizard({ onClose }: PluginRegisterWizardProps) {
  const [state, setState] = useState<WizardState>(INITIAL_STATE);

  function goTo(step: WizardStep) {
    setState((s) => ({ ...s, step, rollbackMessage: null }));
  }

  function handleClientValidated(result: ClientValidationResult) {
    setState((s) => ({
      ...s,
      clientValidation: result,
      // Pre-seed bindings array based on declared secrets
      bindings:
        result.declaredSecrets.length !== s.bindings.length
          ? result.declaredSecrets.map((name) => ({
              declaredName: name,
              mode: "existing" as const,
              existingRef: "",
              createValue: "",
            }))
          : s.bindings,
    }));
  }

  function handleServerValidated(errors: PluginManifestValidationError[]) {
    setState((s) => ({ ...s, serverErrors: errors }));
  }

  function handleBindingsChange(bindings: BindingEntry[]) {
    setState((s) => ({ ...s, bindings }));
  }

  function handleRegistered(result: RegisterResult) {
    setState((s) => ({ ...s, registerResult: result, step: 5 }));
  }

  /**
   * Maps daemon rollback codes to wizard steps.
   * Remaining codes stay on Step 4 with the error message surfaced there.
   */
  function handleRollback(code: string, message: string) {
    const targetStep = rollbackStepFor(code);
    setState((s) => ({
      ...s,
      step: targetStep,
      rollbackMessage: message,
    }));
  }

  const declaredSecrets =
    state.clientValidation?.declaredSecrets ?? [];

  return (
    <div className="min-h-[400px]">
      <StepIndicator steps={STEPS} current={state.step} />

      {state.step === 1 && (
        <ManifestUpload
          manifestYaml={state.manifestYaml}
          onChange={(yaml) => setState((s) => ({ ...s, manifestYaml: yaml }))}
          onValidated={handleClientValidated}
          onNext={() => goTo(2)}
        />
      )}

      {state.step === 2 && (
        <ValidateStep
          manifestYaml={state.manifestYaml}
          onValidated={handleServerValidated}
          onNext={() => goTo(3)}
          onBack={() => goTo(1)}
        />
      )}

      {state.step === 3 && (
        <BindingsStep
          declaredSecrets={declaredSecrets}
          bindings={state.bindings}
          onChange={handleBindingsChange}
          onNext={() => goTo(4)}
          onBack={() => goTo(2)}
        />
      )}

      {state.step === 4 && (
        <ConfirmStep
          manifestYaml={state.manifestYaml}
          bindings={state.bindings}
          onBack={() => goTo(3)}
          onRegistered={handleRegistered}
          onRollback={handleRollback}
        />
      )}

      {state.step === 5 && state.registerResult && (
        <EnrollmentStep result={state.registerResult} onDone={onClose} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rollback code → wizard step mapping
// ---------------------------------------------------------------------------

function rollbackStepFor(code: string): WizardStep {
  switch (code) {
    case "manifest_invalid":
    case "already_registered":
      return 1;
    case "binding_failed":
    case "precondition_failed":
      return 3;
    default:
      return 4;
  }
}
