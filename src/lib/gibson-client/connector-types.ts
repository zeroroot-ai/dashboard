/**
 * Connector data-transfer objects (ADR-0014).
 *
 * Plain JSON shapes the connectors API returns to the browser: the daemon proto
 * messages never cross the API boundary. The typed server client
 * (./connectors.ts, server-only) produces them; the connectors settings panel
 * (components/gibson/settings/ConnectorsContent.tsx, a client component) renders
 * them. Both sides import these types so the wire contract has one definition.
 * This module is transport-free on purpose, so a client component may import it.
 */

/** CatalogEntryDTO is one curated connector the tenant may enable. */
export interface CatalogEntryDTO {
  id: string;
  displayName: string;
  description: string;
  /** "Hosted" (a container we run) or "Remote" (the vendor runs the server). */
  shape: string;
  /** "none", "secret", or "oauth". */
  auth: string;
}

/** ConnectorDTO is one connector the tenant has enabled, with its live status. */
export interface ConnectorDTO {
  id: string;
  shape: string;
  runtime: string;
  /** Pending, Provisioning, AuthorizationRequired, Ready, RefreshFailing, Failed. */
  phase: string;
  discoveredTools: number;
  lastError: string;
}

/** ConnectorAuthStateDTO is the coarse authorization state a page renders. */
export type ConnectorAuthStateDTO =
  | 'unspecified'
  | 'unauthorized'
  | 'authorized'
  | 'refresh_failing';

/** ConnectorAuthDTO is the OAuth grant status for one connector. */
export interface ConnectorAuthDTO {
  state: ConnectorAuthStateDTO;
  authorizedBy: string;
  scope: string;
  accessTokenExpiresAt: string | null;
  lastRefreshError: string;
  lastRefreshAt: string | null;
}
