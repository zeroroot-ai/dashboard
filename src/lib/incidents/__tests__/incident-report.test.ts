// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  GetIncidentReportResponseSchema,
  IncidentAction_Outcome,
} from "@/src/gen/gibson/tenant/v1/incident_report_pb";
import { frameHref, incidentReportHref, toIncidentReport } from "../incident-report";

describe("toIncidentReport", () => {
  const report = toIncidentReport(
    create(GetIncidentReportResponseSchema, {
      incidentKey: "inc-1",
      timelineTotal: BigInt(20),
      controlIds: ["ac-12"],
      alerts: [{ key: "a1", title: "T", frame: { known: true, timelineSeq: BigInt(4), replaySeq: BigInt(5) } }],
      actions: [
        {
          toolId: "mcp:edr:isolate_host",
          outcome: IncidentAction_Outcome.DONE,
          grant: { id: "g1", capability: "isolate", grantedBy: "u1", grantedAtUnix: BigInt(1_700_000_000) },
          frame: { known: true, timelineSeq: BigInt(7), replaySeq: BigInt(8) },
        },
        { toolId: "mcp:edr:kill", outcome: IncidentAction_Outcome.REFUSED },
      ],
      fixes: [{ findingKey: "f1", mergeRequestKey: "mr", url: "javascript:alert(1)" }],
    }),
  );

  it("maps the lines, the outcome, the grant and the Timeline positions", () => {
    expect(report.incidentKey).toBe("inc-1");
    expect(report.timelineTotal).toBe(20);
    expect(report.alerts[0].frame).toEqual({ known: true, timelineSeq: 4, replaySeq: 5 });
    expect(report.actions[0]).toMatchObject({ outcome: "done", grant: { id: "g1", grantedBy: "u1" } });
    expect(report.actions[1]).toMatchObject({ outcome: "refused", grant: null });
  });

  it("marks a line with no Timeline event as unknown and drops a URL that is not http", () => {
    expect(report.actions[1].frame.known).toBe(false);
    expect(report.fixes[0].url).toBe("");
  });
});

describe("frameHref", () => {
  it("links a known frame to the World page and gives no link for an unknown one", () => {
    expect(frameHref({ known: true, timelineSeq: 7, replaySeq: 8 })).toBe("/dashboard/world?seq=7");
    expect(frameHref({ known: false, timelineSeq: 0, replaySeq: 0 })).toBeNull();
  });

  it("encodes the key of an incident", () => {
    expect(incidentReportHref("a/b")).toBe("/dashboard/incidents/a%2Fb");
  });
});
