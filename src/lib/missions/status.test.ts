// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from "vitest";

import {
  MISSION_STATUS_LABELS,
  canStartMission,
  canStopMission,
  isActiveMission,
  parseMissionStatus,
} from "./status";

describe("parseMissionStatus", () => {
  it.each([
    ["submitted", "submitted"],
    ["working", "working"],
    ["input_required", "input_required"],
    ["completed", "completed"],
    ["failed", "failed"],
    ["canceled", "canceled"],
    ["paused", "paused"],
    ["MISSION_STATUS_WORKING", "working"],
    ["mission_status_canceled", "canceled"],
    [" Working ", "working"],
  ])("reads %s as %s", (raw, want) => {
    expect(parseMissionStatus(raw)).toBe(want);
  });

  it("reads an unknown, an empty and a missing state as submitted", () => {
    expect(parseMissionStatus("garbage")).toBe("submitted");
    expect(parseMissionStatus("")).toBe("submitted");
    expect(parseMissionStatus(undefined)).toBe("submitted");
  });

  it("does not accept a name that the daemon no longer sends", () => {
    for (const old of ["pending", "running", "cancelled", "stopped"]) {
      expect(parseMissionStatus(old)).toBe("submitted");
    }
  });
});

describe("the state rules", () => {
  it("counts a working mission and a mission with an open approval request as active", () => {
    expect(isActiveMission("working")).toBe(true);
    expect(isActiveMission("input_required")).toBe(true);
    for (const s of ["submitted", "paused", "completed", "failed", "canceled"] as const) {
      expect(isActiveMission(s)).toBe(false);
    }
  });

  it("lets a person stop an active or paused mission only", () => {
    expect(canStopMission("working")).toBe(true);
    expect(canStopMission("input_required")).toBe(true);
    expect(canStopMission("paused")).toBe(true);
    expect(canStopMission("submitted")).toBe(false);
    expect(canStopMission("canceled")).toBe(false);
  });

  it("lets a person start a submitted or paused mission only", () => {
    expect(canStartMission("submitted")).toBe(true);
    expect(canStartMission("paused")).toBe(true);
    expect(canStartMission("working")).toBe(false);
  });
});

describe("MISSION_STATUS_LABELS", () => {
  it("holds the seven labels of the UI", () => {
    expect(MISSION_STATUS_LABELS).toEqual({
      submitted: "Submitted",
      working: "Working",
      input_required: "Input required",
      completed: "Completed",
      failed: "Failed",
      canceled: "Canceled",
      paused: "Paused",
    });
  });
});
