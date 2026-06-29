import 'server-only';

/**
 * Typed dashboard client methods for gibson.tenant.v1.SecretsService.
 *
 * Each method wraps one tenant RPC using the existing userClient() factory so
 * all calls flow dashboard → Envoy (JWT + SPIFFE mTLS) → daemon, never direct.
 *
 * SECURITY: The value field on setSecret / rotateSecret is passed through to
 * the RPC bytes field and is NEVER logged, included in error messages, or
 * stored in any observable channel.
 *
 * Spec: secrets-tenant-lifecycle Task 6, Requirements 8.1, 8.3.
 */

import { ConnectError } from '@connectrpc/connect';
import { userClient } from '../gibson-client';
import { SecretsService } from '@/src/gen/gibson/tenant/v1/secrets_pb';
import type {
  SecretMetadata,
  ListSecretsResponse,
  GetSecretResponse,
  SetSecretResponse,
  RotateSecretResponse,
  DeleteSecretResponse,
  GetMissionAuditResponse,
  MissionSecretAccess,
  SecretCategory,
} from '@/src/gen/gibson/tenant/v1/secrets_pb';

export type { SecretMetadata, SecretCategory, MissionSecretAccess };
export type {
};

/**
 * Structured error mapping from gRPC ConnectError to a dashboard-safe shape.
 * Sensitive content is never included in the error message.
 */
interface AdminRpcError {
  code: string;
  message: string;
}

function mapConnectError(err: unknown): AdminRpcError {
  if (err instanceof ConnectError) {
    return { code: err.code.toString(), message: err.message };
  }
  return {
    code: 'unknown',
    message: err instanceof Error ? err.message : 'An unexpected error occurred',
  };
}

export function throwMapped(err: unknown): never {
  const mapped = mapConnectError(err);
  const wrapped = new Error(mapped.message) as Error & { code: string };
  wrapped.code = mapped.code;
  throw wrapped;
}

// ---------------------------------------------------------------------------
// Read methods (tenant_member+)
// ---------------------------------------------------------------------------

interface ListSecretsOptions {
  categoryFilter?: SecretCategory;
  limit?: number;
  offset?: number;
  namePrefix?: string;
}

/**
 * Returns the metadata-only page of secrets for the tenant resolved from
 * the caller's session. Never returns plaintext values.
 */
export async function listSecrets(opts: ListSecretsOptions = {}): Promise<ListSecretsResponse> {
  try {
    const client = userClient(SecretsService);
    return await client.listSecrets({
      categoryFilter: opts.categoryFilter ?? 0,
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
      namePrefix: opts.namePrefix ?? '',
    });
  } catch (err) {
    throwMapped(err);
  }
}

/**
 * Returns metadata for one named secret. Response carries no value field.
 */
export async function getSecret(name: string): Promise<GetSecretResponse> {
  try {
    const client = userClient(SecretsService);
    return await client.getSecret({ name });
  } catch (err) {
    throwMapped(err);
  }
}

/**
 * Returns per-mission aggregated secret refs. Refs only, never values.
 */
export async function getMissionAudit(missionId: string): Promise<GetMissionAuditResponse> {
  try {
    const client = userClient(SecretsService);
    return await client.getMissionAudit({ missionId });
  } catch (err) {
    throwMapped(err);
  }
}

// ---------------------------------------------------------------------------
// Write methods (tenant_admin)
// ---------------------------------------------------------------------------

/**
 * Creates or overwrites the named secret.
 *
 * SECURITY: value is passed as bytes to the RPC over TLS. It MUST NOT be
 * logged, included in error messages, or stored in any client-side state.
 * The response carries no value field.
 */
export async function setSecret(
  name: string,
  category: SecretCategory,
  value: Uint8Array,
): Promise<SetSecretResponse> {
  try {
    const client = userClient(SecretsService);
    return await client.setSecret({ name, category, value });
  } catch (err) {
    throwMapped(err);
  }
}

/**
 * Creates a new version of the named secret with a new value.
 *
 * SECURITY: value handling rules are identical to setSecret.
 */
export async function rotateSecret(
  name: string,
  value: Uint8Array,
): Promise<RotateSecretResponse> {
  try {
    const client = userClient(SecretsService);
    return await client.rotateSecret({ name, value });
  } catch (err) {
    throwMapped(err);
  }
}

/**
 * Removes the named secret from the broker. Plugin FGA tuples are NOT
 * auto-revoked; use revokePluginSecretBinding for that.
 */
export async function deleteSecret(name: string): Promise<DeleteSecretResponse> {
  try {
    const client = userClient(SecretsService);
    return await client.deleteSecret({ name });
  } catch (err) {
    throwMapped(err);
  }
}
