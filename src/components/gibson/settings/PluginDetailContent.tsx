"use client";

/**
 * PluginDetailContent
 *
 * Client component rendering the full plugin install detail page:
 *   - Manifest summary (name, version, runtime mode, methods, policy)
 *   - Live status badge (SERVING / UNREACHABLE / DEGRADED / PENDING)
 *   - Secret bindings table with per-row Edit and Revoke actions
 *   - Recent invocations widget (TODO: wire when invocation data source is available)
 *
 * The component receives the initial install summary from the server component
 * and manages the bindings-table mutation state client-side.
 *
 * Spec: secrets-tenant-lifecycle Task 15, Requirement 2.3.
 */

import { useState } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ClockIcon,
  Loader2Icon,
  PencilIcon,
  ServerIcon,
  TrashIcon,
  WifiOffIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import {
  editPluginBindingAction,
  revokePluginBindingAction,
} from "@/app/actions/plugin-bindings";
import type { PluginInstallSummary } from "@/src/gen/gibson/tenant/v1/plugin_admin_pb";
import { useAuthorize } from "@/src/lib/auth/use-authorize";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUnixTs(unixBigInt: bigint | undefined): string {
  if (!unixBigInt || unixBigInt === BigInt(0)) return "-";
  try {
    return new Date(Number(unixBigInt) * 1000).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "-";
  }
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: number }) {
  // PluginInstallStatus enum values from generated proto:
  // 0 = UNSPECIFIED, 1 = SERVING, 2 = UNREACHABLE, 3 = DEGRADED
  switch (status) {
    case 1:
      return (
        <Badge className="border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400">
          <CheckCircle2Icon className="mr-1 size-3" aria-hidden="true" />
          Serving
        </Badge>
      );
    case 2:
      return (
        <Badge className="border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400">
          <WifiOffIcon className="mr-1 size-3" aria-hidden="true" />
          Unreachable
        </Badge>
      );
    case 3:
      return (
        <Badge className="border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400">
          <AlertTriangleIcon className="mr-1 size-3" aria-hidden="true" />
          Degraded
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <ClockIcon className="mr-1 size-3" aria-hidden="true" />
          Pending
        </Badge>
      );
  }
}

// ---------------------------------------------------------------------------
// Editable binding row
// ---------------------------------------------------------------------------

interface BindingRowProps {
  installId: string;
  declaredName: string;
  existingRef: string;
  onUpdate: (declaredName: string, newRef: string) => void;
  onRevoke: (declaredName: string) => void;
  /** Whether the current user is authorized to edit this binding. */
  canEdit: boolean;
  /** Whether the current user is authorized to revoke this binding. */
  canRevoke: boolean;
}

function BindingRow({
  installId,
  declaredName,
  existingRef,
  onUpdate,
  onRevoke,
  canEdit,
  canRevoke,
}: BindingRowProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(existingRef);
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);

  async function handleSaveEdit() {
    if (!editValue.trim() || editValue === existingRef) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const result = await editPluginBindingAction(
      installId,
      declaredName,
      editValue.trim(),
    );
    if (result.ok) {
      onUpdate(declaredName, editValue.trim());
      setEditing(false);
      toast.success("Binding updated");
    } else {
      toast.error(`Update failed: ${result.error ?? "Unknown error"}`);
    }
    setSaving(false);
  }

  async function handleRevoke() {
    setRevoking(true);
    const result = await revokePluginBindingAction(installId, declaredName);
    if (result.ok) {
      onRevoke(declaredName);
      toast.success("Binding revoked");
    } else {
      toast.error(`Revoke failed: ${result.error ?? "Unknown error"}`);
      setRevoking(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{declaredName}</TableCell>
      <TableCell className="text-xs">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="h-7 font-mono text-xs"
              autoComplete="off"
              aria-label={`New ref for ${declaredName}`}
            />
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void handleSaveEdit()}
              disabled={saving}
            >
              {saving && (
                <Loader2Icon
                  className="mr-1 size-3 animate-spin"
                  aria-hidden="true"
                />
              )}
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setEditValue(existingRef);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
            {existingRef || "-"}
          </code>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {canEdit && !editing && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => {
                setEditValue(existingRef);
                setEditing(true);
              }}
              aria-label={`Edit binding for ${declaredName}`}
            >
              <PencilIcon className="size-3.5" aria-hidden="true" />
            </Button>
          )}
          {canRevoke && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive size-7"
              onClick={() => void handleRevoke()}
              disabled={revoking}
              aria-label={`Revoke binding for ${declaredName}`}
            >
              {revoking ? (
                <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <TrashIcon className="size-3.5" aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

export interface PluginDetailContentProps {
  install: PluginInstallSummary;
}

// ---------------------------------------------------------------------------
// PluginDetailContent
// ---------------------------------------------------------------------------

export function PluginDetailContent({ install }: PluginDetailContentProps) {
  // Local mutable bindings list for optimistic edit/revoke
  const [bindings, setBindings] = useState<string[]>(
    install.boundSecretRefs ?? [],
  );
  const [bindingError, setBindingError] = useState<string | null>(null);

  // Authz gates: hide Edit / Revoke buttons for non-admins.
  // Loading=true → treat as not-allowed to prevent FOUC.
  // Spec: dashboard-authz-ui-gating Task 13, Requirement 5.3.
  const { allowed: canEdit, loading: editLoading } = useAuthorize(
    "/gibson.tenant.v1.PluginAdminService/EditPluginSecretBinding",
  );
  const { allowed: canRevoke, loading: revokeLoading } = useAuthorize(
    "/gibson.tenant.v1.PluginAdminService/RevokePluginSecretBinding",
  );
  const allowEdit = !editLoading && canEdit;
  const allowRevoke = !revokeLoading && canRevoke;

  function handleUpdate(declaredName: string, newRef: string) {
    setBindings((prev) =>
      prev.map((ref) => (ref === declaredName ? newRef : ref)),
    );
  }

  function handleRevoke(declaredName: string) {
    setBindings((prev) => prev.filter((ref) => ref !== declaredName));
  }

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold">{install.name}</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Install ID:{" "}
            <code className="bg-muted rounded px-1 font-mono">
              {install.installId}
            </code>
          </p>
        </div>
        <StatusBadge status={install.status} />
      </div>

      {/* Manifest summary */}
      <Card className="border-border/60 bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ServerIcon className="size-4" aria-hidden="true" />
            Manifest summary
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pb-4 text-xs sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground mb-0.5 font-medium">Version</p>
            <p className="font-mono">{install.version || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-0.5 font-medium">Runtime</p>
            <p className="font-mono">{install.runtimeMode || "process"}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-0.5 font-medium">Setec</p>
            <p>{install.setecRequired ? "Required" : "Not required"}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-0.5 font-medium">Registered</p>
            <p>{formatUnixTs(install.createdAtUnix)}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-0.5 font-medium">Last heartbeat</p>
            <p>{formatUnixTs(install.lastHeartbeatAtUnix)}</p>
          </div>
          {install.address && (
            <div>
              <p className="text-muted-foreground mb-0.5 font-medium">Address</p>
              <p className="font-mono">{install.address}</p>
            </div>
          )}
          {install.declaredMethods.length > 0 && (
            <div className="col-span-full">
              <p className="text-muted-foreground mb-1 font-medium">Methods</p>
              <div className="flex flex-wrap gap-1">
                {install.declaredMethods.map((m) => (
                  <Badge key={m} variant="outline" className="font-mono text-xs">
                    {m}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Secret bindings table */}
      <Card className="border-border/60 bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Secret bindings</CardTitle>
          <CardDescription className="text-xs">
            FGA{" "}
            <code className="bg-muted rounded px-1 font-mono">can_resolve</code>{" "}
            tuples granting this plugin access to secrets. Use Edit to rebind
            to a different secret ref; Revoke removes the tuple and emits an
            audit event.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-4">
          {bindingError && (
            <Alert variant="destructive" className="mb-3">
              <AlertTriangleIcon className="size-4" aria-hidden="true" />
              <AlertTitle>Action failed</AlertTitle>
              <AlertDescription className="text-xs">
                {bindingError}
              </AlertDescription>
            </Alert>
          )}

          {bindings.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No secret bindings. Register the plugin again with declared
              secrets to add bindings.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Declared name</TableHead>
                    <TableHead className="text-xs">Broker ref</TableHead>
                    <TableHead className="text-right text-xs">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bindings.map((ref) => (
                    <BindingRow
                      key={ref}
                      installId={install.installId}
                      declaredName={ref}
                      existingRef={ref}
                      onUpdate={handleUpdate}
                      onRevoke={handleRevoke}
                      canEdit={allowEdit}
                      canRevoke={allowRevoke}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent invocations widget */}
      <Card className="border-border/60 bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent invocations</CardTitle>
          <CardDescription className="text-xs">
            Last invocations received by this plugin install.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-4">
          {/*
           * TODO: Wire to invocation data source when available.
           *
           * The daemon's plugin runtime registry (Spec 2) tracks per-install
           * invocation events. The dashboard admin RPC surface (Spec 4 Phase 1)
           * does not yet expose a ListPluginInvocations RPC, add it to
           * PluginsAdminService when the invocation tracking store is
           * implemented.
           *
           * Data source: gibson.admin.v1.PluginsAdminService.ListPluginInvocations
           * (not yet defined in plugins.proto as of Spec 4 Task 3).
           */}
          <p className="text-muted-foreground text-xs">
            Invocation history is not yet available. The{" "}
            <code className="bg-muted rounded px-1 font-mono">
              ListPluginInvocations
            </code>{" "}
            RPC will be added to{" "}
            <code className="bg-muted rounded px-1 font-mono">
              gibson.admin.v1.PluginsAdminService
            </code>{" "}
            when the invocation tracking store is implemented.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
