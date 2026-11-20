// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * Panel 1 of the first screen: the findings that are not verified
 * (dashboard#388, dashboard#383).
 *
 * The API does not return the status of a finding, or the rank, yet
 * (gibson#1498). The panel lists the findings that /api/findings returns
 * today, in the order that the API gives. It shows no status and sorts
 * nothing. Each finding links to its detail page.
 */

import * as React from "react";
import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert } from "@/components/gibson/shared/ErrorAlert";
import { TableSkeleton } from "@/components/gibson/shared/DataSkeleton";
import { SeverityBadge } from "@/components/gibson/findings/SeverityBadge";
import { FINDINGS_TEXT } from "@/components/gibson/findings/texts";
import { useFindings } from "@/src/hooks/useFindings";
import { formatConfidence } from "@/src/lib/findings/confidence";
import { findingGraphHref } from "@/src/lib/graph/finding-link";
import { FINDINGS_PANEL_TEXT } from "./texts";

const PANEL_LIMIT = 10;

export function FindingsPanel() {
  const { data, isLoading, error, refetch } = useFindings({}, { limit: PANEL_LIMIT });
  const findings = data?.data ?? [];
  const total = data?.total ?? 0;

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
                className="flex flex-wrap items-center justify-between gap-3 rounded border border-border px-3 py-2"
                data-testid="finding-row"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <SeverityBadge severity={finding.severity} />
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
                  <Link
                    href={findingGraphHref(finding.id)}
                    className="underline underline-offset-2 hover:text-highlight"
                    data-testid="finding-attack-path"
                  >
                    {FINDINGS_PANEL_TEXT.attackPath}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          {!isLoading && !error && total > findings.length && (
            <span>{FINDINGS_PANEL_TEXT.more(findings.length, total)}</span>
          )}
          <Link href="/dashboard/findings" className="underline underline-offset-2 hover:text-highlight">
            {FINDINGS_PANEL_TEXT.all}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
