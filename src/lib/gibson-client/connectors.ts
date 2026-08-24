import 'server-only';
/**
 * Typed dashboard client for gibson.tenant.v1.ConnectorService and
 * ConnectorAuthService (ADR-0014).
 *
 * ConnectorService is the connector catalog and lifecycle: a person enables a
 * curated connector, lists what is enabled, and disables it. ConnectorAuthService
 * is the OAuth grant behind a connector: it reports the grant state, starts the
 * authorization, and revokes the grant. The daemon does all the work; this file
 * is a thin, typed delegation surface for the API routes.
 */
import { userClient } from '../gibson-client';
import { ConnectorService } from '@/src/gen/gibson/tenant/v1/connector_pb';
import type { CatalogEntry, Connector } from '@/src/gen/gibson/tenant/v1/connector_pb';
import {
  ConnectorAuthService,
  ConnectorAuthState,
} from '@/src/gen/gibson/tenant/v1/connector_auth_pb';
import type { GetConnectorAuthStatusResponse } from '@/src/gen/gibson/tenant/v1/connector_auth_pb';
import { throwMapped } from './secrets';

import type {
  CatalogEntryDTO,
  ConnectorDTO,
  ConnectorAuthStateDTO,
  ConnectorAuthDTO,
} from './connector-types';

function toCatalogDTO(e: CatalogEntry): CatalogEntryDTO {
  return {
    id: e.id,
    displayName: e.displayName,
    description: e.description,
    shape: e.shape,
    auth: e.auth,
    defaultInstanceUrl: e.defaultInstanceUrl,
  };
}

function toConnectorDTO(c: Connector): ConnectorDTO {
  return {
    id: c.id,
    shape: c.shape,
    runtime: c.runtime,
    phase: c.phase,
    discoveredTools: c.discoveredTools,
    lastError: c.lastError,
  };
}

function toAuthStateDTO(s: ConnectorAuthState): ConnectorAuthStateDTO {
  switch (s) {
    case ConnectorAuthState.AUTHORIZED:
      return 'authorized';
    case ConnectorAuthState.UNAUTHORIZED:
      return 'unauthorized';
    case ConnectorAuthState.REFRESH_FAILING:
      return 'refresh_failing';
    default:
      return 'unspecified';
  }
}

function isoOrNull(ts: GetConnectorAuthStatusResponse['accessTokenExpiresAt']): string | null {
  if (!ts) return null;
  // protobuf Timestamp carries seconds (bigint) and nanos.
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6);
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// ConnectorService: catalog and lifecycle (tenant_member+).
// ---------------------------------------------------------------------------

/** List the curated connectors the tenant may enable. */
export async function daemonListCatalog(): Promise<CatalogEntryDTO[]> {
  try {
    const client = userClient(ConnectorService);
    const resp = await client.listCatalog({});
    return (resp.entries ?? []).map(toCatalogDTO);
  } catch (err) {
    throwMapped(err);
  }
}

/** Enable a catalog connector. The daemon creates the ConnectorInstance. */
export async function daemonEnableConnector(catalogId: string): Promise<void> {
  try {
    const client = userClient(ConnectorService);
    await client.enableConnector({ catalogId });
  } catch (err) {
    throwMapped(err);
  }
}

/** List the tenant's enabled connectors with their live status. */
export async function daemonListConnectors(): Promise<ConnectorDTO[]> {
  try {
    const client = userClient(ConnectorService);
    const resp = await client.listConnectors({});
    return (resp.connectors ?? []).map(toConnectorDTO);
  } catch (err) {
    throwMapped(err);
  }
}

/** Disable a connector. The daemon deletes the ConnectorInstance. */
export async function daemonDisableConnector(connector: string): Promise<void> {
  try {
    const client = userClient(ConnectorService);
    await client.disableConnector({ connector });
  } catch (err) {
    throwMapped(err);
  }
}

// ---------------------------------------------------------------------------
// ConnectorAuthService: the OAuth grant (tenant_admin for start/revoke).
// ---------------------------------------------------------------------------

/** Read the OAuth grant status for one connector. */
export async function daemonGetConnectorAuthStatus(connector: string): Promise<ConnectorAuthDTO> {
  try {
    const client = userClient(ConnectorAuthService);
    const resp = await client.getConnectorAuthStatus({ connector });
    return {
      state: toAuthStateDTO(resp.state),
      authorizedBy: resp.authorizedBy,
      scope: resp.scope,
      accessTokenExpiresAt: isoOrNull(resp.accessTokenExpiresAt),
      lastRefreshError: resp.lastRefreshError,
      lastRefreshAt: isoOrNull(resp.lastRefreshAt),
    };
  } catch (err) {
    throwMapped(err);
  }
}

/** Revoke a connector's OAuth grant. */
export async function daemonRevokeConnectorGrant(connector: string): Promise<void> {
  try {
    const client = userClient(ConnectorAuthService);
    await client.revokeConnectorGrant({ connector });
  } catch (err) {
    throwMapped(err);
  }
}

/**
 * Start the OAuth authorization for a connector. Returns the vendor authorize
 * URL the human opens in a browser to consent once. The daemon holds the PKCE
 * verifier and state and completes the grant at its callback.
 */
export async function daemonStartConnectorAuthorization(
  connector: string,
  instanceUrl: string,
): Promise<string> {
  try {
    const client = userClient(ConnectorAuthService);
    const resp = await client.startConnectorAuthorization({ connector, instanceUrl });
    return resp.authorizeUrl;
  } catch (err) {
    throwMapped(err);
  }
}
