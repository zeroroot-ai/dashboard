"use client";

/**
 * AgentInstallDialog — per-action approval UI for agent installation.
 *
 * Flow: validate the agent's manifest via DiscoveryService.ValidateComponent,
 * render the requested permissions as an RWXMatrix in `approve` mode
 * pre-checked iff `(requested && callerHasAccess)` (or all-checked in
 * prosumer mode), gather user confirmation, then call installAgentAction
 * to write the approved `component_<action>_enabled` tuples in one batch
 * with compensating delete on failure.
 *
 * Spec: access-matrix-finish task 15, R5.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { parse as parseYaml } from "yaml";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  RWXMatrix,
  type RWXAction,
  type RWXItem,
} from "@/components/gibson/shared/RWXMatrix";
import { useTierLimits } from "@/src/hooks/useTierLimits";

import {
  validateAgentManifestAction,
  type AccessError,
  type ManifestValidationResult,
  type ValidationError,
} from "@/app/actions/read/validateAgentManifest";
import { installAgentAction } from "@/app/actions/crd/installAgent";
import type { InstallApproval } from "@/app/actions/crd/installAgent.types";
import { listAccessibleComponentsAction } from "@/app/actions/read/listAccessibleComponents";

export interface AgentInstallDialogProps {
  open: boolean;
  onClose: (result?: { agentInstallationId: string }) => void;
  agentSlug: string;
  componentYaml: string;
  permissionsYaml: string;
}

interface PermissionRequest {
  target: string;
  action: RWXAction;
  required: boolean;
}

interface ApprovalRow {
  target: string;
  read: { requested: boolean; required: boolean; approved: boolean; canGrant: boolean };
  write: { requested: boolean; required: boolean; approved: boolean; canGrant: boolean };
  execute: { requested: boolean; required: boolean; approved: boolean; canGrant: boolean };
}

// parseManifestPermissions extracts the `permissions.yaml` request list.
// We keep the parser permissive: unknown keys are ignored, missing lists
// treated as empty, and type-coerce action strings.
function parseManifestPermissions(yaml: string): PermissionRequest[] {
  if (!yaml.trim()) return [];
  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const root = parsed as { permissions?: unknown };
  if (!Array.isArray(root.permissions)) return [];
  const out: PermissionRequest[] = [];
  for (const item of root.permissions) {
    if (!item || typeof item !== "object") continue;
    const r = item as {
      target?: string;
      action?: string;
      actions?: string[];
      required?: boolean;
    };
    if (!r.target) continue;
    const required = r.required === true;
    const actions = r.actions ?? (r.action ? [r.action] : []);
    for (const a of actions) {
      if (a === "read" || a === "write" || a === "execute") {
        out.push({ target: r.target, action: a, required });
      }
    }
  }
  return out;
}

function groupRequests(
  requests: PermissionRequest[],
  callerAccessMap: Map<string, { read: boolean; write: boolean; execute: boolean }>,
): ApprovalRow[] {
  const byTarget = new Map<string, ApprovalRow>();
  for (const req of requests) {
    let row = byTarget.get(req.target);
    if (!row) {
      const empty = { requested: false, required: false, approved: false, canGrant: false };
      row = {
        target: req.target,
        read: { ...empty },
        write: { ...empty },
        execute: { ...empty },
      };
      byTarget.set(req.target, row);
    }
    const slot = row[req.action];
    slot.requested = true;
    slot.required = slot.required || req.required;
    const caller = callerAccessMap.get(req.target);
    slot.canGrant = caller ? caller[req.action] === true : false;
    // Default check: requested && canGrant (caller has the grant authority).
    slot.approved = slot.canGrant;
  }
  return Array.from(byTarget.values());
}

function approvalsFromRows(rows: ApprovalRow[]): InstallApproval[] {
  const out: InstallApproval[] = [];
  for (const row of rows) {
    for (const action of ["read", "write", "execute"] as const) {
      const slot = row[action];
      if (slot.requested && slot.approved) {
        out.push({ target: row.target, action, required: slot.required });
      }
    }
  }
  return out;
}

function hasBlockedRequired(rows: ApprovalRow[]): boolean {
  for (const row of rows) {
    for (const action of ["read", "write", "execute"] as const) {
      const slot = row[action];
      if (slot.requested && slot.required && !slot.canGrant) return true;
    }
  }
  return false;
}

function droppedOptional(rows: ApprovalRow[]): Array<{ target: string; action: RWXAction }> {
  const out: Array<{ target: string; action: RWXAction }> = [];
  for (const row of rows) {
    for (const action of ["read", "write", "execute"] as const) {
      const slot = row[action];
      if (slot.requested && !slot.required && !slot.approved) {
        out.push({ target: row.target, action });
      }
    }
  }
  return out;
}

function matrixItems(rows: ApprovalRow[]): RWXItem[] {
  return rows.map((row) => ({
    name: row.target,
    displayName: row.target,
    description: [
      row.read.requested ? `R${row.read.required ? "*" : ""}` : "",
      row.write.requested ? `W${row.write.required ? "*" : ""}` : "",
      row.execute.requested ? `X${row.execute.required ? "*" : ""}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    rwx: {
      read: row.read.approved,
      write: row.write.approved,
      execute: row.execute.approved,
    },
    denyingGates: [],
  }));
}

export function AgentInstallDialog({
  open,
  onClose,
  agentSlug,
  componentYaml,
  permissionsYaml,
}: AgentInstallDialogProps) {
  const { data: tier } = useTierLimits();

  const [validation, setValidation] = useState<
    ManifestValidationResult | null
  >(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const loadValidation = useCallback(async () => {
    setLoading(true);
    setInstallError(null);

    const v = await validateAgentManifestAction({
      componentYaml,
      permissionsYaml,
    });
    if (!v.ok) {
      setValidationError(v.error);
      setLoading(false);
      return;
    }
    setValidation(v.data);

    const accessible = await listAccessibleComponentsAction({ kind: "all" });
    const map = new Map<string, { read: boolean; write: boolean; execute: boolean }>();
    if (accessible.ok) {
      for (const item of accessible.data) {
        const ref = `component:${item.kind}/${item.name}`;
        map.set(ref, item.rwx);
      }
    }

    const requests = parseManifestPermissions(permissionsYaml);
    setRows(groupRequests(requests, map));
    setLoading(false);
  }, [componentYaml, permissionsYaml]);

  useEffect(() => {
    if (!open) return;
    loadValidation();
  }, [open, loadValidation]);

  function onToggle(item: RWXItem, action: RWXAction, enabled: boolean) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.target !== item.name) return row;
        const slot = row[action];
        if (!slot.requested) return row;
        if (enabled && !slot.canGrant) return row; // cannot grant what you lack
        return {
          ...row,
          [action]: { ...slot, approved: enabled },
        };
      }),
    );
  }

  async function handleConfirm() {
    setInstalling(true);
    setInstallError(null);
    const approvals = approvalsFromRows(rows);
    const result = await installAgentAction({
      agentSlug,
      componentYaml,
      permissionsYaml,
      approvals,
    });
    setInstalling(false);
    if (!result.ok) {
      setInstallError(
        `Install was rolled back: ${result.error}. No access was granted.`,
      );
      return;
    }
    onClose({ agentInstallationId: result.data.agentInstallationId });
  }

  const items = useMemo(() => matrixItems(rows), [rows]);
  const blockedRequired = hasBlockedRequired(rows);
  const dropped = droppedOptional(rows);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Install {agentSlug}</DialogTitle>
          <DialogDescription>
            Approve the access this agent requests. Required items that you
            don&apos;t have will block install; optional items will be
            silently excluded with a warning.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Validating manifest…
          </div>
        )}

        {!loading && validationError && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertDescription className="text-xs">
              {validationError}
            </AlertDescription>
          </Alert>
        )}

        {!loading && validation && (
          <>
            {validation.schemaErrors.length > 0 && (
              <SchemaErrorList errors={validation.schemaErrors} />
            )}

            {validation.accessErrors.length > 0 && (
              <AccessErrorList errors={validation.accessErrors} />
            )}

            {validation.schemaErrors.length === 0 && rows.length > 0 && (
              <div className="max-h-72 overflow-auto border rounded-md">
                <RWXMatrix
                  items={items}
                  onToggle={onToggle}
                  mode="approve"
                />
              </div>
            )}

            {blockedRequired && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertDescription className="text-xs">
                  This agent requires access you don&apos;t currently hold.
                  Ask your tenant admin to enable it before installing.
                </AlertDescription>
              </Alert>
            )}

            {dropped.length > 0 && !blockedRequired && (
              <Alert>
                <ShieldCheck className="size-4" />
                <AlertDescription className="text-xs">
                  Optional requests skipped:{" "}
                  {dropped
                    .map((d) => `${d.target}:${d.action}`)
                    .join(", ")}
                </AlertDescription>
              </Alert>
            )}

            {installError && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" />
                <AlertDescription className="text-xs">
                  {installError}
                </AlertDescription>
              </Alert>
            )}
          </>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onClose()}
            disabled={installing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              loading ||
              !!validationError ||
              installing ||
              blockedRequired ||
              (!!validation && validation.schemaErrors.length > 0)
            }
          >
            {installing ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" /> Installing…
              </>
            ) : (
              `Install with ${approvalsFromRows(rows).length} grants`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SchemaErrorList({ errors }: { errors: ValidationError[] }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" />
      <AlertDescription className="text-xs">
        <p className="font-medium mb-1">Manifest schema errors — fix upstream and re-upload.</p>
        <ul className="list-disc list-inside space-y-0.5">
          {errors.map((e, i) => (
            <li key={i}>
              <code>{e.path || "(root)"}</code>: {e.message}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function AccessErrorList({ errors }: { errors: AccessError[] }) {
  const blocking = errors.filter((e) => e.required);
  if (blocking.length === 0) return null;
  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" />
      <AlertDescription className="text-xs">
        <p className="font-medium mb-1">Required access not available:</p>
        <ul className="list-disc list-inside space-y-0.5">
          {blocking.map((e, i) => (
            <li key={i}>
              <code>
                {e.target}:{e.action}
              </code>{" "}
              — {e.reason || "denied by current policy"}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
