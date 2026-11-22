// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";
import { activityOfFinding, replayHref, type TimelineEventDto } from "../activity";

const events: TimelineEventDto[] = [
  { seq: 0, kind: "host.observed", time: "", replaySeq: 1 },
  { seq: 4, kind: "merge_request.observed", time: "2026-11-20T10:20:30.500Z", replaySeq: 5 },
  { seq: 1, kind: "finding.raised", time: "2026-11-20T10:00:00.000Z", replaySeq: 2 },
  { seq: 9, kind: "finding.status_changed", time: "", replaySeq: 10 },
  { seq: 8, kind: "check.rerun", time: "2026-11-20T10:50:00.000Z", replaySeq: 9 },
];

describe("activityOfFinding", () => {
  it("keeps the events of the life of a finding, in Timeline order", () => {
    expect(activityOfFinding(events).map((e) => e.seq)).toEqual([1, 4, 8, 9]);
  });

  it("drops an event of another kind", () => {
    expect(activityOfFinding(events).map((e) => e.kind)).not.toContain("host.observed");
  });

  it("labels each event from its kind", () => {
    expect(activityOfFinding(events).map((e) => e.label)).toEqual([
      "Raised",
      "Merge request",
      "Check ran again",
      "Status changed",
    ]);
  });

  it("passes the typed time and the replay seq through and parses no text", () => {
    const a = activityOfFinding(events);
    expect(a[1].time).toBe("2026-11-20T10:20:30.500Z");
    expect(a[3].time).toBe("");
    expect(a.map((e) => e.replaySeq)).toEqual([2, 5, 9, 10]);
  });
});

describe("replayHref", () => {
  it("opens the World page at the position", () => {
    expect(replayHref(7)).toBe("/dashboard/world?seq=7");
  });
});
