// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * Panel 1 of the first screen: the findings that are not verified
 * (dashboard#388, dashboard#383, dashboard#389).
 *
 * The source is WorldService.ListOpenFindings (gibson#1498). The daemon gives
 * the rank order, and the panel sorts nothing. Each row shows the status, the
 * priority with its rule, the place, the confidence and the link to the merge
 * request of the fix. A value that the daemon does not send shows as unknown.
 */

import * as React from "react";
import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert } from "@/components/gibson/shared/ErrorAlert";
import { TableSkeleton } from "@/components/gibson/shared/DataSkeleton";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/gibson/findings/SeverityBadge";
import { FINDINGS_TEXT } from "@/components/gibson/findings/texts";
import { useOpenFindings } from "@/src/hooks/useOpenFindings";
import { formatConfidence } from "@/src/lib/findings/confidence";
import { findingGraphHref } from "@/src/lib/graph/finding-link";
import { FINDINGS_PANEL_TEXT } from "./texts";

const PANEL_LIMIT = 10;

export function FindingsPanel() {
  const { data, isLoading, error, refetch } = useOpenFindings(PANEL_LIMIT);
  const findings = data?.findings ?? [];

  return (
    <Card className="glass-hack border-highlight/40" data-testid="panel-findings">
      <CardHeader className="space-y-1 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
            {FINDINGS_PANEL_TEXT.title}
          </CardTitle>
          <AlertTriangleIcon className="h-4 w-4 text-highlight opacity-70" aria-hidden="true" />
        </div>
        <p className="text-xs text-muted-foreground" data-testid="findings-panel-note">
          {FINDINGS_PANEL_TEXT.note}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <TableSkeleton rows={4} cols={3} />
        ) : error ? (
          <ErrorAlert
            error={error}
            title={FINDINGS_PANEL_TEXT.loadFailed}
            retry={() => void refetch()}
          />
        ) : findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">{FINDINGS_PANEL_TEXT.empty}</p>
        ) : (
          <ul className="space-y-2">
            {findings.map((finding) => (
              <li
                key={finding.id}
                className="space-y-1 rounded border border-border px-3 py-2"
                data-testid="finding-row"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <SeverityBadge severity={finding.severity} />
                    <Badge variant="outline" className="font-mono text-xs" data-testid="finding-row-status">
                      {finding.status ?? FINDINGS_PANEL_TEXT.unknown}
                    </Badge>
                    <Badge variant="outline" className="font-mono text-xs" data-testid="finding-row-priority">
                      {finding.priority ?? FINDINGS_PANEL_TEXT.noPriority}
                    </Badge>
                    <Link
                      href={`/dashboard/findings/${encodeURIComponent(finding.id)}`}
                      className="truncate text-sm font-medium underline-offset-2 hover:underline"
                    >
                      {finding.title}
                    </Link>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="tabular-nums" data-testid="finding-row-confidence">
                      {FINDINGS_PANEL_TEXT.confidence}:{" "}
                      {formatConfidence(finding.confidence, FINDINGS_TEXT.confidenceUnknown)}
                    </span>
                    {finding.mergeRequestUrl && (
                      <a
                        href={finding.mergeRequestUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-highlight"
                        data-testid="finding-merge-request"
                      >
                        {FINDINGS_PANEL_TEXT.mergeRequest}
                      </a>
                    )}
                    <Link
                      href={findingGraphHref(finding.id)}
                      className="underline underline-offset-2 hover:text-highlight"
                      data-testid="finding-attack-path"
                    >
                      {FINDINGS_PANEL_TEXT.attackPath}
                    </Link>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground" data-testid="finding-row-detail">
                  {FINDINGS_PANEL_TEXT.place}:{" "}
                  {finding.places.length > 0
                    ? finding.places.map((p) => p.label || p.key).join(", ")
                    : FINDINGS_PANEL_TEXT.unknown}
                  {finding.priority && finding.priorityRule
                    ? ` | ${FINDINGS_PANEL_TEXT.rule}: ${finding.priorityRule}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          {!isLoading && !error && data?.nextCursor && (
            <span data-testid="findings-panel-more">{FINDINGS_PANEL_TEXT.more(findings.length)}</span>
          )}
          <Link href="/dashboard/findings" className="underline underline-offset-2 hover:text-highlight">
            {FINDINGS_PANEL_TEXT.all}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
