import 'server-only';

/**
 * Typed dashboard client methods for gibson.tenant.v1.SecretsService (broker config RPCs).
 *
 * Backs the dashboard's secrets-backend page. Get / Probe / Set semantics:
 *  - getBrokerConfig: returns redacted (non-sensitive) current config.
 *  - probeBrokerConfig: validates a candidate without persisting.
 *  - setBrokerConfig: runs probe then persists on success.
 *
 * SECURITY: CandidateConfig carries sensitive auth fields (Vault token, AWS
 * keys, GCP SA JSON, Azure client secret). These MUST NOT be logged, included
 * in error messages, or returned to the caller. The daemon's GetBrokerConfig
 * handler redacts all sensitive fields before building the RedactedConfig
 * response. The dashboard NEVER returns or logs a CandidateConfig.
 *
 * Spec: secrets-tenant-lifecycle Task 6, Requirements 3, 8.1.
 */

import { userClient } from '../gibson-client';
import { SecretsService } from '@/src/gen/gibson/tenant/v1/secrets_pb';
import type {
  RedactedConfig,
  CandidateConfig,
  ProbeResult,
  GetBrokerConfigResponse,
  ProbeBrokerConfigResponse,
  SetBrokerConfigResponse,
  BrokerProvider,
} from '@/src/gen/gibson/tenant/v1/secrets_pb';
import { throwMapped } from './secrets';

export type {
  RedactedConfig,
  CandidateConfig,
  ProbeResult,
  GetBrokerConfigResponse,
  ProbeBrokerConfigResponse,
  SetBrokerConfigResponse,
};
// BrokerProvider is an enum value; export it as a value (not type) so action
// files can use it in switch statements. See re-export at bottom of file.

/**
 * Returns the redacted current broker config for the tenant. Sensitive
 * fields are NEVER included in the response — only `sensitive_fields_set`
 * lists which fields have values stored on the server.
 */
export async function getBrokerConfig(): Promise<GetBrokerConfigResponse> {
  try {
    const client = userClient(SecretsService);
    return await client.getBrokerConfig({});
  } catch (err) {
    throwMapped(err);
  }
}

/**
 * Tests a candidate broker config without persisting. Returns a structured
 * ProbeResult indicating success or a specific failure class.
 *
 * SECURITY: the candidate argument carries sensitive fields. Do not log it
 * or include it in error messages.
 */
export async function probeBrokerConfig(
  candidate: CandidateConfig,
): Promise<ProbeBrokerConfigResponse> {
  try {
    const client = userClient(SecretsService);
    return await client.probeBrokerConfig({ candidate });
  } catch (err) {
    throwMapped(err);
  }
}

/**
 * Probes and (on success) persists the candidate broker config. Emits a
 * tenant_secrets_backend_configured audit event.
 *
 * Per Spec 1 R6.4, the probe is run server-side — the dashboard does not
 * need to call probeBrokerConfig first.
 *
 * SECURITY: the candidate argument carries sensitive fields. Do not log it
 * or include it in error messages.
 */
export async function setBrokerConfig(
  candidate: CandidateConfig,
): Promise<SetBrokerConfigResponse> {
  try {
    const client = userClient(SecretsService);
    return await client.setBrokerConfig({ candidate });
  } catch (err) {
    throwMapped(err);
  }
}

/**
 * Returns the number of secrets currently stored in the tenant's active
 * broker. The response carries no names, values, or per-row metadata —
 * only an integer count.
 *
 * Used by SecretsBackendContent to gate the migration-warning UX before
 * a tenant admin switches broker providers (Spec
 * tenant-secrets-broker-completion R3).
 *
 * Note: the proto field is int64 which @bufbuild deserialises as bigint.
 * The dashboard treats counts as plain numbers — practical secret counts
 * are well under 2^53. If a tenant ever crosses that, a follow-up spec
 * can switch the form to bigint-aware comparisons.
 */
export async function countSecrets(): Promise<number> {
  try {
    const client = userClient(SecretsService);
    const resp = await client.countSecrets({});
    return Number(resp.count);
  } catch (err) {
    throwMapped(err);
  }
}

// Re-export the BrokerProvider enum for convenience in action files.
export { BrokerProvider } from '@/src/gen/gibson/tenant/v1/secrets_pb';
