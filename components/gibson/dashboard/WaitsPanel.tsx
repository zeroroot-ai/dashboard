// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * Panel 4 of the first screen: "What waits on a person?" (dashboard#386,
 * dashboard#398). The head shows the count of items and the age of the oldest
 * item. The list shows the longest wait first. Each row shows its wait and one
 * link to the place where a person acts. A destructive action also shows its
 * blast radius and its reversibility.
 *
 * Today the one source is the queue of pending destructive actions. The
 * panel lists `WaitItem` values, so the three other kinds need no change here.
 */

import * as React from "react";
import Link from "next/link";
import { UserCheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert } from "@/components/gibson/shared/ErrorAlert";
import { TableSkeleton } from "@/components/gibson/shared/DataSkeleton";
import { useWaitItems } from "@/src/hooks/useWaitItems";
import {
  formatWait,
  sortByLongestWait,
  summarizeWaits,
  waitMs,
  type WaitItem,
} from "@/src/lib/waits/wait-items";
import { WAITS_TEXT } from "./texts";

/** The current time. It updates each minute, the unit of the wait text. */
function useNowEveryMinute(): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function reversibilityText(item: WaitItem): string | null {
  if (item.kind !== "destructive-action") return null;
  if (item.reversibility === "reversible") return WAITS_TEXT.reversible;
  if (item.reversibility === "irreversible") return WAITS_TEXT.irreversible;
  return WAITS_TEXT.reversibilityUnknown;
}

function WaitRow({ item, nowMs }: { item: WaitItem; nowMs: number }) {
  const wait = waitMs(item, nowMs);
  const reversibility = reversibilityText(item);
  return (
    <li
      className="flex flex-wrap items-start justify-between gap-3 rounded border border-border px-3 py-2"
      data-testid="wait-row"
      data-kind={item.kind}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs uppercase tracking-wide">
            {WAITS_TEXT.kinds[item.kind]}
          </Badge>
          <span className="truncate text-sm font-medium">{item.title}</span>
        </div>
        {item.kind === "destructive-action" && (
          <p className="text-xs text-muted-foreground" data-testid="wait-detail">
            {WAITS_TEXT.blastRadius}: {item.blastRadius || WAITS_TEXT.blastRadiusUnknown}.{" "}
            {reversibility}.
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-muted-foreground tabular-nums" data-testid="wait-age">
          {WAITS_TEXT.waitLabel}: {wait === null ? WAITS_TEXT.waitUnknown : formatWait(wait)}
        </span>
        <Link href={item.href} className="underline underline-offset-2 hover:text-highlight">
          {WAITS_TEXT.open}
        </Link>
      </div>
    </li>
  );
}

export function WaitsPanel() {
  const { items, isLoading, error, refetch } = useWaitItems();
  const nowMs = useNowEveryMinute();
  const sorted = React.useMemo(() => sortByLongestWait(items, nowMs), [items, nowMs]);
  const summary = React.useMemo(() => summarizeWaits(items, nowMs), [items, nowMs]);

  return (
    <Card className="glass-hack border-highlight/40" data-testid="panel-waits">
      <CardHeader className="space-y-1 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
            {WAITS_TEXT.title}
          </CardTitle>
          <UserCheckIcon className="h-4 w-4 text-highlight opacity-70" aria-hidden="true" />
        </div>
        {!isLoading && !error && (
          <p className="flex flex-wrap gap-x-4 text-sm" data-testid="waits-summary">
            <span className="font-semibold">{WAITS_TEXT.count(summary.count)}</span>
            {summary.count > 0 && (
              <span className="text-muted-foreground">
                {summary.oldestMs === null
                  ? WAITS_TEXT.oldestUnknown
                  : WAITS_TEXT.oldest(formatWait(summary.oldestMs))}
              </span>
            )}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <TableSkeleton rows={2} cols={2} />
        ) : error ? (
          <ErrorAlert error={error} title={WAITS_TEXT.loadFailed} retry={refetch} />
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">{WAITS_TEXT.empty}</p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((item) => (
              <WaitRow key={item.id} item={item} nowMs={nowMs} />
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground" data-testid="waits-missing-kinds">
          {WAITS_TEXT.missingKinds}
        </p>
      </CardContent>
    </Card>
  );
}
