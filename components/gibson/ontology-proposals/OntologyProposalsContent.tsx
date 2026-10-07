// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * OntologyProposalsContent — the ontology proposal page (dashboard#191,
 * gibson#618, ADR-0033 decision 3).
 *
 * One row for each proposal: kind, label, how often agents proposed it, the
 * last proposer and claim, the status, the reviewer, the reject reason and
 * whether the label is in the ontology. The Owner approves or rejects a
 * pending row, and renders a promoted row as an SDK contribution. Every
 * visible text is in ./texts.ts or is data from the daemon.
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
  approveOntologyProposalAction,
  listOntologyProposalsAction,
  rejectOntologyProposalAction,
  submitOntologyUpstreamAction,
} from "@/app/actions/ontology-proposals";
import type {
  OntologyProposalDTO,
  UpstreamContributionDTO,
} from "@/src/lib/gibson-client/ontology-proposals";
import { useAuthorize } from "@/src/lib/auth/use-authorize";
import {
  KIND_TEXT,
  ONTOLOGY_TEXT,
  STATUS_TEXT,
  approvedText,
  contributionBody,
  contributionTitle,
  decisionFailedText,
  promotedText,
  recurrenceText,
  rejectReasonText,
  rejectTitle,
  rejectedText,
  submitFailedText,
} from "./texts";

const QUERY_KEY = ["ontology-proposals"] as const;
const DECIDE_METHOD = "/gibson.tenant.v1.OntologyExtensionService/ApproveOntologyExtensionProposal";

type Target = Pick<OntologyProposalDTO, "kind" | "label">;

function rowKey(p: Target): string {
  return `${p.kind}:${p.label}`;
}

export function OntologyProposalsContent() {
  const queryClient = useQueryClient();
  const { allowed: canDecide, loading: decideLoading } = useAuthorize(DECIDE_METHOD);
  const owner = !decideLoading && canDecide;

  const [rejecting, setRejecting] = React.useState<Target | null>(null);
  const [reason, setReason] = React.useState("");
  const [contribution, setContribution] = React.useState<
    (UpstreamContributionDTO & { label: string }) | null
  >(null);

  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => listOntologyProposalsAction() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const approve = useMutation({
    mutationFn: (t: Target) => approveOntologyProposalAction(t),
    onSuccess: (res, t) => {
      if (res.ok) toast.success(approvedText(t.label));
      else toast.error(decisionFailedText(res.error));
      void refresh();
    },
  });

  const reject = useMutation({
    mutationFn: (input: Target & { reason: string }) => rejectOntologyProposalAction(input),
    onSuccess: (res, input) => {
      if (res.ok) {
        toast.success(rejectedText(input.label));
        setRejecting(null);
        setReason("");
      } else {
        toast.error(decisionFailedText(res.error));
      }
      void refresh();
    },
  });

  const submit = useMutation({
    mutationFn: (t: Target) => submitOntologyUpstreamAction(t),
    onSuccess: (res, t) => {
      if (res.ok) setContribution({ ...res.data, label: t.label });
      else toast.error(submitFailedText(res.error));
    },
  });

  const rows = query.data?.ok ? query.data.data : [];
  const busy = approve.isPending || reject.isPending || submit.isPending;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{ONTOLOGY_TEXT.title}</h1>
        <p className="text-muted-foreground text-sm">{ONTOLOGY_TEXT.intro}</p>
      </div>

      {query.isLoading ? (
        <TableSkeleton rows={4} />
      ) : query.data && !query.data.ok ? (
        <ErrorAlert error={{ message: query.data.error }} />
      ) : rows.length === 0 ? (
        <p className="text-sm" data-testid="ontology-empty">
          {ONTOLOGY_TEXT.empty}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{ONTOLOGY_TEXT.columnKind}</TableHead>
              <TableHead>{ONTOLOGY_TEXT.columnLabel}</TableHead>
              <TableHead>{ONTOLOGY_TEXT.columnRecurrence}</TableHead>
              <TableHead>{ONTOLOGY_TEXT.columnProposer}</TableHead>
              <TableHead>{ONTOLOGY_TEXT.columnClaim}</TableHead>
              <TableHead>{ONTOLOGY_TEXT.columnStatus}</TableHead>
              <TableHead>{ONTOLOGY_TEXT.columnReviewer}</TableHead>
              <TableHead>{ONTOLOGY_TEXT.columnOntology}</TableHead>
              {owner && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={rowKey(p)} data-testid="ontology-row">
                <TableCell>{KIND_TEXT[p.kind]}</TableCell>
                <TableCell className="font-mono">{p.label}</TableCell>
                <TableCell>{recurrenceText(p.recurrence)}</TableCell>
                <TableCell>{p.lastProposer}</TableCell>
                <TableCell className="max-w-xs whitespace-normal">{p.lastClaim}</TableCell>
                <TableCell>
                  <div>{STATUS_TEXT[p.status]}</div>
                  {p.status === "rejected" && p.rejectReason && (
                    <div className="text-muted-foreground text-xs">
                      {rejectReasonText(p.rejectReason)}
                    </div>
                  )}
                </TableCell>
                <TableCell>{p.reviewer}</TableCell>
                <TableCell>
                  {p.promoted ? promotedText(p.promotedTaxonomyVersion) : ONTOLOGY_TEXT.notInOntology}
                </TableCell>
                {owner && (
                  <TableCell className="space-x-2 text-right">
                    {p.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => approve.mutate({ kind: p.kind, label: p.label })}
                        >
                          {ONTOLOGY_TEXT.approve}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setReason("");
                            setRejecting({ kind: p.kind, label: p.label });
                          }}
                        >
                          {ONTOLOGY_TEXT.reject}
                        </Button>
                      </>
                    )}
                    {p.promoted && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => submit.mutate({ kind: p.kind, label: p.label })}
                      >
                        {ONTOLOGY_TEXT.submit}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{rejecting ? rejectTitle(rejecting.label) : ""}</DialogTitle>
            <DialogDescription>{ONTOLOGY_TEXT.rejectBody}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ontology-reject-reason">{ONTOLOGY_TEXT.reasonLabel}</Label>
            <Textarea
              id="ontology-reject-reason"
              value={reason}
              maxLength={4096}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              {ONTOLOGY_TEXT.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={reject.isPending}
              onClick={() => rejecting && reject.mutate({ ...rejecting, reason })}
            >
              {ONTOLOGY_TEXT.rejectConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={contribution !== null} onOpenChange={(open) => !open && setContribution(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{contribution ? contributionTitle(contribution.label) : ""}</DialogTitle>
            <DialogDescription>
              {contribution ? contributionBody(contribution.auditRecordId) : ""}
            </DialogDescription>
          </DialogHeader>
          {contribution && (
            <div className="space-y-3">
              <CopyField label={ONTOLOGY_TEXT.filePath} value={contribution.suggestedFilePath} />
              <CopyField label={ONTOLOGY_TEXT.prTitle} value={contribution.suggestedPrTitle} />
              <CopyField label={ONTOLOGY_TEXT.prBody} value={contribution.suggestedPrBody} block />
              <CopyField label={ONTOLOGY_TEXT.fileContent} value={contribution.packJson} block />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setContribution(null)}>
              {ONTOLOGY_TEXT.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CopyField({ label, value, block }: { label: string; value: string; block?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void navigator.clipboard.writeText(value).then(() => toast.success(ONTOLOGY_TEXT.copied))
          }
        >
          {ONTOLOGY_TEXT.copy}
        </Button>
      </div>
      {block ? (
        <pre className="bg-muted max-h-48 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap">
          {value}
        </pre>
      ) : (
        <code className="bg-muted block rounded-md p-2 text-xs">{value}</code>
      )}
    </div>
  );
}
