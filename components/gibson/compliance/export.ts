// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * CSV and JSON export of the compliance evidence (D56). Both formats carry
 * the rows of the page and their events. Neither carries a verdict or a
 * score: the state column names the evidence state only.
 */

import type {
  ComplianceEvidenceDTO,
  ControlEvidenceDTO,
  EvidenceEventDTO,
} from "@/src/lib/gibson-client/compliance";

/** The events of one control, oldest first. */
export function eventsOf(
  control: ControlEvidenceDTO,
  events: readonly EvidenceEventDTO[],
): EvidenceEventDTO[] {
  return events.filter((e) => e.controlIds.includes(control.controlId));
}

const CSV_COLUMNS = [
  "family",
  "control_id",
  "title",
  "state",
  "event_count",
  "last_event_time",
  "audit_record_id",
  "event_time",
  "action",
  "actor_id",
  "resource_type",
  "resource_id",
] as const;

function csvCell(value: string | number): string {
  const s = String(value);
  // Quote every cell that needs it, and neutralize a leading formula sign.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One line for each event of each control, and one line for a control with none. */
export function toCsv(report: ComplianceEvidenceDTO): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const c of report.controls) {
    const base = [c.family, c.controlId, c.title, c.state, c.eventCount, c.lastEventTime];
    const events = eventsOf(c, report.events);
    if (events.length === 0) {
      lines.push([...base, "", "", "", "", "", ""].map(csvCell).join(","));
      continue;
    }
    for (const e of events) {
      lines.push(
        [...base, e.auditRecordId, e.time, e.action, e.actorId, e.resourceType, e.resourceId]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return lines.join("\n") + "\n";
}

/** The pack, the range, the coverage, and each control with its events. */
export function toJson(
  report: ComplianceEvidenceDTO,
  range: { start: string; end: string },
): string {
  return JSON.stringify(
    {
      pack: report.pack,
      packVersion: report.packVersion,
      start: range.start,
      end: range.end,
      controlsWithRule: report.controlsWithRule,
      controlsTotal: report.controlsTotal,
      controls: report.controls.map((c) => ({ ...c, events: eventsOf(c, report.events) })),
    },
    null,
    2,
  );
}

/** Hand a file to the browser. */
export function download(fileName: string, mime: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
