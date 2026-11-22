// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * The control coverage tile (dashboard#396). It shows how many controls of
 * the first compliance pack have evidence, how many have none, and the date
 * of the last evidence. The tile opens the Compliance page. It shows evidence
 * states only, never a verdict (D56).
 *
 * Only the Owner and the Admin may read the evidence, so the tile renders
 * nothing for another role, and nothing for a tenant with no pack.
 */

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { FileTextIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getControlCoverageAction, listCompliancePacksAction } from "@/app/actions/compliance";
import { useAuthorize } from "@/src/lib/auth/use-authorize";
import { DEFAULT_RANGE_DAYS } from "@/components/gibson/compliance/texts";
import { summarizeCoverage } from "@/components/gibson/compliance/coverage";
import { CONTROL_COVERAGE_TEXT } from "./texts";

const COMPLIANCE_METHOD = "/gibson.tenant.v1.ComplianceService/ListComplianceEvidence";

/** The range of the last `days` days. It changes once each day, so the query key stays stable. */
function lastDays(days: number): { start: string; end: string } {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function ControlCoverageTile() {
  const { allowed, loading } = useAuthorize(COMPLIANCE_METHOD);
  const packs = useQuery({
    queryKey: ["compliance-packs"],
    queryFn: () => listCompliancePacksAction(),
    enabled: !loading && allowed,
    staleTime: 60_000,
  });
  const pack = packs.data?.ok ? (packs.data.data[0] ?? "") : "";
  const range = React.useMemo(() => lastDays(DEFAULT_RANGE_DAYS), []);
  const coverage = useQuery({
    queryKey: ["control-coverage", pack, range.start, range.end],
    queryFn: () => getControlCoverageAction({ pack, ...range }),
    enabled: pack !== "",
    staleTime: 60_000,
  });

  if (loading || !allowed) return null;
  if (packs.data?.ok && packs.data.data.length === 0) return null;

  let body: React.ReactNode;
  if (packs.isLoading || coverage.isLoading || (packs.data?.ok && !coverage.data)) {
    body = <Skeleton className="h-16 w-full" />;
  } else if (!coverage.data?.ok) {
    body = (
      <p className="text-sm text-muted-foreground" data-testid="control-coverage-error">
        {CONTROL_COVERAGE_TEXT.loadFailed}
      </p>
    );
  } else {
    const s = summarizeCoverage(coverage.data.data.controls);
    body = (
      <div className="space-y-1 text-sm">
        <p className="text-base font-semibold" data-testid="control-coverage-with">
          {CONTROL_COVERAGE_TEXT.withEvidence(s.withEvidence)}
        </p>
        <p className="text-muted-foreground" data-testid="control-coverage-without">
          {CONTROL_COVERAGE_TEXT.withoutEvidence(s.withoutEvidence)}
        </p>
        <p className="text-muted-foreground" data-testid="control-coverage-last">
          {s.lastEvidenceTime
            ? CONTROL_COVERAGE_TEXT.lastEvidence(new Date(s.lastEvidenceTime).toLocaleDateString())
            : CONTROL_COVERAGE_TEXT.noEvidence}
        </p>
      </div>
    );
  }

  return (
    <Link href="/dashboard/compliance" className="group block" aria-label={CONTROL_COVERAGE_TEXT.open}>
      <Card className="glass-hack border-highlight/40 transition-colors group-hover:border-highlight/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              {CONTROL_COVERAGE_TEXT.title}
            </CardTitle>
            <FileTextIcon className="h-4 w-4 text-highlight opacity-70" aria-hidden="true" />
          </div>
          <p className="text-xs text-muted-foreground">
            {pack ? `${pack}, ` : ""}
            {CONTROL_COVERAGE_TEXT.period(DEFAULT_RANGE_DAYS)}
          </p>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </Link>
  );
}
