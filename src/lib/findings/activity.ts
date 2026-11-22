// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The activity strip of a finding (dashboard#393): the events of the Timeline
 * that belong to one finding, in Timeline order.
 *
 * GetTimeline keeps the events of one finding when the request names the
 * finding. Each event carries its own time, its replay seq, and the finding
 * and merge request that it names. This file reads those typed fields and
 * parses no text.
 */

export interface TimelineEventDto {
  /** The position of the event on the unfiltered Timeline. */
  seq: number;
  kind: string;
  /** ISO time, or empty when the event holds no time. */
  time: string;
  /** The seq to give the World frame call for the frame just after the event. */
  replaySeq: number;
}

export interface FindingActivityEvent {
  /** The position on the Timeline. */
  seq: number;
  /** The seq of the replay frame after the event. */
  replaySeq: number;
  kind: string;
  /** ISO time, or empty when the event holds no time. */
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

/** The events of the life of a finding, in Timeline order. An event of another kind is dropped. */
export function activityOfFinding(events: readonly TimelineEventDto[]): FindingActivityEvent[] {
  return events
    .filter((e) => e.kind in KIND_LABELS)
    .map((e) => ({
      seq: e.seq,
      replaySeq: e.replaySeq,
      kind: e.kind,
      time: e.time,
      label: KIND_LABELS[e.kind],
    }))
    .sort((a, b) => a.seq - b.seq);
}

/** The page of the replay frame after an event. */
export function replayHref(replaySeq: number): string {
  return `/dashboard/world?seq=${replaySeq}`;
}
