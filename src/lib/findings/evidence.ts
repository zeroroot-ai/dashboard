// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Labels and rules for the evidence of a finding (gibson#1365).
 *
 * The content of an evidence item is data of the target and is untrusted. The
 * page shows it as plain text and never as HTML or Markdown.
 */
import type {
  EvidenceKindDTO,
  EvidenceTierDTO,
} from "@/src/lib/gibson-client/finding-types";

const KIND_LABELS: Record<EvidenceKindDTO, string> = {
  request: "Request",
  response: "Response",
  screenshot: "Screenshot",
  code: "Code",
  log: "Log",
  other: "Other",
  payload: "Payload",
  conversation: "Conversation",
  network_trace: "Network trace",
  unspecified: "Evidence",
};

/** The label of the type of an evidence item. */
export function evidenceKindLabel(kind: EvidenceKindDTO): string {
  return KIND_LABELS[kind];
}

/**
 * The label of the tier. Recorded: the daemon copied the result of a tool call
 * from its own record. Typed: the agent typed the content.
 */
export function evidenceTierLabel(tier: EvidenceTierDTO): string {
  switch (tier) {
    case "recorded":
      return "Recorded by Gibson";
    case "typed":
      return "Typed by the agent";
    default:
      return "Source not stated";
  }
}

/** A content over these limits starts collapsed behind an expand control. */
export const COLLAPSE_LINES = 20;
export const COLLAPSE_CHARS = 2000;

/** True when the page collapses the content at first. */
export function isLongEvidence(content: string): boolean {
  return content.length > COLLAPSE_CHARS || content.split("\n").length > COLLAPSE_LINES;
}

/**
 * The part that shows while the item is collapsed: the first lines, cut at the
 * character limit. The full content is never lost, the expand control shows it.
 */
export function collapsedEvidence(content: string): string {
  const head = content.split("\n").slice(0, COLLAPSE_LINES).join("\n");
  return head.length > COLLAPSE_CHARS ? head.slice(0, COLLAPSE_CHARS) : head;
}
