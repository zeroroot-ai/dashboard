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
