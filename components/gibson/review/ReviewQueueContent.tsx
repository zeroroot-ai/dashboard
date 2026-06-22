"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2Icon, CircleSlashIcon, ShieldAlertIcon, XCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton, ErrorAlert } from "@/components/gibson/shared";
import { EmptyState } from "@/components/gibson/shared/EmptyState";

// ── Types (mirror the /api/world/review response) ────────────────────────────

type Verdict = "true_positive" | "false_positive" | "dismiss";

interface ReviewLabel {
  verdict: Verdict;
  severity: string;
  category: string;
  userId: string;
}

interface ReviewItem {
  targetId: string;
  kind: string; // "finding" | "surprise"
  title: string;
  scopeId: string;
  address: string;
  severity: string;
  labelled: boolean;
  label: ReviewLabel | null;
}

// ── Verdict presentation ─────────────────────────────────────────────────────

const VERDICT_LABELS: Record<Verdict, string> = {
  true_positive: "True positive",
  false_positive: "False positive",
  dismiss: "Dismiss",
};

const VERDICT_BADGE_CLASS: Record<Verdict, string> = {
  true_positive: "border-destructive/40 bg-destructive/10 text-destructive",
  false_positive: "border-border bg-muted/60 text-muted-foreground",
  dismiss: "border-border bg-muted/60 text-muted-foreground",
};

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <Badge className={`border font-mono text-xs uppercase tracking-wide ${VERDICT_BADGE_CLASS[verdict]}`}>
      {VERDICT_LABELS[verdict]}
    </Badge>
  );
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <Badge className="border border-border bg-muted/60 font-mono text-xs uppercase tracking-wide text-muted-foreground">
      {kind}
    </Badge>
  );
}

// ── Row label control ────────────────────────────────────────────────────────

function LabelControl({
  item,
  onSubmit,
  submitting,
}: {
  item: ReviewItem;
  onSubmit: (targetId: string, verdict: Verdict, category: string) => void;
  submitting: boolean;
}) {
  const [verdict, setVerdict] = React.useState<Verdict>(item.label?.verdict ?? "true_positive");
  const [category, setCategory] = React.useState(item.label?.category ?? "");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={verdict} onValueChange={(v) => setVerdict(v as Verdict)}>
        <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Verdict">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true_positive">
            <span className="inline-flex items-center gap-2">
              <CheckCircle2Icon className="size-3.5" /> True positive
            </span>
          </SelectItem>
          <SelectItem value="false_positive">
            <span className="inline-flex items-center gap-2">
              <XCircleIcon className="size-3.5" /> False positive
            </span>
          </SelectItem>
          <SelectItem value="dismiss">
            <span className="inline-flex items-center gap-2">
              <CircleSlashIcon className="size-3.5" /> Dismiss
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      <Input
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder="category (optional)"
        className="h-8 w-[160px] text-xs"
        aria-label="Category"
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={submitting}
        onClick={() => onSubmit(item.targetId, verdict, category)}
      >
        {item.labelled ? "Update" : "Label"}
      </Button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function ReviewQueueContent() {
  const [items, setItems] = React.useState<ReviewItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/world/review", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as { items: ReviewItem[] };
      setItems(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the review queue");
      setItems([]);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const submit = React.useCallback(
    async (targetId: string, verdict: Verdict, category: string) => {
      setSubmitting(targetId);
      try {
        const res = await fetch("/api/world/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetId, verdict, category }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
        }
        toast.success("Label recorded", {
          description: "It refines this tenant's next model. The running mission is unaffected.",
        });
        await load();
      } catch (e) {
        toast.error("Could not record label", {
          description: e instanceof Error ? e.message : "Unknown error",
        });
      } finally {
        setSubmitting(null);
      }
    },
    [load],
  );

  if (items === null && !error) {
    return <TableSkeleton />;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldAlertIcon className="size-6 text-highlight" /> Review queue
        </h1>
        <p className="text-sm text-muted-foreground">
          Label surfaced surprises and findings to teach this tenant&apos;s belief model. Labelling
          is asynchronous: it never blocks a running mission and only improves the next one.
        </p>
      </div>

      {error && <ErrorAlert title="Failed to load the review queue" error={{ message: error }} />}

      {items && items.length === 0 && !error ? (
        <EmptyState
          icon={ShieldAlertIcon}
          title="Nothing to review"
          description="Surfaced surprises and findings appear here as missions run. Label them to refine the model."
        />
      ) : (
        items &&
        items.length > 0 && (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Type</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-[160px]">Asset</TableHead>
                  <TableHead className="w-[120px]">Current label</TableHead>
                  <TableHead className="w-[400px]">Label</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.targetId}>
                    <TableCell>
                      <KindBadge kind={item.kind} />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{item.title}</div>
                      <div className="font-mono text-xs text-muted-foreground">{item.targetId}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {item.address || item.scopeId || "-"}
                    </TableCell>
                    <TableCell>
                      {item.labelled && item.label ? (
                        <VerdictBadge verdict={item.label.verdict} />
                      ) : (
                        <span className="text-xs text-muted-foreground">Unlabelled</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <LabelControl
                        item={item}
                        onSubmit={submit}
                        submitting={submitting === item.targetId}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      )}
    </div>
  );
}
