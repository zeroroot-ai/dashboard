// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/** The texts of the Findings page. */
export const FINDINGS_TEXT = {
  confidenceColumn: "Confidence",
  confidenceUnknown: "unknown",
  statusColumn: "Status",
  priorityColumn: "Priority",
  placeColumn: "Place",
  mergeRequestColumn: "Merge request",
  unknown: "unknown",
  noPriority: "none",
  noMergeRequest: "none",
  openMergeRequest: "Open",
} as const;

/** The texts of the activity strip of a finding. */
export const ACTIVITY_TEXT = {
  title: "Activity",
  windowOpen: "Exposure window so far",
  windowVerified: "Exposure window",
  agentTime: "Agent time",
  waitTime: "Wait time",
  noExposure: "The Timeline holds no event for this finding, so it has no exposure window.",
  empty: "The Timeline holds no event for this finding.",
  timeUnknown: "time unknown",
  replay: "Replay",
  truncated: "The read of the Timeline stopped before its end. Older events can be missing.",
  loadFailed: "The activity of the finding did not load.",
} as const;
