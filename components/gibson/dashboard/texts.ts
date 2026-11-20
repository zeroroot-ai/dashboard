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

export const COST_TEXT = {
  title: "Model cost",
  budgetSpent: (spent: string, limit: string | null) =>
    limit === null ? `${spent} spent, no limit set` : `${spent} of ${limit} spent`,
  resets: (date: string) => `Period resets: ${date}`,
  warning: "The warning threshold of the budget is crossed.",
  limitReached: "The spend reached the limit of the budget.",
  noBudget: "No budget is set for this organization.",
  budgetFailed: "The budget did not load.",
  perFix: "Median cost for each verified fix",
  unknown: "unknown",
  perFixNotAvailable:
    "The cost for each verified fix is not available yet. It needs the status of each finding from the backend.",
  perFixUnknownCount: (n: number) =>
    n === 1 ? "1 verified fix has an unknown cost." : `${n} verified fixes have an unknown cost.`,
  open: "Open Budgets",
} as const;

export const EVIDENCE_EXPORT_TEXT = {
  title: "Evidence export",
  intro: "Export the audit events that are evidence for the controls of NIST 800-53, for a time range.",
  framework: "Framework",
  start: "Start",
  end: "End",
  exportCsv: "Export CSV",
  exportJson: "Export JSON",
  exporting: "Exporting",
  failed: "The evidence export failed.",
  notAllowed: "Only an Owner or an Admin can export evidence.",
  notYet:
    "The export does not hold the verified findings with their proof and their D3FEND countermeasures yet. The backend does not map them yet.",
  open: "Open the Compliance page",
} as const;

export const FINDINGS_PANEL_TEXT = {
  title: "Findings that are not verified",
  note: "The list shows the rank order of the API: the priority first, then the belief of the target.",
  empty: "No findings yet.",
  loadFailed: "The findings did not load.",
  confidence: "Confidence",
  attackPath: "Attack path",
  all: "Open all findings",
  more: (shown: number) => `Showing the first ${shown} findings.`,
  unknown: "unknown",
  noPriority: "no priority",
  place: "Place",
  rule: "Rule",
  mergeRequest: "Merge request",
} as const;

export const EXPOSURE_TEXT = {
  title: "Exposure window and revert rate",
  period: "The last 7 days, next to the 7 days before.",
  windowTitle: "Median exposure window",
  revertTitle: "Revert rate",
  noVerified: "No finding was verified in this period. The median has no value.",
  noMerged: "No fix was merged in this period. The rate has no value.",
  agentTime: "Agent time",
  waitTime: "Wait time",
  up: "up",
  down: "down",
  same: "unchanged",
  trend: (direction: string, change: string, previous: string) =>
    direction === "unchanged"
      ? `Unchanged from ${previous} in the period before.`
      : `${direction} ${change} from ${previous} in the period before.`,
  noPrevious: "The period before has no data to compare.",
  verifiedCount: (n: number) => (n === 1 ? "1 finding verified." : `${n} findings verified.`),
  revertCounts: (reverted: number, merged: number) => `${reverted} of ${merged} merged fixes reverted.`,
  revertTrend: (direction: string, points: number, previous: string) =>
    direction === "unchanged"
      ? `Unchanged from ${previous} in the period before.`
      : `${direction} ${points} points from ${previous} in the period before.`,
  loadFailed: "The exposure window did not load.",
} as const;

export const UNAVAILABLE_PANELS = {
  actions: {
    title: "What the agents did and who allowed it",
    text: "This data is not available yet. It needs the actions of the agents by grant and by grantor (gibson#1499).",
  },
} as const;

export const DASHBOARD_TEXT = {
  title: "Console",
} as const;
