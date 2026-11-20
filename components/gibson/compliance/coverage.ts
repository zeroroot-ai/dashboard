// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The control coverage of one compliance pack in one time range. The summary
 * counts evidence states. It states no verdict and holds no score.
 */

import type { ControlEvidenceDTO } from "@/src/lib/gibson-client/compliance";

export interface ControlCoverage {
  /** The controls that have at least one evidence event. */
  withEvidence: number;
  /** The controls that have no evidence event, with or without an automated rule. */
  withoutEvidence: number;
  total: number;
  /** ISO time of the newest evidence event of any control. Null when there is none. */
  lastEvidenceTime: string | null;
}

export function summarizeCoverage(controls: readonly ControlEvidenceDTO[]): ControlCoverage {
  let withEvidence = 0;
  let last: string | null = null;
  for (const c of controls) {
    if (c.state !== "has_evidence") continue;
    withEvidence += 1;
    if (!c.lastEventTime) continue;
    if (last === null || new Date(c.lastEventTime).getTime() > new Date(last).getTime()) {
      last = c.lastEventTime;
    }
  }
  return {
    withEvidence,
    withoutEvidence: controls.length - withEvidence,
    total: controls.length,
    lastEvidenceTime: last,
  };
}
