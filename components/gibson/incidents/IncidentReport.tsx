// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * The page of the report of one incident (ADR-0180, gibson#1480). It lists the
 * alerts, what the incident reaches, each response action with its outcome,
 * its grant and its controls, the cause, the fix and the proof of the fix.
 * Each line links to its replay frame on the World page. A line that the
 * Timeline holds no event for shows no link. Every text of an alert, a tool
 * result or a finding comes from a target or an agent, so it shows as plain
 * text.
 */

import * as React from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert } from "@/components/gibson/shared/ErrorAlert";
import { TableSkeleton } from "@/components/gibson/shared/DataSkeleton";
import { useIncidentReport } from "@/src/hooks/useIncidentReport";
import { useSession } from "@/src/lib/session-client";
import { useUserRefs } from "@/src/hooks/useUserRefs";
import { principalLabel } from "@/src/lib/principals/label";
import { frameHref, type FrameView } from "@/src/lib/incidents/incident-report";
import { INCIDENT_TEXT } from "./texts";

function Replay({ frame }: { frame: FrameView }) {
  const href = frameHref(frame);
  return href ? (
    <Link
      href={href}
      className="text-xs underline underline-offset-2 hover:text-highlight"
      data-testid="incident-replay"
    >
      {INCIDENT_TEXT.replay}
    </Link>
  ) : (
    <span className="text-xs text-muted-foreground" data-testid="incident-no-frame">
      {INCIDENT_TEXT.noFrame}
    </span>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {empty ? <p className="text-sm text-muted-foreground">{INCIDENT_TEXT.none}</p> : children}
      </CardContent>
    </Card>
  );
}

const ROW = "flex flex-wrap items-start justify-between gap-2 rounded border border-border px-3 py-2 text-sm";

export function IncidentReport({ incidentKey }: { incidentKey: string }) {
  const { data, isLoading, error, refetch } = useIncidentReport(incidentKey);
  const { data: session } = useSession();
  const myUserId = session?.user.id ?? null;
  const grantors = React.useMemo(
    () =>
      [...new Set((data?.actions ?? []).map((a) => a.grant?.grantedBy).filter((g): g is string => !!g && g !== myUserId))].sort(),
    [data, myUserId],
  );
  const { data: userRefs } = useUserRefs(grantors);

  const back = (
    <nav className="text-muted-foreground text-sm">
      <Link href="/dashboard/graph" className="hover:text-foreground underline-offset-2 hover:underline">
        {INCIDENT_TEXT.back}
      </Link>
    </nav>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {back}
        <TableSkeleton />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-6">
        {back}
        <ErrorAlert
          error={error ?? new Error(INCIDENT_TEXT.loadFailed)}
          title={INCIDENT_TEXT.loadFailed}
          retry={() => void refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="incident-report">
      <div className="space-y-2">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight break-words">
          {INCIDENT_TEXT.title}: <span className="font-mono text-lg">{data.incidentKey}</span>
        </h1>
        <p className="text-xs text-muted-foreground">{INCIDENT_TEXT.timelineTotal(data.timelineTotal)}</p>
      </div>

      <Section title={INCIDENT_TEXT.alerts} empty={data.alerts.length === 0}>
        <ul className="space-y-2" data-testid="incident-alerts">
          {data.alerts.map((a) => (
            <li key={a.key} className={ROW}>
              <span className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">
                  {a.severity || "unknown"}
                </Badge>
                {a.title || a.key}
                <span className="text-xs text-muted-foreground">{a.source}</span>
              </span>
              <Replay frame={a.frame} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title={INCIDENT_TEXT.reached} empty={data.reached.length === 0}>
        <ul className="space-y-2" data-testid="incident-reached">
          {data.reached.map((r) => (
            <li key={`${r.alertKey}|${r.key}`} className={ROW}>
              <span>
                <span className="text-xs text-muted-foreground">{r.label}</span> {r.key}
              </span>
              <Replay frame={r.frame} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title={INCIDENT_TEXT.actions} empty={data.actions.length === 0}>
        <ul className="space-y-2" data-testid="incident-actions">
          {data.actions.map((a, i) => (
            <li key={`${a.toolId}|${a.frame.timelineSeq}|${i}`} className="space-y-1 rounded border border-border px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Badge variant="outline" data-testid="incident-action-outcome">
                    {INCIDENT_TEXT.outcomes[a.outcome]}
                  </Badge>
                  <span className="font-mono text-xs">{a.toolId || `${a.connector}:${a.tool}`}</span>
                </span>
                <Replay frame={a.frame} />
              </div>
              <p className="text-xs text-muted-foreground">
                {INCIDENT_TEXT.agent}: {a.agentName || "unknown"}.{" "}
                <span data-testid="incident-action-grant">
                  {a.grant
                    ? `${INCIDENT_TEXT.grant}: ${a.grant.capability}. ${INCIDENT_TEXT.grantedBy}: ${
                        a.grant.grantedBy
                          ? principalLabel({ kind: "user", id: a.grant.grantedBy }, myUserId, userRefs)
                          : "unknown"
                      }.`
                    : INCIDENT_TEXT.noGrant}
                </span>
              </p>
              {a.error && <p className="text-xs text-destructive break-words">{a.error}</p>}
              {a.result && <p className="text-xs text-muted-foreground break-words">{a.result}</p>}
              {a.controlIds.length > 0 && (
                <p className="text-xs font-mono text-muted-foreground" data-testid="incident-action-controls">
                  {a.controlIds.join(", ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={INCIDENT_TEXT.causes} empty={data.causes.length === 0}>
        <ul className="space-y-2" data-testid="incident-causes">
          {data.causes.map((c) => (
            <li key={c.findingKey} className="space-y-1 rounded border border-border px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/dashboard/findings/${encodeURIComponent(c.findingKey)}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {c.title || c.findingKey}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {INCIDENT_TEXT.statusNow}: {c.status || "unknown"}
                </span>
              </div>
              <ol className="space-y-1">
                <li className="flex items-center justify-between gap-2 text-xs">
                  <span>{INCIDENT_TEXT.raised}</span>
                  <Replay frame={c.raised} />
                </li>
                {c.history.map((h, i) => (
                  <li key={`${h.status}|${i}`} className="flex items-center justify-between gap-2 text-xs">
                    <span>{h.status}</span>
                    <Replay frame={h.frame} />
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={INCIDENT_TEXT.fixes} empty={data.fixes.length === 0}>
        <ul className="space-y-2" data-testid="incident-fixes">
          {data.fixes.map((f) => (
            <li key={`${f.findingKey}|${f.mergeRequestKey}`} className="space-y-1 rounded border border-border px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {INCIDENT_TEXT.mergeRequest}:{" "}
                  {f.url ? (
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-highlight">
                      {f.ref || f.mergeRequestKey}
                    </a>
                  ) : (
                    f.ref || f.mergeRequestKey
                  )}
                </span>
                <Replay frame={f.frame} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span data-testid="incident-fix-proof">
                  {f.verified.known
                    ? `${INCIDENT_TEXT.verified}${f.verifiedBy ? `. ${INCIDENT_TEXT.verifiedBy}: ${f.verifiedBy}` : ""}`
                    : INCIDENT_TEXT.notVerified}
                </span>
                {f.verified.known && <Replay frame={f.verified} />}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={INCIDENT_TEXT.controls} empty={data.controlIds.length === 0}>
        <p className="mb-2 text-xs text-muted-foreground">{INCIDENT_TEXT.controlsNote}</p>
        <p className="font-mono text-xs" data-testid="incident-controls">
          {data.controlIds.join(", ")}
        </p>
      </Section>
    </div>
  );
}
