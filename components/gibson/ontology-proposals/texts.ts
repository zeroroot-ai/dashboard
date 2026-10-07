// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The texts of the ontology proposal page (dashboard#191, gibson#618).
 *
 * Written in the style of the approved texts (D25, D55, D56, D65): short
 * sentences, active voice, no promise the code does not keep. The lane 11
 * detail file lists each one for the owner.
 */

import type { ProposalKind, ProposalStatus } from "@/src/lib/gibson-client/ontology-proposals";

export const ONTOLOGY_TEXT = {
  menu: "Ontology proposals",
  title: "Ontology proposals",
  intro:
    "Agents propose a node label or a relationship type when they find something that the ontology does not hold. A proposal changes nothing until the Owner approves it. An approved proposal joins the ontology when agents propose it often enough.",
  empty: "No agent has proposed an extension.",
  columnKind: "Kind",
  columnLabel: "Label",
  columnRecurrence: "Proposed",
  columnProposer: "Last proposed by",
  columnClaim: "Last claim",
  columnStatus: "Status",
  columnReviewer: "Reviewer",
  columnOntology: "Ontology",
  notInOntology: "Not in the ontology",
  approve: "Approve",
  reject: "Reject",
  rejectBody: "The label stays out of the ontology. The reason is stored with the proposal.",
  reasonLabel: "Reason",
  rejectConfirm: "Reject proposal",
  cancel: "Cancel",
  submit: "Submit upstream",
  filePath: "File path",
  prTitle: "Pull request title",
  prBody: "Pull request body",
  fileContent: "File content",
  copy: "Copy",
  copied: "Copied.",
  close: "Close",
} as const;

export const KIND_TEXT: Record<ProposalKind, string> = {
  node_label: "Node label",
  relationship_type: "Relationship type",
};

export const STATUS_TEXT: Record<ProposalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  unspecified: "Unknown",
};

/** '{n} times' */
export function recurrenceText(n: number): string {
  return n === 1 ? "1 time" : `${n} times`;
}

/** 'In the ontology since version {n}' */
export function promotedText(version: number): string {
  return `In the ontology since version ${version}`;
}

/** 'Reason: {reason}' */
export function rejectReasonText(reason: string): string {
  return `Reason: ${reason}`;
}

/** 'Reject "{label}"' */
export function rejectTitle(label: string): string {
  return `Reject "${label}"`;
}

/** '"{label}" approved.' */
export function approvedText(label: string): string {
  return `"${label}" approved.`;
}

/** '"{label}" rejected.' */
export function rejectedText(label: string): string {
  return `"${label}" rejected.`;
}

/** 'The decision did not complete. {reason}' */
export function decisionFailedText(reason: string): string {
  return `The decision did not complete. ${reason}`;
}

/** 'Contribution for "{label}"' */
export function contributionTitle(label: string): string {
  return `Contribution for "${label}"`;
}

/** The text above the contribution. */
export function contributionBody(auditRecordId: string): string {
  return `The contribution is in the audit log as record ${auditRecordId}. To add it to the SDK, open a pull request with the file below.`;
}

/** 'The submission did not complete. {reason}' */
export function submitFailedText(reason: string): string {
  return `The submission did not complete. ${reason}`;
}
