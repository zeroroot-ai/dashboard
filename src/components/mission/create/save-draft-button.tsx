"use client";

/**
 * SaveDraftButton — paired with the mission-create page editor
 * toolbar. Two-mode behavior:
 *
 *   - When the page has no current draftId, the first click opens a
 *     dialog asking for a draft name, then calls
 *     saveMissionDraftAction with no draftId. The returned id is
 *     reflected back to the parent via onSaved + the ?draft=<id>
 *     URL update happens at the parent level.
 *
 *   - When the page already has a current draftId (URL contains
 *     ?draft=<id>), clicking saves over the existing draft
 *     without re-prompting and reuses the current name.
 *
 * Spec: mission-draft-dashboard-wiring.
 */

import * as React from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveMissionDraftAction } from "@/app/actions/missions/drafts";

interface SaveDraftButtonProps {
  yaml: string;
  /** Current draft ID — when set, clicking saves in place; when undefined, prompts for a name. */
  currentDraftId?: string;
  /** Display name of the current draft (used for in-place overwrites). */
  currentDraftName?: string;
  /** Whether the editor has unsaved changes vs the loaded draft / template. */
  isDirty: boolean;
  /** Called after a successful save with the server-assigned draftId and name. */
  onSaved: (draftId: string, name: string) => void;
}

export function SaveDraftButton({
  yaml,
  currentDraftId,
  currentDraftName,
  isDirty,
  onSaved,
}: SaveDraftButtonProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function performSave(args: { name: string; draftId?: string }) {
    setSaving(true);
    try {
      const res = await saveMissionDraftAction({
        name: args.name,
        yaml,
        draftId: args.draftId,
      });
      if (res.ok) {
        toast.success(args.draftId ? "Draft updated" : "Draft saved");
        onSaved(res.data.draftId, args.name);
        setDialogOpen(false);
        setName("");
      } else {
        toast.error(
          res.code === "permission_denied"
            ? "Permission denied"
            : res.code === "bad_input"
              ? res.error
              : "Could not save draft",
        );
      }
    } finally {
      setSaving(false);
    }
  }

  function handleClick() {
    if (currentDraftId) {
      // In-place save against the existing draft.
      const useName = currentDraftName ?? "Untitled draft";
      void performSave({ name: useName, draftId: currentDraftId });
      return;
    }
    setName("");
    setDialogOpen(true);
  }

  function handleSubmitDialog(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Please enter a name for the draft");
      return;
    }
    void performSave({ name: trimmed });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={!isDirty || saving}
        className="gap-1.5"
        aria-label={currentDraftId ? "Update draft" : "Save draft"}
      >
        {saving ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Save className="size-3.5" />
        )}
        {currentDraftId ? "Update Draft" : "Save Draft"}
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form onSubmit={handleSubmitDialog}>
            <DialogHeader>
              <DialogTitle>Save mission draft</DialogTitle>
              <DialogDescription>
                Drafts are persisted server-side and visible to anyone in your
                tenant. They expire after 30 days of inactivity.
              </DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-2">
              <Label htmlFor="mission-draft-name" className="text-sm">
                Draft name
              </Label>
              <Input
                id="mission-draft-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. recon scan — production"
                maxLength={256}
                disabled={saving}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  "Save"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
