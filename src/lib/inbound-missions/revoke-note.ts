// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * RevokeAgentIdentity answers Unavailable when it blocked the access of the
 * identity and its cleanup did not finish. A retry finishes the cleanup. Envoy
 * and the transport use Unavailable too, with text that is not for a person.
 * So the page shows a note only for the cleanup message of the daemon, and the
 * note is this fixed text, never the text of the error.
 */

/** The stable part of the cleanup message of the daemon. */
const CLEANUP_MARK = "Retry the revoke to finish the cleanup";

/** The note that the page shows for a revoke with a cleanup that did not finish. */
export const REVOKE_CLEANUP_NOTE =
  "The identity is revoked and its access is blocked, but the cleanup of its permissions did not finish. Retry the revoke to finish the cleanup.";

/** The note for an error text of a revoke, or null when the text is not the cleanup message. */
export function revokeCleanupNote(errorText: string): string | null {
  return errorText.includes(CLEANUP_MARK) ? REVOKE_CLEANUP_NOTE : null;
}
