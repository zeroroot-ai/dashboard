// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The texts of the registration queue (dashboard#193, gibson#620).
 *
 * Written in the style of the approved texts (D25, D55, D56, D65): short
 * sentences, active voice, no promise the code does not keep. The lane 11
 * detail file lists each one for the owner.
 */

export const REGISTRATIONS_TEXT = {
  menu: "Registrations",
  title: "Pending registrations",
  intro:
    "These people registered and wait for a decision. An approval activates the account and creates the workspace. A rejection keeps the account inactive.",
  empty: "No registration waits for a decision.",
  columnEmail: "Email",
  columnName: "Name",
  columnWorkspace: "Workspace",
  columnPlan: "Plan",
  approve: "Approve",
  reject: "Reject",
  rejectBody:
    "The account stays inactive and no workspace is created. The reason goes to the audit log only. The person does not see it.",
  reasonLabel: "Reason",
  rejectConfirm: "Reject registration",
  cancel: "Cancel",
  rejected: "Registration rejected.",
  alreadyDecided: "Another administrator already decided this registration.",
} as const;

/** 'Reject the registration of {email}' */
export function rejectTitle(email: string): string {
  return `Reject the registration of ${email}`;
}

/** 'Registration approved. The workspace "{tenant}" is in the creation queue.' */
export function approvedText(tenantId: string): string {
  return `Registration approved. The workspace "${tenantId}" is in the creation queue.`;
}

/** 'The approval did not complete. {reason}' */
export function approveFailedText(reason: string): string {
  return `The approval did not complete. ${reason}`;
}

/** 'The rejection did not complete. {reason}' */
export function rejectFailedText(reason: string): string {
  return `The rejection did not complete. ${reason}`;
}
