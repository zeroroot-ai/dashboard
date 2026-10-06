// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * The proofs that wait for a human review (dashboard#228, gibson#798,
 * ADR-0131). A proof that carries only evidence the agent typed settles
 * nothing on its own. A reviewer reads the evidence here and settles the bet
 * as true positive or false positive, or dismisses it. The verdict goes
 * through the same SettleBetByHITL path as an open bet, and a settled bet
 * leaves this list.
 */

import * as React from "react";
import { toast } from "sonner";
import { CheckIcon, CircleSlashIcon, FileSearchIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ErrorAlert } from "@/components/gibson/shared/ErrorAlert";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { TableSkeleton } from "@/components/gibson/shared/DataSkeleton";
import { useSubmitBetVerdict } from "@/src/hooks/useHitlSettle";
import { useProofReviews } from "@/src/hooks/useProofReviews";
import type { BetVerdict } from "@/src/types/hitl-settle";
import type { ProofReviewItem } from "@/src/types/proof-review";
import { PROOF_REVIEW_TEXTS as T } from "./proof-review-texts";

function ProofReviewRow({ item }: { item: ProofReviewItem }) {
  const submitVerdict = useSubmitBetVerdict();
  const [pending, setPending] = React.useState(false);

  const submit = React.useCallback(
    async (verdict: BetVerdict) => {
      setPending(true);
      try {
        const result = await submitVerdict.mutateAsync({ id: item.hypothesisId, verdict });
        toast.success("Verdict recorded", { description: result.effect });
      } catch (e) {
        toast.error("Could not record the verdict", {
          description: e instanceof Error ? e.message : "Unknown error",
        });
      } finally {
        setPending(false);
      }
    },
    [submitVerdict, item.hypothesisId],
  );

  const busy = pending || submitVerdict.isPending;

  return (
    <Card data-testid={`proof-review-${item.hypothesisId}`} className="border-border">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            {item.technique && (
              <Badge className="border border-border bg-muted/60 font-mono text-xs text-muted-foreground">
                {T.technique} {item.technique}
              </Badge>
            )}
          </div>
          <p>
            {T.mission} <span className="font-mono">{item.missionId || "-"}</span>
            {item.submittedAt && (
              <>
                {" "}
                &middot; {T.submitted} {new Date(item.submittedAt).toLocaleString()}
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void submit("dismiss")}>
            <CircleSlashIcon className="mr-1 size-4" /> Dismiss
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
            disabled={busy}
            onClick={() => void submit("false_positive")}
          >
            <XIcon className="mr-1 size-4" /> False positive
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void submit("true_positive")}>
            <CheckIcon className="mr-1 size-4" /> True positive
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {T.evidence}
        </div>
        {item.evidence.length > 0 ? (
          <ul className="space-y-3">
            {item.evidence.map((e, i) => (
              <li key={i} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {e.type && (
                    <Badge variant="outline" className="font-mono text-xs">
                      {e.type}
                    </Badge>
                  )}
                  <span className="font-medium">{e.title}</span>
                </div>
                {e.content && (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2 font-mono text-xs">
                    {e.content}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{T.noEvidence}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function ProofReviewsContent() {
  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } = useProofReviews();
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section className="space-y-4" aria-labelledby="proof-reviews-heading">
      <div className="space-y-1">
        <h2 id="proof-reviews-heading" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <FileSearchIcon className="size-5 text-highlight" /> {T.heading}
        </h2>
        <p className="text-sm text-muted-foreground">{T.description}</p>
      </div>

      {isLoading && (
        <div data-testid="proof-reviews-skeleton">
          <TableSkeleton rows={2} cols={1} />
        </div>
      )}

      {!isLoading && error && <ErrorAlert title={T.loadError} error={error} />}

      {!isLoading && !error && items.length === 0 && (
        <EmptyState icon={FileSearchIcon} title={T.emptyTitle} description={T.emptyDescription} />
      )}

      {!isLoading && !error && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => (
            <ProofReviewRow key={item.hypothesisId} item={item} />
          ))}
          {hasNextPage && (
            <Button variant="outline" size="sm" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
              {T.showMore}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
