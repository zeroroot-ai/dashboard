// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The confidence of a finding is a number from 0 to 1. A finding with no
 * confidence has an unknown confidence. Unknown is not zero.
 */

/** True when the value is a usable confidence. */
export function isKnownConfidence(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** The text of a confidence: a whole percent, or the word for an unknown value. */
export function formatConfidence(value: number | undefined, unknownText: string): string {
  return isKnownConfidence(value) ? `${Math.round(value * 100)}%` : unknownText;
}

/**
 * Compare two confidences in ascending order. An unknown confidence sorts
 * after every known one. The caller does not flip the unknown values when it
 * reverses the order.
 */
export function compareConfidence(
  a: number | undefined,
  b: number | undefined,
  direction: "asc" | "desc",
): number {
  const aKnown = isKnownConfidence(a);
  const bKnown = isKnownConfidence(b);
  if (!aKnown && !bKnown) return 0;
  if (!aKnown) return 1;
  if (!bKnown) return -1;
  return direction === "asc" ? a - b : b - a;
}
