"use client";

/**
 * AgentsContent
 *
 * Agent Auth management panel for Gibson settings. Lists AgentEnrollment CRDs
 * and supports creating / revoking enrollments. The bootstrap token is
 * obtainable as a one-shot via fetchBootstrapTokenAction.
 */

import * as React from "react";
import { AlertCircle, Bot, Key, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useTenantId } from "@/src/lib/auth/tenant";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { useCRDWatch } from "@/src/hooks/useCRDWatch";
import {
  createEnrollmentAction,
  revokeEnrollmentAction,
  fetchBootstrapTokenAction,
} from "@/app/actions/crd/enrollment";
import type { AgentEnrollment, AgentMode } from "@/src/lib/k8s/types";

function tenantNamespace(name: string): string {
  return `tenant-${name}`;
}

const STATUS_CLASS: Record<string, string> = {
  Active: "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400",
  BootstrapReady: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  Pending: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  Enrolling: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  Revoked: "border-destructive/40 bg-destructive/10 text-destructive",
  Failed: "border-destructive/40 bg-destructive/10 text-destructive",
  Terminated: "border-border bg-muted/20 text-muted-foreground",
};

export function AgentsContent() {
  const tenantId: string = useTenantId() ?? "";
  const namespace = tenantId ? tenantNamespace(tenantId) : undefined;

  const { items: enrollments, status, error } = useCRDWatch("AgentEnrollment", namespace, {
    enabled: !!tenantId,
  });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [enrollmentName, setEnrollmentName] = React.useState("");
  const [agentName, setAgentName] = React.useState("");
  const [mode, setMode] = React.useState<AgentMode>("autonomous");

  const [tokenReveal, setTokenReveal] = React.useState<{ token: string; platformUrl: string; name: string } | null>(null);
  const [revoking, setRevoking] = React.useState<string | null>(null);

  const isLoading = status === "connecting" || status === "idle";

  async function handleCreate() {
    if (!enrollmentName || !agentName) {
      toast.error("Name and agent are required");
      return;
    }
    setCreating(true);
    try {
      const res = await createEnrollmentAction({
        tenantName: tenantId,
        name: enrollmentName,
        agentName,
        mode,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Enrollment created — waiting for bootstrap token");
      // Poll briefly for the bootstrap secret
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const t = await fetchBootstrapTokenAction(tenantId, res.data.name);
        if (t.ok) {
          setTokenReveal({ token: t.data.token, platformUrl: t.data.platformUrl, name: res.data.name });
          break;
        }
      }
      setCreateOpen(false);
      setEnrollmentName("");
      setAgentName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create enrollment");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(name: string) {
    setRevoking(name);
    try {
      const res = await revokeEnrollmentAction(tenantId, name);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Enrollment ${name} revoked`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke enrollment");
    } finally {
      setRevoking(null);
    }
  }

  if (!tenantId) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Agent Auth</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Manage agent enrollments. Operator issues a bootstrap token per
            enrollment which the agent exchanges for its long-lived identity.
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {/* Enrollments table */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Bot className="text-primary size-4" />
                Agent enrollments
              </CardTitle>
              <CardDescription className="text-xs">
                {isLoading ? (
                  <Skeleton className="inline-block h-3 w-24" />
                ) : (
                  `${enrollments.length} enrollment${enrollments.length !== 1 ? "s" : ""}`
                )}
              </CardDescription>
            </div>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="default">
                  <Plus className="size-3.5" />
                  New enrollment
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New agent enrollment</DialogTitle>
                  <DialogDescription>
                    Create an AgentEnrollment CRD. The operator will generate a
                    bootstrap token Secret you can hand to the agent.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="space-y-1">
                    <Label>Enrollment name</Label>
                    <Input
                      value={enrollmentName}
                      onChange={(e) => setEnrollmentName(e.target.value)}
                      placeholder="my-agent-01"
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Agent component name</Label>
                    <Input
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                      placeholder="opencode-agent"
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Mode</Label>
                    <Select value={mode} onValueChange={(v) => setMode(v as AgentMode)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="autonomous">Autonomous</SelectItem>
                        <SelectItem value="supervised">Supervised</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreate} disabled={creating}>
                    {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="pt-3">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Agent</TableHead>
                <TableHead className="text-xs">Mode</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Host</TableHead>
                <TableHead className="w-12 text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : enrollments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                    No enrollments. Create one to bootstrap a new agent.
                  </TableCell>
                </TableRow>
              ) : (
                enrollments.map((enrollment: AgentEnrollment) => {
                  const phase = enrollment.status?.phase ?? "Pending";
                  const hostId = enrollment.status?.hostId ?? "—";
                  const isActive = phase !== "Revoked" && phase !== "Terminated";
                  const name = enrollment.metadata.name;
                  return (
                    <TableRow key={name}>
                      <TableCell className="py-3 font-mono text-xs">{name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {enrollment.spec.agentName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {enrollment.spec.mode}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={STATUS_CLASS[phase] ?? "border-border"}
                        >
                          {phase}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{hostId}</TableCell>
                      <TableCell>
                        {isActive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRevoke(name)}
                            disabled={revoking === name}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            {revoking === name ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              "Revoke"
                            )}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Separator />

      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-0">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Key className="text-primary size-4" />
            Bootstrap tokens
          </CardTitle>
          <CardDescription className="text-xs mt-1">
            Bootstrap tokens are created by the operator automatically when you
            create an AgentEnrollment CRD. Tokens are shown exactly once and
            consumed when the agent registers.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Token reveal dialog */}
      <Dialog open={!!tokenReveal} onOpenChange={(o) => !o && setTokenReveal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bootstrap token for {tokenReveal?.name}</DialogTitle>
            <DialogDescription>
              Copy this token now — it is shown only once.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Platform URL</Label>
            <Input readOnly value={tokenReveal?.platformUrl ?? ""} className="font-mono text-xs" />
            <Label>Token</Label>
            <Input readOnly value={tokenReveal?.token ?? ""} className="font-mono text-xs" />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(tokenReveal?.token ?? "");
                toast.success("Token copied to clipboard");
              }}
            >
              Copy token
            </Button>
            <Button onClick={() => setTokenReveal(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
