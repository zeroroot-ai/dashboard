// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";
import { activityOfFinding, replayHref, type TimelineEventDto } from "../activity";

const MR = "https://git.example/g/r/-/merge_requests/4";

const events: TimelineEventDto[] = [
  { seq: 0, kind: "host.observed", summary: "{ScopeID:s Address:1.2.3.4}" },
  {
    seq: 1,
    kind: "finding.raised",
    summary: "{ID:f1 Title:SQLi MissionID:m1 At:2026-11-20 10:00:00 +0000 UTC FirstSeenAt:2026-11-20 09:00:00 +0000 UTC}",
  },
  { seq: 2, kind: "finding.raised", summary: "{ID:f2 Title:Other At:2026-11-20 10:05:00 +0000 UTC}" },
  {
    seq: 3,
    kind: "finding.status_changed",
    summary: `{ID:f1 Status:fixing MissionID:m1 MergeRequest:${MR} At:2026-11-20 10:10:00 +0000 UTC}`,
  },
  { seq: 4, kind: "merge_request.observed", summary: `{Key:${MR} State:merged MissionID: At:2026-11-20 10:20:30.5 -0600 CST}` },
  { seq: 5, kind: "merge_request.observed", summary: "{Key:https://git.example/other/4 State:merged At:2026-11-20 10:21:00 +0000 UTC}" },
  { seq: 6, kind: "deploy.observed", summary: `{MergeRequest:${MR} DeploymentKey:d1 At:2026-11-20 10:30:00 +0000 UTC}` },
  { seq: 7, kind: "health.observed", summary: `{MergeRequest:${MR} Held:true At:2026-11-20 10:40:00 +0000 UTC}` },
  { seq: 8, kind: "check.rerun", summary: "{ID:f1 CheckKind:scan Found:false EvidenceAt:2026-11-20 10:50:00 +0000 UTC}" },
  { seq: 9, kind: "finding.status_changed", summary: "{ID:f1 Status:verified MissionID: MergeRequest: At:2026-11-20 10:51:00 +0000 UTC}" },
];

describe("activityOfFinding", () => {
  it("keeps the events of the finding and of its merge request, in Timeline order", () => {
    const a = activityOfFinding([...events].reverse(), "f1");
    expect(a.map((e) => e.seq)).toEqual([1, 3, 4, 6, 7, 8, 9]);
  });

  it("drops the events of another finding, of another merge request and of another kind", () => {
    const seqs = activityOfFinding(events, "f1").map((e) => e.seq);
    for (const other of [0, 2, 5]) expect(seqs).not.toContain(other);
  });

  it("labels each event from its kind and its fields", () => {
    expect(activityOfFinding(events, "f1").map((e) => e.label)).toEqual([
      "Raised",
      "Status changed: fixing",
      "Merge request: merged",
      "Deployed",
      "Health signal: held",
      "Check ran again: flaw not found",
      "Status changed: verified",
    ]);
  });

  it("reads the time of an event, with its zone, and leaves it empty when the text holds none", () => {
    const a = activityOfFinding(events, "f1");
    expect(a[0].time).toBe("2026-11-20T10:00:00.000Z");
    expect(a[2].time).toBe("2026-11-20T16:20:30.500Z");
    expect(a[5].time).toBe("2026-11-20T10:50:00.000Z");
    const none = activityOfFinding([{ seq: 0, kind: "finding.raised", summary: "{ID:f1}" }], "f1");
    expect(none[0].time).toBe("");
  });

  it("does not match a finding id inside another id or inside MissionID", () => {
    const e: TimelineEventDto[] = [{ seq: 0, kind: "finding.raised", summary: "{ID:f10 MissionID:f1}" }];
    expect(activityOfFinding(e, "f1")).toEqual([]);
  });
});

describe("replayHref", () => {
  it("opens the World page at the position", () => {
    expect(replayHref(7)).toBe("/dashboard/world?seq=7");
  });
});
