// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The activity strip of a finding (dashboard#393): the events of the Timeline
 * that belong to one finding, in Timeline order.
 *
 * GetTimeline has no filter by finding, and TimelineEvent has no field for the
 * finding, the merge request or the time. It carries `seq`, `kind` and
 * `summary`, and `summary` is the Go `%+v` text of the event. This file
 * therefore reads three facts from that text: the finding id (field `ID`), the
 * key of the merge request (fields `MergeRequest` and `Key`), and the time
 * (field `At`, or `EvidenceAt`). It is the one file that reads the text.
 * When TimelineEvent gets typed fields (a `finding_id` filter, a `time` and the
 * seq of the replay frame), the regeneration of the bindings replaces this file
 * with a direct read, and no other file changes.
 */

export interface TimelineEventDto {
  seq: number;
  kind: string;
  summary: string;
}

export interface FindingActivityEvent {
  /** The position on the Timeline. It opens the replay frame. */
  seq: number;
  kind: string;
  /** ISO time, or empty when the text of the event holds no time. */
  time: string;
  /** What the event says, in one line. */
  label: string;
}

/** The kinds of events of the life of a finding, in the order of the fix loop. */
const KIND_LABELS: Record<string, string> = {
  "finding.raised": "Raised",
  "finding.status_changed": "Status changed",
  "merge_request.observed": "Merge request",
  "deploy.observed": "Deployed",
  "health.observed": "Health signal",
  "health.unavailable": "No health signal",
  "fix.reverted": "Reverted",
  "check.rerun": "Check ran again",
};

function field(summary: string, name: string): string | null {
  const m = new RegExp(`(?:^|[\\s{])${name}:([^\\s}]*)`).exec(summary);
  return m ? m[1] : null;
}

/** The time of an event: `At`, or `EvidenceAt` for a check that ran again. */
function eventTime(summary: string): string {
  const m = /(?:^|[\s{])(?:At|EvidenceAt):(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)? ([+-]\d{4})/.exec(summary);
  if (!m) return "";
  const offset = `${m[4].slice(0, 3)}:${m[4].slice(3)}`;
  const t = new Date(`${m[1]}T${m[2]}${m[3] ?? ""}${offset}`);
  return Number.isNaN(t.getTime()) ? "" : t.toISOString();
}

function labelOf(e: TimelineEventDto): string {
  const base = KIND_LABELS[e.kind] ?? e.kind;
  switch (e.kind) {
    case "finding.status_changed": {
      const status = field(e.summary, "Status");
      return status ? `${base}: ${status}` : base;
    }
    case "merge_request.observed": {
      const state = field(e.summary, "State");
      return state ? `${base}: ${state}` : base;
    }
    case "health.observed": {
      const held = field(e.summary, "Held");
      return held === "true" ? `${base}: held` : held === "false" ? `${base}: failed` : base;
    }
    case "check.rerun": {
      const found = field(e.summary, "Found");
      return found === "true" ? `${base}: flaw found` : found === "false" ? `${base}: flaw not found` : base;
    }
    default:
      return base;
  }
}

/** The events of one finding, in Timeline order. An event of another finding or of another kind is dropped. */
export function activityOfFinding(
  events: readonly TimelineEventDto[],
  findingId: string,
): FindingActivityEvent[] {
  const lifeEvents = events.filter((e) => e.kind in KIND_LABELS);
  // The merge requests of the finding come from its own status changes.
  const mergeRequests = new Set<string>();
  for (const e of lifeEvents) {
    if (e.kind === "finding.status_changed" && field(e.summary, "ID") === findingId) {
      const mr = field(e.summary, "MergeRequest");
      if (mr) mergeRequests.add(mr);
    }
  }
  const out: FindingActivityEvent[] = [];
  for (const e of lifeEvents) {
    const id = field(e.summary, "ID");
    const mr = field(e.summary, "MergeRequest") ?? field(e.summary, "Key");
    const own = id !== null ? id === findingId : mr !== null && mergeRequests.has(mr);
    if (own) out.push({ seq: e.seq, kind: e.kind, time: eventTime(e.summary), label: labelOf(e) });
  }
  return out.sort((a, b) => a.seq - b.seq);
}

/** The page of the replay frame after an event. */
export function replayHref(seq: number): string {
  return `/dashboard/world?seq=${seq}`;
}
