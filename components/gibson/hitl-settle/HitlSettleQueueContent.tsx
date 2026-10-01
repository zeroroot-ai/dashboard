// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * The ADR-0023 HITL settle surface (gibson#264/#266/#280, dashboard#97): a
 * human judges the bets the fleet is unsure about, and every verdict flows
 * back to make the system smarter. Distinct from the finding/surprise review
 * queue (ADR-0006) and the destructive-action authorization queue
 * (dashboard#99, ADR-0028) — this surface judges whether a claim was
 * correct, not whether an action may run.
 *
 * Every row shows the hypothesis (its claim), its evidence, and a link to
 * the proposing agent's recorded transcript (Gibson Traces, gibson#755) when
 * a run is known — then true-positive / false-positive / dismiss. Judging is
 * always asynchronous: nothing here ever pauses the mission it's drawn from
 * (ADR-0008).
 */

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { GavelIcon, CheckIcon, XIcon, CircleSlashIcon, ExternalLinkIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ErrorAlert } from "@/components/gibson/shared/ErrorAlert";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { TableSkeleton } from "@/components/gibson/shared/DataSkeleton";
import { useOpenBets, useSubmitBetVerdict } from "@/src/hooks/useHitlSettle";
import type { BetEvidenceItem, BetVerdict, OpenBetForReview } from "@/src/types/hitl-settle";

/** Render one referenced entity as "Label key=value, key=value". */
function formatEvidence(item: BetEvidenceItem): string {
  const props = Object.entries(item.idProperties)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return props ? `${item.label} (${props})` : item.label;
}

// ── One open bet ──────────────────────────────────────────────────────────

function OpenBetRow({ item }: { item: OpenBetForReview }) {
  const submitVerdict = useSubmitBetVerdict();
  const [pendingVerdict, setPendingVerdict] = React.useState<BetVerdict | null>(null);

  const submit = React.useCallback(
    async (verdict: BetVerdict) => {
      setPendingVerdict(verdict);
      try {
        const result = await submitVerdict.mutateAsync({ id: item.id, verdict });
        toast.success("Verdict recorded", {
          description: result.effect,
        });
      } catch (e) {
        toast.error("Could not record the verdict", {
          description: e instanceof Error ? e.message : "Unknown error",
        });
      } finally {
        setPendingVerdict(null);
      }
    },
    [submitVerdict, item.id],
  );

  const busy = pendingVerdict !== null || submitVerdict.isPending;

  return (
    <Card data-testid={`hitl-bet-${item.id}`} className="border-border">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border border-border bg-muted/60 font-mono text-xs text-muted-foreground">
              confidence {(item.confidence * 100).toFixed(0)}%
            </Badge>
          </div>
          <p className="text-sm font-medium">{item.claim}</p>
          <p className="text-xs text-muted-foreground">
            Proposed by <span className="font-mono">{item.proposer}</span>
            {item.runId && (
              <>
                {" "}
                &middot;{" "}
                <Link
                  href={`/dashboard/traces/${item.runId}`}
                  className="inline-flex items-center gap-1 text-link hover:underline"
                >
                  View transcript <ExternalLinkIcon className="size-3" />
                </Link>
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
          Evidence
        </div>
        {item.evidence.length > 0 ? (
          <ul className="list-inside list-disc space-y-1">
            {item.evidence.map((e, i) => (
              <li key={i}>{formatEvidence(e)}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No referenced entities recorded.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function HitlSettleQueueContent() {
  const { data, isLoading, error } = useOpenBets();

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <GavelIcon className="size-6 text-highlight" /> HITL settle queue
        </h1>
        <p className="text-sm text-muted-foreground">
          Judge the bets the fleet is unsure about. Judging is asynchronous and never blocks or
          pauses a running mission. The fleet keeps working while a bet is open (ADR-0008).
          Every verdict feeds the learning loop.
        </p>
      </div>

      {isLoading && (
        <div data-testid="hitl-settle-skeleton">
          <TableSkeleton rows={3} cols={1} />
        </div>
      )}

      {!isLoading && error && (
        <ErrorAlert title="Failed to load the HITL settle queue" error={error} />
      )}

      {!isLoading && !error && data && data.items.length === 0 && (
        <EmptyState
          icon={GavelIcon}
          title="Nothing open right now"
          description="Bets the fleet is unsure about appear here as missions run. The fleet is never blocked waiting for a verdict."
        />
      )}

      {!isLoading && !error && data && data.items.length > 0 && (
        <div className="space-y-3">
          {data.items.map((item) => (
            <OpenBetRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
