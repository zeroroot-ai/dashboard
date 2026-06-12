"use client";

/**
 * SavedMissionsMenu, dropdown on the mission editor that lists the tenant's
 * saved missions and opens one in the editor. Authored missions are durable
 * (gibson#505), so there is no "draft" concept and nothing expires.
 *
 * Lifecycle:
 *   - On open, calls listMissionSourcesAction and populates the menu.
 *   - Clicking a row navigates to `?mission=<id>` so the editor hydrates it.
 *   - The trash icon opens a confirm dialog, then calls deleteMissionSourceAction.
 *
 * dashboard#496 (D5).
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
  listMissionSourcesAction,
  deleteMissionSourceAction,
} from "@/app/actions/missions/source-store";
import type { MissionDraft } from "@/src/lib/gibson-client/mission-source";

interface SavedMissionsMenuProps {
  /** When set, the menu marks the matching row as "current". */
  currentMissionId?: string;
  /** Called after a successful delete, so the parent can clear hot state. */
  onDeleted?: (missionId: string) => void;
}

export function SavedMissionsMenu({ currentMissionId, onDeleted }: SavedMissionsMenuProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [missions, setMissions] = React.useState<MissionDraft[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<MissionDraft | null>(
    null,
  );
  const [deleting, startDelete] = React.useTransition();

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await listMissionSourcesAction();
      if (res.ok) {
        setMissions(res.data);
      } else {
        toast.error(
          res.code === "permission_denied"
            ? "Permission denied"
            : "Could not load saved missions",
        );
        setMissions([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open && missions === null) {
      void refresh();
    }
  }, [open, missions, refresh]);

  function handleOpenMission(mission: MissionDraft) {
    setOpen(false);
    router.push(`/dashboard/missions/create?mission=${mission.id}`);
  }

  function handleConfirmDelete() {
    const mission = pendingDelete;
    if (!mission) return;
    startDelete(async () => {
      const res = await deleteMissionSourceAction(mission.id);
      if (res.ok) {
        toast.success("Mission deleted");
        setMissions((prev) => prev?.filter((m) => m.id !== mission.id) ?? null);
        onDeleted?.(mission.id);
      } else {
        toast.error(
          res.code === "permission_denied"
            ? "Permission denied"
            : "Could not delete mission",
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
            Open
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel className="font-mono text-xs">
            Saved Missions
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {loading ? (
            <DropdownMenuItem disabled className="justify-center">
              <Loader2 className="size-3.5 animate-spin" />
            </DropdownMenuItem>
          ) : !missions || missions.length === 0 ? (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">
              No saved missions.
            </DropdownMenuItem>
          ) : (
            missions.map((m) => (
              <DropdownMenuItem
                key={m.id}
                className="flex items-center justify-between gap-2"
                onSelect={(e) => {
                  e.preventDefault();
                  handleOpenMission(m);
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm">
                    {m.name || "(unnamed)"}
                    {m.id === currentMissionId && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        current
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Updated {formatRelative(m.updatedAt)}
                  </div>
                </div>
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label={`Delete mission ${m.name}`}
                >
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPendingDelete(m);
                      setOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        setPendingDelete(m);
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
            <AlertDialogTitle>Delete mission?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the saved mission
              {pendingDelete ? ` "${pendingDelete.name}"` : ""} for your tenant.
              The action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={deleting}>
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
