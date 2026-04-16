"use client";

/**
 * APIKeysContent
 * API key management panel for Gibson settings.
 */

import * as React from "react";
import { AlertCircle, Copy, KeyRound, Loader2, Plus, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  useAPIKeys,
  useCreateAPIKey,
  useRevokeAPIKey,
} from "@/src/hooks/useAPIKeys";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type APIKeyStatus = "active" | "revoked" | "expired";

// ---------------------------------------------------------------------------
// Component scope parsing
// ---------------------------------------------------------------------------

function parseComponentFromName(name?: string): { type: string; label: string } | null {
  if (!name) return null;
  const prefixes = ["tool-", "agent-", "plugin-"] as const;
  for (const prefix of prefixes) {
    if (name.startsWith(prefix)) {
      return { type: prefix.slice(0, -1), label: name.slice(prefix.length) };
    }
  }
  return null;
}

const STATUS_BADGE_CLASS: Record<APIKeyStatus, string> = {
  active: "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400",
  revoked: "border-destructive/40 bg-destructive/10 text-destructive",
  expired: "border-border text-muted-foreground",
};

// ---------------------------------------------------------------------------
// Generate key dialog
// ---------------------------------------------------------------------------

interface GenerateKeyDialogProps {
  onGenerated: (token: string) => void;
}

function GenerateKeyDialog({ onGenerated }: GenerateKeyDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");

  const { mutate: createKey, isPending } = useCreateAPIKey();

  // useCreateAPIKey stores the one-time token internally; we also receive it
  // via onSuccess so we can surface the reveal dialog.
  function handleGenerate() {
    if (!name.trim()) return;
    createKey(
      { name: name.trim() },
      {
        onSuccess: (result) => {
          if (result.key.token) {
            onGenerated(result.key.token);
          }
          toast.success("API key created — copy it now");
          setOpen(false);
          setName("");
        },
        onError: (err) => {
          toast.error("Failed to create API key", { description: err.message });
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 text-xs">
          <Plus className="size-3.5" />
          Generate new key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Generate API key</DialogTitle>
          <DialogDescription className="text-xs">
            The key token is shown only once. Store it securely immediately after creation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="key-name" className="text-xs">
              Key name
            </Label>
            <Input
              id="key-name"
              placeholder="e.g. CI/CD Pipeline"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-xs"
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              disabled={isPending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="text-xs"
            disabled={!name.trim() || isPending}
            onClick={handleGenerate}
          >
            {isPending && <Loader2 className="size-3 animate-spin" />}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Newly created key reveal dialog
// ---------------------------------------------------------------------------

interface NewKeyRevealDialogProps {
  token: string | null;
  onDismiss: () => void;
}

function NewKeyRevealDialog({ token, onDismiss }: NewKeyRevealDialogProps) {
  function copyToken() {
    if (token) {
      navigator.clipboard.writeText(token);
      toast.success("Token copied to clipboard");
    }
  }

  return (
    <Dialog open={!!token} onOpenChange={(o) => !o && onDismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Key created — copy now</DialogTitle>
          <DialogDescription className="text-xs">
            This token will <strong>not</strong> be shown again. Copy it before closing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label className="text-xs">Token</Label>
          <div className="flex gap-2">
            <Input
              readOnly
              value={token ?? ""}
              className="font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
            <Button size="icon" variant="outline" onClick={copyToken} aria-label="Copy token">
              <Copy className="size-3.5" />
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" className="text-xs" onClick={onDismiss}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton rows
// ---------------------------------------------------------------------------

function KeyRowSkeleton() {
  return (
    <TableRow>
      <TableCell className="py-3">
        <Skeleton className="h-3.5 w-28" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-40 font-mono" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-14 rounded-full" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-24 rounded-full" />
      </TableCell>
      <TableCell />
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function APIKeysContent() {
  const { data, isLoading, isError, error } = useAPIKeys();
  const { mutate: revokeKey } = useRevokeAPIKey();

  const keys = data?.keys ?? [];

  // One-time token state (shown immediately after key creation)
  const [newToken, setNewToken] = React.useState<string | null>(null);

  function handleRevoke(id: string, name: string) {
    revokeKey(id, {
      onSuccess: () => {
        toast.success(`API key "${name}" revoked`);
      },
      onError: (err) => {
        toast.error(`Failed to revoke "${name}"`, { description: err.message });
      },
    });
  }

  const activeCount = keys.filter((k) => k.status === "active").length;
  const revokedCount = keys.filter((k) => k.status === "revoked").length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">API Keys</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Keys authenticate programmatic access to the Gibson API. Revoke unused keys promptly.
          </p>
        </div>
        <GenerateKeyDialog onGenerated={setNewToken} />
      </div>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription className="text-xs">
            {error?.message ?? "Failed to load API keys."}
          </AlertDescription>
        </Alert>
      )}

      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-0">
          <CardTitle className="flex items-center gap-2 text-sm">
            <KeyRound className="text-primary size-4" />
            Active keys
          </CardTitle>
          <CardDescription className="text-xs">
            {isLoading ? (
              <Skeleton className="inline-block h-3 w-32" />
            ) : (
              `${activeCount} active / ${revokedCount} revoked`
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-3">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Key</TableHead>
                <TableHead className="text-xs">Created</TableHead>
                <TableHead className="text-xs">Last used</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Component</TableHead>
                <TableHead className="w-16 text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <>
                  <KeyRowSkeleton />
                  <KeyRowSkeleton />
                </>
              ) : keys.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-xs text-muted-foreground"
                  >
                    No API keys. Generate one above to get started.
                  </TableCell>
                </TableRow>
              ) : (
                keys.map((key) => (
                  <TableRow key={key.id} className="hover:bg-muted/40">
                    <TableCell className="py-3 text-xs font-medium">{key.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {"gbsn_****" + key.id.slice(-6)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {key.createdAt.slice(0, 10)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {key.lastUsedAt ? key.lastUsedAt.slice(0, 10) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={STATUS_BADGE_CLASS[key.status as APIKeyStatus] ?? ""}
                      >
                        {key.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const component = parseComponentFromName(key.name);
                        return component ? (
                          <Badge variant="outline" className="text-xs">
                            {component.type}: {component.label}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Tenant-wide</span>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      {key.status === "active" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRevoke(key.id, key.name)}
                          aria-label={`Revoke ${key.name}`}
                        >
                          <ShieldOff className="size-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* One-time token reveal */}
      <NewKeyRevealDialog token={newToken} onDismiss={() => setNewToken(null)} />
    </div>
  );
}
