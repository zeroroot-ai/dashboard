"use client";

/**
 * MissionsLibrary, the /dashboard/missions page. Lists the tenant's saved
 * (authored) missions and lets the user open one in the editor, create a new
 * one, or delete one. Execution history lives separately under Mission Results
 * (/dashboard/results). dashboard#497 (D6).
 */

import * as React from "react";
import Link from "next/link";
import { PlusCircle, CrosshairIcon, Pencil, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  listMissionSourcesAction,
  deleteMissionSourceAction,
} from "@/app/actions/missions/source-store";
import type { MissionDraft } from "@/src/lib/gibson-client/mission-source";

function formatRelative(rfc3339: string): string {
  if (!rfc3339) return "-";
  const t = Date.parse(rfc3339);
  if (Number.isNaN(t)) return rfc3339;
  return new Date(t).toLocaleDateString();
}

export function MissionsLibrary() {
  const [missions, setMissions] = React.useState<MissionDraft[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<MissionDraft | null>(
    null,
  );
  const [deleting, startDelete] = React.useTransition();

  const refresh = React.useCallback(async () => {
    setError(null);
    const res = await listMissionSourcesAction();
    if (res.ok) {
      setMissions(res.data);
    } else {
      setError(
        res.code === "permission_denied"
          ? "Permission denied"
          : "Could not load your missions",
      );
      setMissions([]);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  function handleConfirmDelete() {
    const mission = pendingDelete;
    if (!mission) return;
    startDelete(async () => {
      const res = await deleteMissionSourceAction(mission.id);
      if (res.ok) {
        toast.success("Mission deleted");
        setMissions((prev) => prev?.filter((m) => m.id !== mission.id) ?? null);
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

  const isLoading = missions === null && error === null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-bold tracking-tight font-mono lg:text-2xl">
          Missions
        </h1>
        <Button asChild>
          <Link href="/dashboard/missions/create">
            <PlusCircle className="size-4" />
            New Mission
          </Link>
        </Button>
      </div>

      {error && (
        <ErrorAlert
          error={new Error(error)}
          title="Failed to load missions"
          retry={() => void refresh()}
        />
      )}

      {isLoading && <TableSkeleton rows={4} cols={3} />}

      {!isLoading && !error && missions && missions.length === 0 && (
        <EmptyState
          icon={CrosshairIcon}
          title="No missions yet"
          description="A mission is an agent workflow you author in CUE. Create one, it autosaves as you type and can be run any time."
          primaryCta={
            <Button asChild>
              <Link href="/dashboard/missions/create">
                <PlusCircle className="size-4" />
                New Mission
              </Link>
            </Button>
          }
        />
      )}

      {!isLoading && !error && missions && missions.length > 0 && (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Last edited</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {missions.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium font-mono">
                    <Link
                      href={`/dashboard/missions/create?mission=${m.id}`}
                      className="hover:text-primary transition-colors"
                    >
                      {m.name || "(unnamed)"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm tabular-nums">
                    {formatRelative(m.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="size-7"
                      >
                        <Link
                          href={`/dashboard/missions/create?mission=${m.id}`}
                          aria-label={`Edit ${m.name}`}
                        >
                          <Pencil className="size-3.5" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Delete ${m.name}`}
                        onClick={() => setPendingDelete(m)}
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
              {deleting ? <Loader2 className="size-3.5 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
