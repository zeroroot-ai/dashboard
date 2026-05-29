"use client";

/**
 * TargetsLibrary — the /dashboard/targets page. Lists the tenant's targets and
 * lets the user create, edit, and delete them. A target is the system a mission
 * assesses; it is identified by a server-minted UUID (shown read-only) — name
 * and the other fields are metadata. Missions reference a target by its UUID.
 */

import * as React from "react";
import { PlusCircle, CrosshairIcon, Pencil, Trash2, Loader2, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { TableSkeleton, ErrorAlert } from "@/components/gibson/shared";
import {
  listTargetsAction,
  createTargetAction,
  updateTargetAction,
  deleteTargetAction,
  type TargetView,
} from "@/app/actions/targets/targets";

interface FormState {
  name: string;
  type: string;
  url: string;
  provider: string;
  model: string;
  authType: string;
  status: string;
  description: string;
  tags: string;
  capabilities: string;
  timeout: string;
}

const TYPE_OPTIONS = ["llm_chat", "llm_api", "rag", "agent", "embedding", "multimodal", "custom"];
const PROVIDER_OPTIONS = ["", "openai", "anthropic", "google", "azure", "ollama", "custom"];
const AUTH_OPTIONS = ["none", "api_key", "bearer", "basic", "oauth"];
const STATUS_OPTIONS = ["active", "inactive", "error"];

const EMPTY_FORM: FormState = {
  name: "",
  type: "custom",
  url: "",
  provider: "",
  model: "",
  authType: "none",
  status: "active",
  description: "",
  tags: "",
  capabilities: "",
  timeout: "30",
};

function toForm(t: TargetView): FormState {
  return {
    name: t.name,
    type: t.type || "custom",
    url: t.url,
    provider: t.provider,
    model: t.model,
    authType: t.authType || "none",
    status: t.status || "active",
    description: t.description,
    tags: t.tags.join(", "),
    capabilities: t.capabilities.join(", "),
    timeout: String(t.timeout || 30),
  };
}

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function TargetsLibrary() {
  const [targets, setTargets] = React.useState<TargetView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<TargetView | "new" | null>(null);
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [saving, startSave] = React.useTransition();
  const [pendingDelete, setPendingDelete] = React.useState<TargetView | null>(null);
  const [deleting, startDelete] = React.useTransition();

  const refresh = React.useCallback(async () => {
    setError(null);
    const res = await listTargetsAction();
    if (res.ok) {
      setTargets(res.data);
    } else {
      setError(res.code === "permission_denied" ? "Permission denied" : "Could not load your targets");
      setTargets([]);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditing("new");
  }

  function openEdit(t: TargetView) {
    setForm(toForm(t));
    setEditing(t);
  }

  function handleSave() {
    if (!form.name.trim()) {
      toast.error("Target name is required");
      return;
    }
    const parsedTimeout = parseInt(form.timeout, 10);
    const input = {
      name: form.name.trim(),
      type: form.type.trim(),
      url: form.url.trim(),
      provider: form.provider.trim(),
      model: form.model.trim(),
      authType: form.authType.trim(),
      status: form.status.trim(),
      description: form.description.trim(),
      tags: splitList(form.tags),
      capabilities: splitList(form.capabilities),
      timeout: Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 30,
    };
    startSave(async () => {
      const res =
        editing === "new"
          ? await createTargetAction(input)
          : await updateTargetAction((editing as TargetView).id, input);
      if (res.ok) {
        toast.success(editing === "new" ? "Target created" : "Target updated");
        setEditing(null);
        await refresh();
      } else {
        toast.error(
          res.code === "permission_denied" ? "Permission denied" : res.error || "Could not save target",
        );
      }
    });
  }

  function handleConfirmDelete() {
    const t = pendingDelete;
    if (!t) return;
    startDelete(async () => {
      const res = await deleteTargetAction(t.id);
      if (res.ok) {
        toast.success("Target deleted");
        setTargets((prev) => prev?.filter((x) => x.id !== t.id) ?? null);
      } else {
        toast.error(res.code === "permission_denied" ? "Permission denied" : "Could not delete target");
      }
      setPendingDelete(null);
    });
  }

  const isLoading = targets === null && error === null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-bold tracking-tight font-mono lg:text-2xl">Targets</h1>
        <Button onClick={openCreate}>
          <PlusCircle className="size-4" />
          New Target
        </Button>
      </div>

      {error && (
        <ErrorAlert error={new Error(error)} title="Failed to load targets" retry={() => void refresh()} />
      )}

      {isLoading && <TableSkeleton rows={4} cols={4} />}

      {!isLoading && !error && targets && targets.length === 0 && (
        <EmptyState
          icon={CrosshairIcon}
          title="No targets yet"
          description="A target is the system a mission assesses — a host, endpoint, or model. Create one, then reference it from a mission."
          primaryCta={
            <Button onClick={openCreate}>
              <PlusCircle className="size-4" />
              New Target
            </Button>
          }
        />
      )}

      {!isLoading && !error && targets && targets.length > 0 && (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>UUID</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {targets.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium font-mono">{t.name || "(unnamed)"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{t.type || "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-sm font-mono break-all">
                    {t.url || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs font-mono">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                      onClick={() => {
                        void navigator.clipboard?.writeText(t.id);
                        toast.success("UUID copied");
                      }}
                      aria-label={`Copy UUID for ${t.name}`}
                    >
                      {t.id.slice(0, 8)}… <Copy className="size-3" />
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Edit ${t.name}`}
                        onClick={() => openEdit(t)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Delete ${t.name}`}
                        onClick={() => setPendingDelete(t)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(isOpen) => !isOpen && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New target" : "Edit target"}</DialogTitle>
            <DialogDescription>
              The name and fields below are metadata. The UUID is assigned automatically and is what
              missions reference.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label htmlFor="target-name">Name</Label>
              <Input
                id="target-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="prod-web"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Select
                  value={form.provider || "none"}
                  onValueChange={(v) => setForm((f) => ({ ...f, provider: v === "none" ? "" : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="(none)" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_OPTIONS.map((o) => (
                      <SelectItem key={o || "none"} value={o || "none"}>
                        {o || "(none)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="target-url">Endpoint URL</Label>
              <Input
                id="target-url"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://example.com"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="target-model">Model</Label>
                <Input
                  id="target-model"
                  value={form.model}
                  onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  placeholder="gpt-4o"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="target-timeout">Timeout (seconds)</Label>
                <Input
                  id="target-timeout"
                  type="number"
                  min={1}
                  value={form.timeout}
                  onChange={(e) => setForm((f) => ({ ...f, timeout: e.target.value }))}
                  placeholder="30"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Auth type</Label>
                <Select
                  value={form.authType}
                  onValueChange={(v) => setForm((f) => ({ ...f, authType: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AUTH_OPTIONS.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="target-capabilities">Capabilities (comma-separated)</Label>
              <Input
                id="target-capabilities"
                value={form.capabilities}
                onChange={(e) => setForm((f) => ({ ...f, capabilities: e.target.value }))}
                placeholder="vision, tools"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="target-tags">Tags (comma-separated)</Label>
              <Input
                id="target-tags"
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                placeholder="prod, external"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="target-description">Description</Label>
              <Textarea
                id="target-description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(isOpen) => !isOpen && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete target?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the target
              {pendingDelete ? ` "${pendingDelete.name}"` : ""} for your tenant. Missions that
              reference its UUID will no longer resolve. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? <Loader2 className="size-3.5 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
