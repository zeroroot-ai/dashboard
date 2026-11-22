// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The status and the priority of a finding. The daemon stores both with the
 * finding (gibson#1498, gibson#1505). The dashboard reads them and sets no
 * default. A value that the daemon does not send stays unknown.
 */

export const FINDING_STATUSES = ["open", "fixing", "fixed", "verified"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const FINDING_PRIORITIES = ["P1", "P2", "P3", "P4"] as const;
export type FindingPriority = (typeof FINDING_PRIORITIES)[number];

/** Narrow a string from the daemon to a status. Anything else is undefined. */
export function parseFindingStatus(value: string | undefined): FindingStatus | undefined {
  return FINDING_STATUSES.find((s) => s === value);
}

/** Narrow a string from the daemon to a priority. Anything else is undefined. */
export function parseFindingPriority(value: string | undefined): FindingPriority | undefined {
  return FINDING_PRIORITIES.find((p) => p === value);
}

/** The place that a finding touches: an Application or a Host. */
export interface FindingPlace {
  label: string;
  key: string;
}
