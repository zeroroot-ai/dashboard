// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * The ADR-0028 destructive-action authorization queue (gibson#278,
 * dashboard#99). Distinct from the review/label queue (ADR-0006, judges
 * whether a finding is real) and the HITL settlement surface (dashboard#97,
 * judges a bet's verdict): this surface authorizes whether one specific
 * dangerous action may run at all, before it runs.
 *
 * Every row shows what the action would do, its blast radius, its
 * reversibility, the predicate it would satisfy, and the hypothesis/bet it
 * belongs to (ADR-0028 §3) — then approve or deny that one action. The copy
 * is deliberate about ADR-0028 §2: gating is per-action, never per-mission,
 * so the rest of the fleet keeps working while one action waits.
 */

import * as React from "react";
import { toast } from "sonner";
import {
  ShieldAlertIcon,
  UnlockIcon,
  LockIcon,
  HelpCircleIcon,
  CheckIcon,
  XIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ErrorAlert } from "@/components/gibson/shared/ErrorAlert";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { TableSkeleton } from "@/components/gibson/shared/DataSkeleton";
import {
  useDestructiveActions,
  useDecideDestructiveAction,
} from "@/src/hooks/useDestructiveActions";
import type {
  DestructiveActionDecision,
  DestructiveReversibility,
  PendingDestructiveAction,
} from "@/src/types/destructive-actions";

// ── Reversibility badge ──────────────────────────────────────────────────────

function ReversibilityBadge({ reversibility }: { reversibility: DestructiveReversibility }) {
  if (reversibility === "reversible") {
    return (
      <Badge className="border border-border bg-muted/60 font-mono text-xs uppercase tracking-wide text-muted-foreground">
        <UnlockIcon className="mr-1 size-3" /> Reversible
      </Badge>
    );
  }
  if (reversibility === "irreversible") {
    return (
      <Badge className="border border-destructive/40 bg-destructive/10 font-mono text-xs uppercase tracking-wide text-destructive">
        <LockIcon className="mr-1 size-3" /> Irreversible
      </Badge>
    );
  }
  return (
    <Badge className="border border-border bg-muted/60 font-mono text-xs uppercase tracking-wide text-muted-foreground">
      <HelpCircleIcon className="mr-1 size-3" /> Reversibility not classified
    </Badge>
  );
}

/** Copy for the detail row's reversibility line. */
const REVERSIBILITY_NOTE: Record<DestructiveReversibility, string> = {
  reversible: "The daemon marks this action reversible.",
  irreversible: "The daemon marks this action irreversible.",
  unspecified:
    "No reversibility signal yet; it reached this queue because it is destructive at all.",
};

// ── One pending action ───────────────────────────────────────────────────────

function DestructiveActionRow({ item }: { item: PendingDestructiveAction }) {
  const decide = useDecideDestructiveAction();
  const [pendingDecision, setPendingDecision] = React.useState<DestructiveActionDecision | null>(
    null,
  );

  const submit = React.useCallback(
    async (decision: DestructiveActionDecision) => {
      setPendingDecision(decision);
      try {
        await decide.mutateAsync({ id: item.id, decision });
        toast.success(decision === "approve" ? "Action authorized" : "Action denied", {
          description:
            decision === "approve"
              ? "The demonstration may now run. The rest of the mission was never paused."
              : "The demonstration will not run. The rest of the mission continues unaffected.",
        });
      } catch (e) {
        toast.error("Could not record the decision", {
          description: e instanceof Error ? e.message : "Unknown error",
        });
      } finally {
        setPendingDecision(null);
      }
    },
    [decide, item.id],
  );

  return (
    <Card data-testid={`destructive-action-${item.id}`} className="border-border">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border border-highlight/40 bg-highlight/10 font-mono text-xs uppercase tracking-wide text-highlight">
              {item.technique}
            </Badge>
            <ReversibilityBadge reversibility={item.reversibility} />
          </div>
          <p className="text-sm font-medium">
            Run the <span className="font-mono">{item.technique}</span> demonstration to satisfy the{" "}
            <span className="font-mono">{item.predicateType}</span> predicate.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
            disabled={pendingDecision !== null || decide.isPending}
            onClick={() => void submit("deny")}
          >
            <XIcon className="mr-1 size-4" /> Deny
          </Button>
          <Button
            size="sm"
            disabled={pendingDecision !== null || decide.isPending}
            onClick={() => void submit("approve")}
          >
            <CheckIcon className="mr-1 size-4" /> Approve
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Blast radius
          </div>
          <div>{item.blastRadius || "Not yet classified"}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Reversibility
          </div>
          <div>{REVERSIBILITY_NOTE[item.reversibility]}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Predicate
          </div>
          <div className="font-mono text-xs">{item.predicateType}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Hypothesis / bet
          </div>
          <div className="font-mono text-xs text-muted-foreground">{item.hypothesisId}</div>
          <div className="font-mono text-xs text-muted-foreground">scope {item.scopeId}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function DestructiveActionQueueContent() {
  const { data, isLoading, error } = useDestructiveActions();

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldAlertIcon className="size-6 text-highlight" /> Destructive-action authorization
        </h1>
        <p className="text-sm text-muted-foreground">
          Before an irreversible or state-changing demonstration runs, it waits here for one
          human decision. The mission is not blocked while an action waits. The rest of the
          fleet keeps working on everything else. Only that one action pauses (ADR-0028).
        </p>
      </div>

      {isLoading && (
        <div data-testid="destructive-queue-skeleton">
          <TableSkeleton rows={3} cols={1} />
        </div>
      )}

      {!isLoading && error && (
        <ErrorAlert title="Failed to load the authorization queue" error={error} />
      )}

      {!isLoading && !error && data && data.items.length === 0 && (
        <EmptyState
          icon={ShieldAlertIcon}
          title="Nothing awaiting authorization"
          description="Pending destructive actions appear here as missions run. The rest of the fleet is never blocked waiting for one."
        />
      )}

      {!isLoading && !error && data && data.items.length > 0 && (
        <div className="space-y-3">
          {data.items.map((item) => (
            <DestructiveActionRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
