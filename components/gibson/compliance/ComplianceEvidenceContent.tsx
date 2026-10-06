// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * ComplianceEvidenceContent — the compliance evidence page (dashboard#224,
 * ADR-0113, D56).
 *
 * For a framework pack and a time range (90 days by default), one row for
 * each control, grouped by family: the id, the title, the number of
 * evidence events and the time of the last one. A row opens its events, and
 * each event links to its audit record. The page exports the rows and their
 * events as CSV and as JSON.
 *
 * The page shows evidence, never a verdict: no color that means good or
 * bad, no percentage and no score. Every visible text is an approved text
 * of D56 or data from the daemon.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorAlert, TableSkeleton } from "@/components/gibson/shared";
import { getComplianceEvidenceAction } from "@/app/actions/compliance";
import type {
  ComplianceEvidenceDTO,
  ControlEvidenceDTO,
  EvidenceEventDTO,
} from "@/src/lib/gibson-client/compliance";
import { COMPLIANCE_TEXT, DEFAULT_RANGE_DAYS, coverageText } from "./texts";
import { download, eventsOf, toCsv, toJson } from "./export";

/** yyyy-mm-dd of a local date. */
function dayString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The ISO range for two local days: the start day, through the end day. */
function rangeOf(startDay: string, endDay: string): { start: string; end: string } {
  const start = new Date(`${startDay}T00:00:00`);
  const end = new Date(`${endDay}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function localTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

/** The anchor of one audit record on this page. */
function auditRecordAnchor(id: string): string {
  return `audit-record-${id}`;
}

interface ComplianceEvidenceContentProps {
  /** The enabled framework packs of the tenant. Empty means no pack. */
  packs: string[];
}

export function ComplianceEvidenceContent({ packs }: ComplianceEvidenceContentProps) {
  const [pack, setPack] = React.useState(packs[0] ?? "");
  const [endDay, setEndDay] = React.useState(() => dayString(new Date()));
  const [startDay, setStartDay] = React.useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - DEFAULT_RANGE_DAYS);
    return dayString(d);
  });
  const range = React.useMemo(() => rangeOf(startDay, endDay), [startDay, endDay]);

  const query = useQuery({
    queryKey: ["compliance-evidence", pack, range.start, range.end],
    queryFn: () => getComplianceEvidenceAction({ pack, ...range }),
    enabled: pack !== "",
  });
  const report = query.data?.ok ? query.data.data : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{COMPLIANCE_TEXT.title}</h1>
        <p className="text-muted-foreground text-sm">{COMPLIANCE_TEXT.intro}</p>
      </div>

      {packs.length === 0 ? (
        <p className="text-sm" data-testid="compliance-no-pack">
          {COMPLIANCE_TEXT.noPack}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Framework"
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              value={pack}
              onChange={(e) => setPack(e.target.value)}
            >
              {packs.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Input
              type="date"
              aria-label="Start"
              className="w-auto"
              value={startDay}
              max={endDay}
              onChange={(e) => e.target.value && setStartDay(e.target.value)}
            />
            <Input
              type="date"
              aria-label="End"
              className="w-auto"
              value={endDay}
              min={startDay}
              onChange={(e) => e.target.value && setEndDay(e.target.value)}
            />
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!report}
                onClick={() =>
                  report && download(`${report.pack}-evidence.csv`, "text/csv", toCsv(report))
                }
              >
                {COMPLIANCE_TEXT.exportCsv}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!report}
                onClick={() =>
                  report &&
                  download(`${report.pack}-evidence.json`, "application/json", toJson(report, range))
                }
              >
                {COMPLIANCE_TEXT.exportJson}
              </Button>
            </div>
          </div>

          {query.isLoading ? (
            <TableSkeleton rows={6} />
          ) : query.data && !query.data.ok ? (
            <ErrorAlert error={{ message: query.data.error }} />
          ) : report ? (
            <EvidenceReport report={report} />
          ) : null}
        </>
      )}
    </div>
  );
}

function EvidenceReport({ report }: { report: ComplianceEvidenceDTO }) {
  const families = React.useMemo(() => {
    const groups = new Map<string, { title: string; controls: ControlEvidenceDTO[] }>();
    for (const c of report.controls) {
      const g = groups.get(c.family) ?? { title: c.familyTitle || c.family, controls: [] };
      g.controls.push(c);
      groups.set(c.family, g);
    }
    return [...groups.entries()];
  }, [report.controls]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" data-testid="compliance-coverage">
        {coverageText(report.controlsWithRule, report.controlsTotal)}
      </p>
      {families.map(([family, group]) => (
        <Card key={family} data-testid="compliance-family">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{group.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {group.controls.map((c) => (
              <ControlRow key={c.controlId} control={c} events={eventsOf(c, report.events)} />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ControlRow({
  control,
  events,
}: {
  control: ControlEvidenceDTO;
  events: EvidenceEventDTO[];
}) {
  const summary = (
    <span className="grid w-full grid-cols-[8rem_1fr_auto] items-baseline gap-3 text-sm">
      <span className="font-mono">{control.controlId}</span>
      <span>{control.title}</span>
      <span className="text-muted-foreground tabular-nums">
        {control.state === "no_rule"
          ? COMPLIANCE_TEXT.noRule
          : control.state === "no_events"
            ? COMPLIANCE_TEXT.noEvents
            : `${control.eventCount} · ${localTime(control.lastEventTime)}`}
      </span>
    </span>
  );

  if (control.state !== "has_evidence") {
    return (
      <div className="py-1" data-testid="compliance-control" data-state={control.state}>
        {summary}
      </div>
    );
  }
  return (
    <details className="py-1" data-testid="compliance-control" data-state={control.state}>
      <summary className="cursor-pointer list-none">{summary}</summary>
      <ul className="mt-2 space-y-1 border-l pl-4">
        {events.map((e) => (
          <li
            key={`${control.controlId}-${e.auditRecordId}`}
            id={auditRecordAnchor(e.auditRecordId)}
            className="grid grid-cols-[auto_auto_1fr] gap-3 text-xs font-mono"
            data-testid="compliance-event"
          >
            <a href={`#${auditRecordAnchor(e.auditRecordId)}`} className="underline-offset-2 hover:underline">
              {e.auditRecordId}
            </a>
            <span>{localTime(e.time)}</span>
            <span className="text-muted-foreground">
              {e.action} {e.actorId} {e.resourceType}/{e.resourceId}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
