"use client";

/**
 * DeleteModal — Confirmation dialog to delete a secret.
 *
 * Shows affected plugin associations (from SecretMetadata.pluginAssociations)
 * and requires the user to type the secret name to confirm before deletion.
 *
 * On confirm: calls deleteSecretAction and navigates to the list.
 *
 * Spec: secrets-tenant-lifecycle Task 12, Requirement 1.1.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, Loader2Icon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { deleteSecretAction } from "@/app/actions/secrets";

export interface DeleteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretName: string;
  /** Plugin install IDs that will lose access on deletion. */
  affectedPlugins: string[];
  /** Called after successful deletion (before navigation). */
  onDeleted?: () => void;
}

export function DeleteModal({
  open,
  onOpenChange,
  secretName,
  affectedPlugins,
  onDeleted,
}: DeleteModalProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmText, setConfirmText] = React.useState("");

  const confirmMatch = confirmText === secretName;

  function handleClose(open: boolean) {
    if (!pending) {
      setError(null);
      setConfirmText("");
      onOpenChange(open);
    }
  }

  async function handleDelete() {
    if (!confirmMatch) return;
    setError(null);
    setPending(true);

    try {
      const result = await deleteSecretAction(secretName);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onDeleted?.();
      onOpenChange(false);
      router.push("/dashboard/pages/settings/secrets?deleted=1");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangleIcon className="h-5 w-5 text-destructive" aria-hidden="true" />
            Delete secret
          </DialogTitle>
          <DialogDescription>
            This will permanently remove{" "}
            <code className="text-foreground rounded bg-muted px-1 py-0.5 text-sm font-mono">
              {secretName}
            </code>{" "}
            from your secrets backend. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Affected plugins */}
          {affectedPlugins.length > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 space-y-2">
              <p className="text-sm font-medium text-destructive">
                {affectedPlugins.length} plugin{affectedPlugins.length !== 1 ? "s" : ""} will lose
                access to this secret:
              </p>
              <ul className="flex flex-wrap gap-1.5" aria-label="Affected plugins">
                {affectedPlugins.map((pluginId) => (
                  <li key={pluginId}>
                    <Badge variant="outline" className="font-mono text-xs">
                      {pluginId}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground text-xs">
                These plugins will fail to resolve this secret after deletion. Remove
                their FGA bindings first via Settings &rarr; Plugins if you want to
                decommission cleanly.
              </p>
            </div>
          )}

          {/* Confirm by name */}
          <div className="space-y-2">
            <Label htmlFor="delete-confirm">
              Type{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-sm font-mono">
                {secretName}
              </code>{" "}
              to confirm
            </Label>
            <Input
              id="delete-confirm"
              type="text"
              autoComplete="off"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={secretName}
              disabled={pending}
              aria-describedby="delete-confirm-hint"
              className="font-mono"
            />
            <p id="delete-confirm-hint" className="text-muted-foreground text-xs">
              This is case-sensitive.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={!confirmMatch || pending}
            aria-disabled={!confirmMatch || pending}
          >
            {pending ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Deleting...
              </>
            ) : (
              "Delete secret"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
