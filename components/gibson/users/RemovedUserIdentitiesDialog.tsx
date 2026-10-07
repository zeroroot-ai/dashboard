// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * After a removal, the identities of the removed user (gibson#568,
 * dashboard#178). RemoveMember moves each agent, tool and plugin identity the
 * removed user owned to the caller, so each one keeps working and has an
 * accountable person. This dialog lists them. For each one the admin chooses
 * a new owner, or revokes the identity.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { describeIdentitiesAction } from "@/app/actions/read/listAgentIdentities";
import { reassignAgentIdentityAction, retireAgentIdentityAction } from "@/app/actions/crd/member";
import type { MemberRow } from "@/app/actions/read/listMembers";

export interface RemovedUserIdentitiesDialogProps {
  /** The email of the removed user, or null when the dialog is closed. */
  removedEmail: string | null;
  /** The identities that moved to the caller. */
  principalIds: string[];
  /** The user id of the caller, who owns them now. */
  currentOwnerUserId: string;
  /** The active members of the tenant, to choose a new owner from. */
  members: MemberRow[];
  onClose: () => void;
}

type RowState = "open" | "handed" | "revoked";

export function RemovedUserIdentitiesDialog({
  removedEmail,
  principalIds,
  currentOwnerUserId,
  members,
  onClose,
}: RemovedUserIdentitiesDialogProps) {
  const open = removedEmail !== null && principalIds.length > 0;
  const { data, isLoading, error } = useQuery({
    queryKey: ["removed-user-identities", ...principalIds],
    enabled: open,
    queryFn: async () => {
      const res = await describeIdentitiesAction(principalIds);
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
  });
  const [choice, setChoice] = React.useState<Record<string, string>>({});
  const [state, setState] = React.useState<Record<string, RowState>>({});
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});

  const candidates = members.filter(
    (m) => m.status === "active" && m.userId !== currentOwnerUserId,
  );

  async function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: RowState, message: string) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const res = await fn();
      if (!res.ok) throw new Error(res.error);
      setState((s) => ({ ...s, [id]: done }));
      toast.success(message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The change failed.");
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Identities of {removedEmail}</DialogTitle>
          <DialogDescription>
            These agents, tools and plugins now belong to you, so they keep
            working. Give each one to the right person, or revoke it.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground">Loading identities...</p>}
        {error && (
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "The identities did not load."}
          </p>
        )}

        <ul className="space-y-3" data-testid="removed-user-identities">
          {(data ?? []).map((identity) => {
            const rowState = state[identity.id] ?? "open";
            return (
              <li key={identity.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-40 flex-1 truncate font-medium">{identity.name}</span>
                <Badge variant="outline">{identity.kind}</Badge>
                {rowState === "handed" && <span className="text-sm text-muted-foreground">Handed over</span>}
                {rowState === "revoked" && <span className="text-sm text-muted-foreground">Revoked</span>}
                {rowState === "open" && (
                  <>
                    <Select
                      value={choice[identity.id] ?? ""}
                      onValueChange={(v) => setChoice((c) => ({ ...c, [identity.id]: v }))}
                    >
                      <SelectTrigger className="w-56" aria-label={`New owner of ${identity.name}`}>
                        <SelectValue placeholder="Choose a new owner" />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates.map((m) => (
                          <SelectItem key={m.userId} value={m.userId}>
                            {m.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      disabled={!choice[identity.id] || busy[identity.id]}
                      onClick={() =>
                        run(
                          identity.id,
                          () => reassignAgentIdentityAction({
                            principalId: identity.id,
                            newOwnerUserId: choice[identity.id] ?? "",
                          }),
                          "handed",
                          `${identity.name} has a new owner.`,
                        )
                      }
                    >
                      Hand over
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy[identity.id]}
                      onClick={() =>
                        run(
                          identity.id,
                          () => retireAgentIdentityAction({ principalId: identity.id }),
                          "revoked",
                          `${identity.name} is revoked.`,
                        )
                      }
                    >
                      Revoke
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
