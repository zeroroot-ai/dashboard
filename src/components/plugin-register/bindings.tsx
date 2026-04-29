"use client";

/**
 * Step 3 — Secret Bindings
 *
 * Renders one binding control per secret declared in the manifest.
 * Each control lets the admin choose between:
 *   - "existing": pick from a dropdown of secrets already in the broker.
 *   - "create":   provide an inline value that the server action will store.
 *
 * SECURITY: the "create" value field uses type="password" autoComplete="off"
 * and is never persisted to sessionStorage or localStorage. The value only
 * lives in React state and is forwarded to the server action over HTTPS.
 *
 * Spec: secrets-tenant-lifecycle Task 14, Requirement 2.
 */

import { useEffect, useState } from "react";
import { EyeIcon, EyeOffIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BindingMode = "existing" | "create";

export interface BindingEntry {
  declaredName: string;
  mode: BindingMode;
  existingRef: string;
  createValue: string;
}

export interface BindingsStepProps {
  /** Secret names extracted from the manifest in Step 1. */
  declaredSecrets: string[];
  /** Current binding state (controlled by wizard). */
  bindings: BindingEntry[];
  onChange: (bindings: BindingEntry[]) => void;
  onNext: () => void;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Individual binding row
// ---------------------------------------------------------------------------

interface BindingRowProps {
  entry: BindingEntry;
  onChange: (updated: BindingEntry) => void;
}

function BindingRow({ entry, onChange }: BindingRowProps) {
  const [showValue, setShowValue] = useState(false);

  function setMode(mode: BindingMode) {
    onChange({ ...entry, mode, existingRef: "", createValue: "" });
  }

  function setExistingRef(ref: string) {
    onChange({ ...entry, existingRef: ref });
  }

  function setCreateValue(val: string) {
    onChange({ ...entry, createValue: val });
  }

  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader className="pb-2 pt-3">
        <CardTitle className="font-mono text-xs">{entry.declaredName}</CardTitle>
        <CardDescription className="text-xs">
          Choose how to satisfy this secret declaration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pb-3">
        {/* Mode selector */}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={entry.mode === "existing" ? "default" : "outline"}
            className="text-xs"
            onClick={() => setMode("existing")}
          >
            Use existing secret
          </Button>
          <Button
            type="button"
            size="sm"
            variant={entry.mode === "create" ? "default" : "outline"}
            className="text-xs"
            onClick={() => setMode("create")}
          >
            <PlusIcon className="mr-1 size-3" aria-hidden="true" />
            Create new secret
          </Button>
        </div>

        {/* Existing-secret picker */}
        {entry.mode === "existing" && (
          <div className="space-y-1.5">
            <Label htmlFor={`existing-ref-${entry.declaredName}`} className="text-xs">
              Secret name (broker ref)
            </Label>
            {/* TODO: replace with a server-populated dropdown when the secrets
                list API is wired to this component. For now, a plain text
                input accepts the broker-qualified name directly. */}
            <Input
              id={`existing-ref-${entry.declaredName}`}
              type="text"
              placeholder="cred:my_secret_name"
              value={entry.existingRef}
              onChange={(e) => setExistingRef(e.target.value)}
              className="font-mono text-xs"
              autoComplete="off"
            />
            <p className="text-muted-foreground text-xs">
              Enter the broker-qualified secret name (e.g.{" "}
              <code className="bg-muted rounded px-1 font-mono">cred:api_key</code>
              ).
            </p>
          </div>
        )}

        {/* Inline-create input */}
        {entry.mode === "create" && (
          <div className="space-y-1.5">
            <Label htmlFor={`create-value-${entry.declaredName}`} className="text-xs">
              Secret value
            </Label>
            <div className="relative">
              <Input
                id={`create-value-${entry.declaredName}`}
                type={showValue ? "text" : "password"}
                placeholder="Paste value here"
                value={entry.createValue}
                onChange={(e) => setCreateValue(e.target.value)}
                className="pr-9 font-mono text-xs"
                autoComplete="off"
              />
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground absolute right-2.5 top-1/2 -translate-y-1/2"
                onClick={() => setShowValue((v) => !v)}
                aria-label={showValue ? "Hide secret value" : "Show secret value"}
              >
                {showValue ? (
                  <EyeOffIcon className="size-3.5" aria-hidden="true" />
                ) : (
                  <EyeIcon className="size-3.5" aria-hidden="true" />
                )}
              </button>
            </div>
            <p className="text-muted-foreground text-xs">
              This value will be stored in your tenant broker under the name{" "}
              <code className="bg-muted rounded px-1 font-mono">{entry.declaredName}</code>.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// BindingsStep component
// ---------------------------------------------------------------------------

export function BindingsStep({
  declaredSecrets,
  bindings,
  onChange,
  onNext,
  onBack,
}: BindingsStepProps) {
  // Initialize binding entries when declaredSecrets change (e.g. wizard re-init)
  useEffect(() => {
    if (declaredSecrets.length !== bindings.length) {
      const initialised: BindingEntry[] = declaredSecrets.map((name) => ({
        declaredName: name,
        mode: "existing",
        existingRef: "",
        createValue: "",
      }));
      onChange(initialised);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declaredSecrets]);

  function updateBinding(idx: number, updated: BindingEntry) {
    const next = [...bindings];
    next[idx] = updated;
    onChange(next);
  }

  function isComplete(): boolean {
    return bindings.every((b) => {
      if (b.mode === "existing") return b.existingRef.trim().length > 0;
      if (b.mode === "create") return b.createValue.trim().length > 0;
      return false;
    });
  }

  if (declaredSecrets.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Secret bindings</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            This plugin declares no secrets — no bindings are required.
          </p>
        </div>
        <div className="flex justify-between">
          <Button type="button" variant="outline" size="sm" onClick={onBack}>
            Back
          </Button>
          <Button type="button" size="sm" onClick={onNext}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Secret bindings</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          This plugin declares {declaredSecrets.length} secret
          {declaredSecrets.length !== 1 ? "s" : ""}. For each, choose an
          existing secret from your broker or provide a value to store inline.
        </p>
      </div>

      <div className="space-y-3">
        {bindings.map((entry, idx) => (
          <BindingRow
            key={entry.declaredName}
            entry={entry}
            onChange={(updated) => updateBinding(idx, updated)}
          />
        ))}
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onNext}
          disabled={!isComplete()}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
