"use client";

/**
 * DraftsMenu — dropdown surfaced next to the mission-create page's
 * template selector. Lists daemon-persisted drafts for the active
 * tenant and exposes load + delete actions.
 *
 * Spec: mission-draft-dashboard-wiring.
 *
 * Lifecycle:
 *   - On open, calls listMissionDraftsAction (server action) and
 *     populates the menu.
 *   - Clicking a row navigates to `?draft=<id>` so the parent
 *     page's URL-driven hydration kicks in.
 *   - Clicking the trash icon opens an AlertDialog; on confirm,
 *     calls deleteMissionDraftAction and refreshes the list.
 *
 * The "no saved drafts" empty state takes a single line so the menu
 * doesn't bloat the toolbar when the tenant has none.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, FolderOpen, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  listMissionDraftsAction,
  deleteMissionDraftAction,
} from "@/app/actions/missions/drafts";
import type { MissionDraft } from "@/src/lib/gibson-client/mission-drafts";

interface DraftsMenuProps {
  /** When set, the menu marks the matching row as "current". */
  currentDraftId?: string;
  /** Called after a successful delete. Lets the parent clear hot state if the deleted draft was the current one. */
  onDeleted?: (draftId: string) => void;
}

export function DraftsMenu({ currentDraftId, onDeleted }: DraftsMenuProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [drafts, setDrafts] = React.useState<MissionDraft[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<MissionDraft | null>(
    null,
  );
  const [deleting, startDelete] = React.useTransition();

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await listMissionDraftsAction();
      if (res.ok) {
        setDrafts(res.data);
      } else {
        toast.error(
          res.code === "permission_denied"
            ? "Permission denied"
            : "Could not load drafts",
        );
        setDrafts([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open && drafts === null) {
      void refresh();
    }
  }, [open, drafts, refresh]);

  function handleLoad(draft: MissionDraft) {
    setOpen(false);
    router.push(`/dashboard/missions/create?draft=${draft.id}`);
  }

  function handleConfirmDelete() {
    const draft = pendingDelete;
    if (!draft) return;
    startDelete(async () => {
      const res = await deleteMissionDraftAction(draft.id);
      if (res.ok) {
        toast.success("Draft deleted");
        // Optimistically remove it from the local list so the menu
        // updates without a round trip.
        setDrafts((prev) => prev?.filter((d) => d.id !== draft.id) ?? null);
        onDeleted?.(draft.id);
      } else {
        toast.error(
          res.code === "permission_denied"
            ? "Permission denied"
            : "Could not delete draft",
        );
      }
      setPendingDelete(null);
    });
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <FolderOpen className="size-3.5" />
            Drafts
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="font-mono text-xs">
            Saved Drafts
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {loading ? (
            <DropdownMenuItem disabled className="justify-center">
              <Loader2 className="size-3.5 animate-spin" />
            </DropdownMenuItem>
          ) : !drafts || drafts.length === 0 ? (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              No saved drafts.
            </DropdownMenuItem>
          ) : (
            drafts.map((d) => (
              <DropdownMenuItem
                key={d.id}
                className="flex items-center justify-between gap-2"
                // Prevent the row click from triggering when the trash
                // icon is the actual click target.
                onSelect={(e) => {
                  e.preventDefault();
                  handleLoad(d);
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm">
                    {d.name || "(unnamed)"}
                    {d.id === currentDraftId && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        current
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Updated {formatRelative(d.updatedAt)}
                  </div>
                </div>
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label={`Delete draft ${d.name}`}
                >
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPendingDelete(d);
                      setOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        setPendingDelete(d);
                        setOpen(false);
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </span>
                </Button>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(isOpen) => !isOpen && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the saved draft
              {pendingDelete ? ` "${pendingDelete.name}"` : ""} for your tenant.
              The action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Imperative refresh handle so the parent page can reload the list
// after Save Draft creates a new entry.
export type DraftsMenuHandle = {
  refresh: () => Promise<void>;
};

function formatRelative(rfc3339: string): string {
  if (!rfc3339) return "";
  const t = Date.parse(rfc3339);
  if (Number.isNaN(t)) return rfc3339;
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}
