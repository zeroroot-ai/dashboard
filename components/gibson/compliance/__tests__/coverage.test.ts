// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";
import { summarizeCoverage } from "../coverage";
import type { ControlEvidenceDTO } from "@/src/lib/gibson-client/compliance";

function control(id: string, state: ControlEvidenceDTO["state"], last = ""): ControlEvidenceDTO {
  return {
    controlId: id,
    title: id,
    family: "AC",
    familyTitle: "Access Control",
    state,
    eventCount: state === "has_evidence" ? 1 : 0,
    lastEventTime: last,
  };
}

describe("summarizeCoverage", () => {
  it("counts the controls with and without evidence and finds the newest evidence", () => {
    const s = summarizeCoverage([
      control("AC-2", "has_evidence", "2026-10-01T12:00:00.000Z"),
      control("AC-3", "has_evidence", "2026-11-01T12:00:00.000Z"),
      control("AC-7", "no_events"),
      control("AU-2", "no_rule"),
    ]);
    expect(s).toEqual({
      withEvidence: 2,
      withoutEvidence: 2,
      total: 4,
      lastEvidenceTime: "2026-11-01T12:00:00.000Z",
    });
  });

  it("gives no last evidence time when no control has evidence", () => {
    expect(summarizeCoverage([control("AC-7", "no_events")]).lastEvidenceTime).toBeNull();
    expect(summarizeCoverage([])).toEqual({
      withEvidence: 0,
      withoutEvidence: 0,
      total: 0,
      lastEvidenceTime: null,
    });
  });
});
