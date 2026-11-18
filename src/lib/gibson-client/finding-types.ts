// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Finding data-transfer objects (gibson#1365). Plain JSON shapes that the
 * finding actions return to the browser. This module has no transport, so a
 * client component may import it.
 */

/** What an evidence item is. The key of the EvidenceType enum, in lower case. */
export type EvidenceKindDTO =
  | "request"
  | "response"
  | "screenshot"
  | "code"
  | "log"
  | "other"
  | "payload"
  | "conversation"
  | "network_trace"
  | "unspecified";

/**
 * Who made the content. "recorded": the daemon copied it from a tool call that
 * it recorded. "typed": the agent typed it. "unknown": the daemon sent no tier.
 */
export type EvidenceTierDTO = "recorded" | "typed" | "unknown";

/** One evidence item. Every text field is untrusted data of the target. */
export interface EvidenceDTO {
  title: string;
  kind: EvidenceKindDTO;
  tier: EvidenceTierDTO;
  /** The id of the recorded tool call. Empty for a typed item. */
  toolCallId: string;
  /** The whole content. The server does not cut it. */
  content: string;
  metadata: Record<string, string>;
}

/** One finding with all its evidence, in the stored order. */
export interface FindingDetailDTO {
  id: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  confidence: number;
  missionId: string;
  agentName: string;
  submittedBy: string;
  /** ISO 8601 time, or an empty string. */
  createdAt: string;
  evidence: EvidenceDTO[];
}

/** The file of a finding export. */
export interface FindingsExportDTO {
  filename: string;
  format: string;
  count: number;
  /** The file content as text. */
  text: string;
}
