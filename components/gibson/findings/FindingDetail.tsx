// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * FindingDetail. The page of one finding: its fields and all its evidence.
 * The list of findings does not load evidence. This page calls GetFinding.
 * Every text of the finding comes from an agent or a target, so it shows as
 * plain text.
 */

import * as React from "react";
import Link from "next/link";

import { getFindingAction } from "@/app/actions/findings";
import { ErrorAlert, TableSkeleton } from "@/components/gibson/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FindingDetailDTO } from "@/src/lib/gibson-client/finding-types";
import { EvidenceList } from "./EvidenceList";

async function read(id: string): Promise<FindingDetailDTO | { error: string }> {
  try {
    const res = await getFindingAction(id);
    return res.ok ? res.data : { error: res.error || "The finding could not be loaded." };
  } catch {
    return { error: "The finding could not be loaded." };
  }
}

function localTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function FindingDetail({ id }: { id: string }) {
  const [state, setState] = React.useState<FindingDetailDTO | { error: string } | null>(null);

  React.useEffect(() => {
    let live = true;
    void read(id).then((r) => {
      if (live) setState(r);
    });
    return () => {
      live = false;
    };
  }, [id]);

  const back = (
    <nav className="text-muted-foreground text-sm">
      <Link href="/dashboard/findings" className="hover:text-foreground underline-offset-2 hover:underline">
        Findings
      </Link>
    </nav>
  );

  if (state === null) {
    return (
      <div className="space-y-6">
        {back}
        <TableSkeleton />
      </div>
    );
  }
  if ("error" in state) {
    return (
      <div className="space-y-6">
        {back}
        <ErrorAlert error={{ message: state.error }} title="The finding could not be loaded" />
      </div>
    );
  }

  const f = state;
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight break-words" data-testid="finding-title">
          {f.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="capitalize">
            {f.severity}
          </Badge>
          {f.category ? <Badge variant="secondary">{f.category}</Badge> : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="break-words whitespace-pre-wrap" data-testid="finding-description">
            {f.description}
          </p>
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">Confidence</dt>
            <dd>{Math.round(f.confidence * 100)}%</dd>
            {f.missionId ? (
              <>
                <dt className="text-muted-foreground">Mission</dt>
                <dd className="font-mono text-xs break-all">
                  <Link
                    href={`/dashboard/results/${encodeURIComponent(f.missionId)}`}
                    className="text-link underline-offset-2 hover:underline"
                  >
                    {f.missionId}
                  </Link>
                </dd>
              </>
            ) : null}
            {f.agentName ? (
              <>
                <dt className="text-muted-foreground">Agent</dt>
                <dd>{f.agentName}</dd>
              </>
            ) : null}
            {f.submittedBy ? (
              <>
                <dt className="text-muted-foreground">Submitted by</dt>
                <dd className="font-mono text-xs break-all">{f.submittedBy}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Created</dt>
            <dd>{localTime(f.createdAt)}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evidence</CardTitle>
          <p className="text-muted-foreground text-xs">
            This text comes from the target and from the agent. Treat it as untrusted.
          </p>
        </CardHeader>
        <CardContent>
          <EvidenceList evidence={f.evidence} />
        </CardContent>
      </Card>
    </div>
  );
}
