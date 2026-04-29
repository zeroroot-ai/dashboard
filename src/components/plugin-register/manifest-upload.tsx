"use client";

/**
 * Step 1 — Manifest Upload
 *
 * Accepts a plugin manifest via file picker or paste textarea.
 * Performs client-side structural validation (YAML parse + required fields)
 * and renders line-numbered errors before allowing the user to advance to
 * Step 2 (server-side validate).
 *
 * State is held in the wizard and passed down; this component is
 * intentionally stateless beyond local UI affordances.
 *
 * Spec: secrets-tenant-lifecycle Task 14, Requirement 2.
 */

import { useRef, useState } from "react";
import { AlertTriangleIcon, FileTextIcon, UploadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// ---------------------------------------------------------------------------
// Client-side manifest validation types
// ---------------------------------------------------------------------------

export interface ManifestParseError {
  line: number;
  field: string;
  message: string;
}

export interface ClientValidationResult {
  ok: boolean;
  errors: ManifestParseError[];
  /** Parsed secret declarations so Step 3 can render binding controls. */
  declaredSecrets: string[];
}

// ---------------------------------------------------------------------------
// Client-side validation (structural only — full semantic validation in Step 2)
// ---------------------------------------------------------------------------

/**
 * Very lightweight YAML structural check that runs entirely in the browser.
 * We do NOT import a full YAML parser to keep bundle size controlled; instead
 * we look for the required top-level keys with simple line-by-line scanning.
 * The real validation happens server-side in Step 2 via validatePluginManifestAction.
 */
function validateManifestClientSide(yaml: string): ClientValidationResult {
  const errors: ManifestParseError[] = [];
  const declaredSecrets: string[] = [];

  if (!yaml || yaml.trim().length === 0) {
    return {
      ok: false,
      errors: [{ line: 1, field: "root", message: "Manifest is empty" }],
      declaredSecrets: [],
    };
  }

  const lines = yaml.split("\n");

  // Check apiVersion
  const apiVersionLine = lines.findIndex((l) =>
    l.trimStart().startsWith("apiVersion:"),
  );
  if (apiVersionLine === -1) {
    errors.push({
      line: 1,
      field: "apiVersion",
      message: "Missing required field: apiVersion",
    });
  } else {
    const val = lines[apiVersionLine]!.split(":").slice(1).join(":").trim();
    if (!val.includes("plugin.gibson.zero-day.ai")) {
      errors.push({
        line: apiVersionLine + 1,
        field: "apiVersion",
        message: `Expected plugin.gibson.zero-day.ai/v1, got: ${val}`,
      });
    }
  }

  // Check kind
  const kindLine = lines.findIndex((l) => l.trimStart().startsWith("kind:"));
  if (kindLine === -1) {
    errors.push({ line: 1, field: "kind", message: "Missing required field: kind" });
  } else {
    const val = lines[kindLine]!.split(":").slice(1).join(":").trim();
    if (val !== "Plugin") {
      errors.push({
        line: kindLine + 1,
        field: "kind",
        message: `Expected kind: Plugin, got: ${val}`,
      });
    }
  }

  // Check metadata.name
  const hasMetadata = lines.some((l) => l.trimStart().startsWith("metadata:"));
  if (!hasMetadata) {
    errors.push({ line: 1, field: "metadata", message: "Missing required section: metadata" });
  }

  // Check spec.workload_class
  const hasSpec = lines.some((l) => l.trimStart().startsWith("spec:"));
  if (!hasSpec) {
    errors.push({ line: 1, field: "spec", message: "Missing required section: spec" });
  }

  // Extract declared secrets (spec.secrets[].name) for Step 3 binding UI.
  // We scan for indented "- name:" entries that follow a "secrets:" line.
  let inSecrets = false;
  let secretsIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    if (trimmed.startsWith("secrets:")) {
      inSecrets = true;
      secretsIndent = indent;
      continue;
    }

    if (inSecrets) {
      // Exit secrets block when we hit a sibling key at the same indent level
      if (indent <= secretsIndent && trimmed.length > 0 && !trimmed.startsWith("-")) {
        inSecrets = false;
        continue;
      }
      const nameMatch = trimmed.match(/^name:\s*(.+)$/);
      if (nameMatch) {
        const secretName = nameMatch[1]!.trim();
        if (secretName.length > 0) {
          declaredSecrets.push(secretName);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    declaredSecrets,
  };
}

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

export interface ManifestUploadProps {
  /** Current manifest YAML string (controlled by wizard). */
  manifestYaml: string;
  onChange: (yaml: string) => void;
  onValidated: (result: ClientValidationResult) => void;
  /** Advance to Step 2. Only enabled when client-side validation passes. */
  onNext: () => void;
}

// ---------------------------------------------------------------------------
// ManifestUpload component
// ---------------------------------------------------------------------------

export function ManifestUpload({
  manifestYaml,
  onChange,
  onValidated,
  onNext,
}: ManifestUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [clientErrors, setClientErrors] = useState<ManifestParseError[]>([]);
  const [hasValidated, setHasValidated] = useState(false);

  function handleTextChange(value: string) {
    onChange(value);
    // Reset validation state when the user edits
    setHasValidated(false);
    setClientErrors([]);
  }

  function handleValidate() {
    const result = validateManifestClientSide(manifestYaml);
    setClientErrors(result.errors);
    setHasValidated(true);
    onValidated(result);
    if (result.ok) {
      onNext();
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") {
        handleTextChange(text);
      }
    };
    reader.readAsText(file);
    // Reset the input so the same file can be re-selected after a change
    e.target.value = "";
  }

  const isValid = hasValidated && clientErrors.length === 0;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Plugin manifest</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Upload or paste your{" "}
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
            plugin.yaml
          </code>{" "}
          manifest. The manifest declares the plugin&apos;s identity, methods, and
          required secrets.
        </p>
      </div>

      {/* File picker */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon className="mr-1.5 size-3.5" aria-hidden="true" />
          Upload file
        </Button>
        <span className="text-muted-foreground text-xs">
          or paste the YAML below
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".yaml,.yml"
          className="sr-only"
          aria-label="Upload manifest YAML file"
          onChange={handleFileChange}
        />
      </div>

      {/* Textarea */}
      <div className="space-y-1.5">
        <Label htmlFor="manifest-yaml" className="text-xs font-medium">
          Manifest YAML
        </Label>
        <Textarea
          id="manifest-yaml"
          placeholder={MANIFEST_PLACEHOLDER}
          value={manifestYaml}
          onChange={(e) => handleTextChange(e.target.value)}
          className="font-mono text-xs"
          rows={18}
          spellCheck={false}
          aria-describedby={
            clientErrors.length > 0 ? "manifest-errors" : undefined
          }
          aria-invalid={hasValidated && clientErrors.length > 0}
        />
      </div>

      {/* Line-numbered errors */}
      {hasValidated && clientErrors.length > 0 && (
        <Alert variant="destructive" id="manifest-errors" role="alert">
          <AlertTriangleIcon className="size-4" aria-hidden="true" />
          <AlertTitle>Manifest validation errors</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-0.5 text-xs">
              {clientErrors.map((err, idx) => (
                <li key={idx} className="font-mono">
                  <span className="text-destructive-foreground/70">
                    Line {err.line}
                  </span>{" "}
                  [{err.field}] {err.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Success badge */}
      {isValid && (
        <Alert className="border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400">
          <FileTextIcon className="size-4" aria-hidden="true" />
          <AlertTitle>Manifest looks valid</AlertTitle>
          <AlertDescription className="text-xs">
            Basic structure checks passed. Proceeding to server-side validation.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          onClick={handleValidate}
          disabled={!manifestYaml.trim()}
        >
          Validate &amp; continue
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placeholder YAML shown in the empty textarea
// ---------------------------------------------------------------------------

const MANIFEST_PLACEHOLDER = `apiVersion: plugin.gibson.zero-day.ai/v1
kind: Plugin
metadata:
  name: my-plugin
  version: 1.0.0
  description: My plugin description
spec:
  workload_class: plugin
  secrets:
    - name: cred:api_key
      scope: startup
      rotation: live
      required: true
  methods:
    - name: DoSomething
      request_proto: acme.v1.DoSomethingRequest
      response_proto: acme.v1.DoSomethingResponse
  runtime: process`;
