"use client";

/**
 * Step 4 — Confirm
 *
 * Renders a summary of the plugin manifest and secret bindings before the
 * final atomic registration submit. Shows what will be created:
 *   - Plugin name, version, methods
 *   - Per-binding: mode (existing / create) and the ref or placeholder
 *
 * SECURITY: "create" binding values are NEVER displayed — only the declared
 * name is shown with a masked placeholder.
 *
 * On "Register plugin", calls registerPluginAtomicAction. On failure, maps
 * the error code back to the relevant wizard step via the provided handler.
 *
 * Spec: secrets-tenant-lifecycle Task 14, Requirement 2.
 */

import { useState } from "react";
import { AlertTriangleIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

import { registerPluginAtomicAction, type RegisterResult } from "@/app/actions/plugin-register";
import type { BindingEntry } from "./bindings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfirmStepProps {
  manifestYaml: string;
  bindings: BindingEntry[];
  onBack: () => void;
  /** Called with the successful registration result to advance to Step 5. */
  onRegistered: (result: RegisterResult) => void;
  /**
   * Called on atomic failure so the wizard can navigate to the relevant step.
   * code is the wizard-step code from registerPluginAtomicAction:
   *   - "manifest_invalid" → Step 1
   *   - "binding_failed"   → Step 3
   *   - others             → stay on confirm with error message
   */
  onRollback: (code: string, message: string) => void;
}

// ---------------------------------------------------------------------------
// Manifest summary parser (minimal — for display only)
// ---------------------------------------------------------------------------

interface ManifestSummary {
  name: string;
  version: string;
  description: string;
  methods: string[];
}

function parseManifestSummary(yaml: string): ManifestSummary {
  const lines = yaml.split("\n");
  let name = "";
  let version = "";
  let description = "";
  const methods: string[] = [];

  let inMethods = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    const nameMatch = trimmed.match(/^name:\s*(.+)$/);
    if (!inMethods && nameMatch && !name) {
      name = nameMatch[1]!.trim();
    }
    const versionMatch = trimmed.match(/^version:\s*(.+)$/);
    if (versionMatch && !version) version = versionMatch[1]!.trim();
    const descMatch = trimmed.match(/^description:\s*(.+)$/);
    if (descMatch && !description) description = descMatch[1]!.trim();

    if (trimmed.startsWith("methods:")) {
      inMethods = true;
      continue;
    }
    if (inMethods) {
      const mNameMatch = trimmed.match(/^name:\s*(.+)$/);
      if (mNameMatch) methods.push(mNameMatch[1]!.trim());
    }
  }

  return { name, version, description, methods };
}

// ---------------------------------------------------------------------------
// ConfirmStep component
// ---------------------------------------------------------------------------

export function ConfirmStep({
  manifestYaml,
  bindings,
  onBack,
  onRegistered,
  onRollback,
}: ConfirmStepProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summary = parseManifestSummary(manifestYaml);

  async function handleRegister() {
    setSubmitting(true);
    setError(null);

    try {
      const bindingsInput = bindings.map((b) => ({
        declaredName: b.declaredName,
        mode: b.mode,
        existingRef: b.existingRef,
        createValue: b.createValue,
      }));

      const result = await registerPluginAtomicAction(manifestYaml, bindingsInput);

      if (!result.ok) {
        const code = result.code ?? "error";
        // If the failure maps to a wizard step, navigate there with the error
        if (code === "manifest_invalid" || code === "binding_failed") {
          onRollback(code, result.error);
        } else {
          setError(result.error);
        }
        return;
      }

      onRegistered(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Review and register</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Review the manifest and bindings below, then click &quot;Register
          plugin&quot;. This is atomic — if anything fails, all created state is
          rolled back.
        </p>
      </div>

      {/* Manifest summary */}
      <Card className="border-border/60 bg-card/60">
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-xs font-medium">Plugin manifest</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pb-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Name</span>
            <span className="font-mono font-medium">{summary.name || "—"}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Version</span>
            <span className="font-mono">{summary.version || "—"}</span>
          </div>
          {summary.description && (
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground w-20 shrink-0">Description</span>
              <span>{summary.description}</span>
            </div>
          )}
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground w-20 shrink-0">Methods</span>
            <div className="flex flex-wrap gap-1">
              {summary.methods.length > 0 ? (
                summary.methods.map((m) => (
                  <Badge key={m} variant="outline" className="font-mono text-xs">
                    {m}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">none declared</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Secret bindings summary */}
      {bindings.length > 0 && (
        <Card className="border-border/60 bg-card/60">
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-xs font-medium">Secret bindings</CardTitle>
            <CardDescription className="text-xs">
              {bindings.length} binding{bindings.length !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="space-y-2">
              {bindings.map((b, idx) => (
                <div key={b.declaredName}>
                  {idx > 0 && <Separator className="my-2" />}
                  <div className="flex items-start gap-2 text-xs">
                    <code className="bg-muted rounded px-1 py-0.5 font-mono">
                      {b.declaredName}
                    </code>
                    <span className="text-muted-foreground">→</span>
                    {b.mode === "existing" ? (
                      <code className="bg-muted rounded px-1 py-0.5 font-mono">
                        {b.existingRef}
                      </code>
                    ) : (
                      <span className="text-muted-foreground italic">
                        new secret (value hidden)
                      </span>
                    )}
                    <Badge
                      variant="outline"
                      className={
                        b.mode === "existing"
                          ? "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          : "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400"
                      }
                    >
                      {b.mode === "existing" ? "existing" : "create"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error alert */}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTriangleIcon className="size-4" aria-hidden="true" />
          <AlertTitle>Registration failed</AlertTitle>
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBack}
          disabled={submitting}
        >
          Back
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void handleRegister()}
          disabled={submitting}
        >
          {submitting && (
            <Loader2Icon className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
          )}
          {submitting ? "Registering…" : "Register plugin"}
        </Button>
      </div>
    </div>
  );
}
