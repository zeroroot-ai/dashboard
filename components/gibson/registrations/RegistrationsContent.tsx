// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * RegistrationsContent — the registration queue of the Platform owner
 * (dashboard#193, gibson#620, ADR-0074).
 *
 * One row for each registration that waits for a decision, oldest first:
 * the email, the name, the workspace, the plan and the time it arrived.
 * Approve activates the account and queues the workspace.
 * Reject keeps the account inactive and records a reason in the audit log.
 * Every visible text is in ./texts.ts or is data from the daemon.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ErrorAlert, TableSkeleton } from "@/components/gibson/shared";
import {
  approveRegistrationAction,
  listPendingRegistrationsAction,
  rejectRegistrationAction,
} from "@/app/actions/registrations";
import type { PendingRegistrationDTO } from "@/src/lib/gibson-client/registrations";
import {
  REGISTRATIONS_TEXT,
  approveFailedText,
  approvedText,
  rejectFailedText,
  rejectTitle,
} from "./texts";
import { REGISTRATIONS_QUERY_KEY } from "./query-key";

function fullName(r: PendingRegistrationDTO): string {
  return [r.ownerFirstName, r.ownerLastName].filter(Boolean).join(" ");
}

export function RegistrationsContent() {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = React.useState<PendingRegistrationDTO | null>(null);
  const [reason, setReason] = React.useState("");

  const query = useQuery({
    queryKey: REGISTRATIONS_QUERY_KEY,
    queryFn: () => listPendingRegistrationsAction(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: REGISTRATIONS_QUERY_KEY });

  const approve = useMutation({
    mutationFn: (id: string) => approveRegistrationAction(id),
    onSuccess: (res) => {
      if (res.ok) toast.success(approvedText(res.data.tenantId));
      else toast.error(approveFailedText(res.error));
      void refresh();
    },
  });

  const reject = useMutation({
    mutationFn: (input: { registrationId: string; reason: string }) =>
      rejectRegistrationAction(input),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(REGISTRATIONS_TEXT.rejected);
        setRejecting(null);
        setReason("");
      } else {
        toast.error(rejectFailedText(res.error));
      }
      void refresh();
    },
  });

  const rows = query.data?.ok ? query.data.data : [];
  const busy = approve.isPending || reject.isPending;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{REGISTRATIONS_TEXT.title}</h1>
        <p className="text-muted-foreground text-sm">{REGISTRATIONS_TEXT.intro}</p>
      </div>

      {query.isLoading ? (
        <TableSkeleton rows={4} />
      ) : query.data && !query.data.ok ? (
        <ErrorAlert error={{ message: query.data.error }} />
      ) : rows.length === 0 ? (
        <p className="text-sm" data-testid="registrations-empty">
          {REGISTRATIONS_TEXT.empty}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{REGISTRATIONS_TEXT.columnEmail}</TableHead>
              <TableHead>{REGISTRATIONS_TEXT.columnName}</TableHead>
              <TableHead>{REGISTRATIONS_TEXT.columnWorkspace}</TableHead>
              <TableHead>{REGISTRATIONS_TEXT.columnPlan}</TableHead>
              <TableHead>{REGISTRATIONS_TEXT.columnReceived}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.registrationId} data-testid="registration-row">
                <TableCell>{r.ownerEmail}</TableCell>
                <TableCell>{fullName(r)}</TableCell>
                <TableCell>{r.workspaceName}</TableCell>
                <TableCell>{r.tier}</TableCell>
                <TableCell>
                  {r.receivedAt ? (
                    <time dateTime={r.receivedAt}>{new Date(r.receivedAt).toLocaleString()}</time>
                  ) : null}
                </TableCell>
                <TableCell className="space-x-2 text-right">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => approve.mutate(r.registrationId)}
                  >
                    {REGISTRATIONS_TEXT.approve}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setReason("");
                      setRejecting(r);
                    }}
                  >
                    {REGISTRATIONS_TEXT.reject}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{rejecting ? rejectTitle(rejecting.ownerEmail) : ""}</DialogTitle>
            <DialogDescription>{REGISTRATIONS_TEXT.rejectBody}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="registration-reject-reason">{REGISTRATIONS_TEXT.reasonLabel}</Label>
            <Textarea
              id="registration-reject-reason"
              value={reason}
              maxLength={4096}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              {REGISTRATIONS_TEXT.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={reject.isPending}
              onClick={() =>
                rejecting &&
                reject.mutate({ registrationId: rejecting.registrationId, reason })
              }
            >
              {REGISTRATIONS_TEXT.rejectConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
