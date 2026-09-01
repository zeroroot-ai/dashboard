"use client";

/**
 * Delete confirmation (gibson#1706 lane E1). It names what the daemon does:
 * drain every member and close their open jobs as abandoned, so the count of
 * open jobs is shown before the person confirms.
 */

import * as React from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useDeleteBank } from "@/src/hooks/useBanks";
import type { BankView, MemberView } from "@/src/lib/banks/view";

/** Jobs that DeleteBank closes as abandoned: every job a member holds open. */
function openJobCount(members: readonly Pick<MemberView, "activeJobIds">[]): number {
  return members.reduce((n, m) => n + m.activeJobIds.length, 0);
}

export function DeleteBankDialog({
  bank,
  members,
  onDeleted,
}: {
  bank: BankView;
  members: readonly MemberView[];
  onDeleted: () => void;
}) {
  const del = useDeleteBank();
  const openJobs = openJobCount(members);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm" className="text-xs" data-testid="bank-delete" disabled={del.isPending}>
          <Trash2 className="size-3" />
          Delete bank
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {bank.name}?</AlertDialogTitle>
          <AlertDialogDescription data-testid="bank-delete-description">
            The daemon drains every member and removes the bank.{" "}
            {openJobs === 0
              ? "No job is open on its members."
              : `${openJobs} open ${openJobs === 1 ? "job closes" : "jobs close"} with verdict abandoned.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep bank</AlertDialogCancel>
          <AlertDialogAction
            data-testid="bank-delete-confirm"
            onClick={() =>
              del.mutate(bank.id, {
                onSuccess: () => {
                  toast.success(`Bank ${bank.name} deleted`);
                  onDeleted();
                },
                onError: (err) => toast.error("Failed to delete bank", { description: err.message }),
              })
            }
          >
            Delete bank
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
