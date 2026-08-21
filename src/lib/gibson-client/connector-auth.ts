import 'server-only';

/**
 * Typed dashboard client methods for gibson.tenant.v1.ConnectorAuthService
 * (ADR-0064, gibson#1506).
 *
 * The refresh token crosses this surface exactly once, inbound, on
 * completeConnectorAuthorization; no response ever carries credential
 * material, so everything returned here is safe to hand to the UI.
 */

import { userClient } from '../gibson-client';
import { ConnectorAuthService } from '@/src/gen/gibson/tenant/v1/connector_auth_pb';
import type {
  GetConnectorAuthStatusResponse,
  CompleteConnectorAuthorizationResponse,
  RevokeConnectorGrantResponse,
} from '@/src/gen/gibson/tenant/v1/connector_auth_pb';
import { throwMapped } from './secrets';

/** Reports a connector's grant and published-token state. */
export async function getConnectorAuthStatus(
  connector: string,
): Promise<GetConnectorAuthStatusResponse> {
  try {
    const client = userClient(ConnectorAuthService);
    return await client.getConnectorAuthStatus({ connector });
  } catch (err) {
    throwMapped(err);
  }
}

/**
 * Delivers a finished browser authorization to the platform. The daemon
 * stores the grant, records the calling human as authorized_by, and proves
 * the grant by minting the first access token before answering.
 */
export async function completeConnectorAuthorization(args: {
  connector: string;
  refreshToken: string;
  tokenEndpoint: string;
  clientId: string;
  scope: string;
  revocationEndpoint?: string;
}): Promise<CompleteConnectorAuthorizationResponse> {
  try {
    const client = userClient(ConnectorAuthService);
    return await client.completeConnectorAuthorization({
      connector: args.connector,
      refreshToken: args.refreshToken,
      tokenEndpoint: args.tokenEndpoint,
      clientId: args.clientId,
      clientSecret: '',
      scope: args.scope,
      revocationEndpoint: args.revocationEndpoint ?? '',
    });
  } catch (err) {
    throwMapped(err);
  }
}

/**
 * Revokes the connector's grant: best-effort at the vendor, then deletion of
 * the grant and the published access token. Takes effect for every agent
 * using the connector.
 */
export async function revokeConnectorGrant(
  connector: string,
): Promise<RevokeConnectorGrantResponse> {
  try {
    const client = userClient(ConnectorAuthService);
    return await client.revokeConnectorGrant({ connector });
  } catch (err) {
    throwMapped(err);
  }
}
