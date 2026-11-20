// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/** The texts of the incident report page. */
export const INCIDENT_TEXT = {
  title: "Incident report",
  back: "Graph",
  loadFailed: "The incident report did not load.",
  alerts: "Alerts",
  reached: "What the incident reaches",
  actions: "Response actions",
  causes: "Cause",
  fixes: "Fix and proof",
  controls: "Controls with evidence",
  controlsNote: "These controls of NIST 800-53 have evidence in the actions. This is evidence and not a verdict.",
  none: "None.",
  replay: "Replay",
  noFrame: "no Timeline event",
  timelineTotal: (n: number) => `The Timeline held ${n} events when the report was read.`,
  grant: "Grant",
  grantedBy: "Granted by",
  noGrant: "no grant recorded",
  agent: "Agent",
  outcomes: {
    done: "Done",
    refused: "Refused",
    "pending-authorization": "Waits for approval",
    failed: "Failed",
    unknown: "Unknown",
  },
  raised: "Raised",
  statusNow: "Status now",
  mergeRequest: "Merge request",
  verifiedBy: "Verified by",
  verified: "Verified",
  notVerified: "Not verified",
} as const;
