// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The texts of the retention card (gibson#676, gibson#992). An agent wrote
 * them in the style of the approved compliance texts (D65). The owner
 * reviews them in the final session (release/final-session.md step 7).
 */

export const RETENTION_TEXT = {
  title: "Retention",
  intro:
    "Postgres keeps your audit log and the Timeline history of your missions for the retention period. After the period, only your durable bucket keeps them. Your organization can set a longer period than the period of this installation, never a shorter one.",
  inputLabel: "Retention period in months",
  save: "Set period",
  reset: "Use the installation period",
  saved: "The retention period is set.",
  failed: "The retention period did not change.",
  loading: "Loading the retention period...",
} as const;

/** "Postgres keeps them for {e} months. ..." */
export function retentionSummary(effective: number, install: number, tenant: number): string {
  const set =
    tenant > 0
      ? `Your organization set ${tenant} months.`
      : "Your organization did not set a period.";
  return `Postgres keeps them for ${effective} months. The period of this installation is ${install} months. ${set}`;
}
