// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The mission states of the daemon (gibson#1366). They carry the names of the
 * A2A Task states. The daemon sends one of these strings, or the enum name
 * MISSION_STATUS_<NAME>.
 *
 * One mission state is "canceled": the result of a user stop. The old
 * dashboard state "stopped" is gone.
 */
import type { MissionStatus } from "@/src/types";

const MISSION_STATUSES: readonly MissionStatus[] = [
  "submitted",
  "working",
  "input_required",
  "paused",
  "completed",
  "failed",
  "canceled",
];

/** The label of each state in the UI. */
export const MISSION_STATUS_LABELS: Record<MissionStatus, string> = {
  submitted: "Submitted",
  working: "Working",
  input_required: "Input required",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled",
  paused: "Paused",
};

/**
 * Read the state of a mission from the string that the daemon sends. An
 * unknown string reads as "submitted", the state that holds no run yet.
 */
export function parseMissionStatus(raw: string | undefined | null): MissionStatus {
  const s = (raw ?? "").trim().toLowerCase().replace("mission_status_", "");
  return (MISSION_STATUSES as readonly string[]).includes(s) ? (s as MissionStatus) : "submitted";
}

/** An active mission is working, or it waits for an answer to an approval request. */
export function isActiveMission(status: MissionStatus): boolean {
  return status === "working" || status === "input_required";
}

/** A mission that a person may stop is active or paused. */
export function canStopMission(status: MissionStatus): boolean {
  return isActiveMission(status) || status === "paused";
}

/** A mission that a person may start is submitted or paused. */
export function canStartMission(status: MissionStatus): boolean {
  return status === "submitted" || status === "paused";
}
