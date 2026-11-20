// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The texts of the first screen. Each panel and tile reads its text here.
 * The texts state facts about data. They state no verdict.
 */

export const CONTROL_COVERAGE_TEXT = {
  title: "Control evidence",
  withEvidence: (n: number) => `${n} ${n === 1 ? "control has" : "controls have"} evidence`,
  withoutEvidence: (n: number) => `${n} ${n === 1 ? "control has" : "controls have"} no evidence`,
  lastEvidence: (date: string) => `Last evidence: ${date}`,
  noEvidence: "No evidence in this period",
  period: (days: number) => `Last ${days} days`,
  open: "Open the Compliance page",
  loadFailed: "The control evidence did not load.",
} as const;

export const WAITS_TEXT = {
  title: "What waits on a person?",
  count: (n: number) => (n === 1 ? "1 item waits" : `${n} items wait`),
  oldest: (age: string) => `Oldest: ${age}`,
  oldestUnknown: "Oldest: unknown",
  empty: "Nothing waits on a person.",
  waitLabel: "Waiting",
  waitUnknown: "unknown",
  blastRadius: "Blast radius",
  blastRadiusUnknown: "not stated",
  reversible: "Reversible",
  irreversible: "Irreversible",
  reversibilityUnknown: "Reversibility not classified",
  open: "Decide",
  kinds: {
    "destructive-action": "Destructive action",
    "merge-refused": "Merge refused",
    "awaiting-scan": "Waits on a scan",
    "no-health-signal": "No health signal",
  },
  missingKinds:
    "This panel does not show a finding that waits on a refused merge, on a scan, or on a health signal. The API for these items is not available yet.",
  loadFailed: "The items that wait on a person did not load.",
} as const;
