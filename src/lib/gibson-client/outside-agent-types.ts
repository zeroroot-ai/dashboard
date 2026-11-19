// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Outside agent data-transfer objects (gibson#1403). An outside agent is an
 * A2A agent that runs outside Gibson. Plain JSON shapes for the browser, with
 * no transport.
 */

/** One outside agent of the tenant. The record holds secret names, never values. */
export interface OutsideAgentDTO {
  name: string;
  /** The HTTPS URL of the A2A endpoint. */
  a2aUrl: string;
  /** The name of the tenant secret with the credential. Empty means none. */
  credentialSecret: string;
  /** The name of the tenant secret with the PEM CA bundle. Empty means public roots. */
  caBundleSecret: string;
  description: string;
  /** ISO 8601 time, or an empty string. */
  createdAt: string;
}
