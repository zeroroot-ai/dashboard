import 'server-only';

/**
 * Typed dashboard client methods for gibson.admin.v1.TenantAdminService.
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
import { TenantAdminService } from '@/src/gen/gibson/admin/v1/tenant_pb';
import type {
  RedactedConfig,
  CandidateConfig,
  ProbeResult,
  GetBrokerConfigResponse,
  ProbeBrokerConfigResponse,
  SetBrokerConfigResponse,
  BrokerProvider,
} from '@/src/gen/gibson/admin/v1/tenant_pb';
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
    const client = userClient(TenantAdminService);
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
    const client = userClient(TenantAdminService);
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
    const client = userClient(TenantAdminService);
    return await client.setBrokerConfig({ candidate });
  } catch (err) {
    throwMapped(err);
  }
}

// Re-export the BrokerProvider enum for convenience in action files.
export { BrokerProvider } from '@/src/gen/gibson/admin/v1/tenant_pb';
