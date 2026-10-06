// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The approved texts of the compliance evidence page (D56, dashboard#224).
 *
 * The owner approved them on 2026-10-05. Do not change a word: a test
 * compares each one byte for byte with the text of the decision. The page
 * shows evidence only. No text here, or anywhere on the page, states a
 * verdict.
 */

export const COMPLIANCE_TEXT = {
  title: "Compliance evidence",
  intro:
    "This page shows events from your audit log that are evidence for a control. It does not state that you meet a control. An assessor makes that decision.",
  noRule: "No automated evidence",
  noEvents: "No events in this period",
  noPack:
    "No compliance pack is enabled for this organization. An Owner or an Admin can enable one in Settings.",
  exportCsv: "Export CSV",
  exportJson: "Export JSON",
} as const;

/** "{n} of {m} controls have an automated rule." */
export function coverageText(n: number, m: number): string {
  return `${n} of ${m} controls have an automated rule.`;
}

/** The menu entry. */
export const COMPLIANCE_MENU_TITLE = "Compliance";

/** The default time range, in days (D56). */
export const DEFAULT_RANGE_DAYS = 90;
