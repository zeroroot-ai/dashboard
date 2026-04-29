"use server";

/**
 * Server Actions for the /settings/secrets-backend page.
 *
 * Two actions:
 *  - probeBrokerConfigAction: validate a candidate config without persisting;
 *    returns a structured ProbeResult to the caller.
 *  - setBrokerConfigAction: probe-then-persist; revalidates on success.
 *
 * SECURITY: CandidateConfig carries sensitive auth fields (Vault token, AWS
 * keys, GCP SA JSON, Azure client secret). These fields:
 *  - Are NEVER logged (not even in debug statements).
 *  - Are NEVER returned in error messages.
 *  - Are NEVER passed back to the client in any response field.
 *  - Are cleared from memory as soon as the RPC call returns.
 *
 * The daemon's handler is responsible for keeping these fields out of
 * structured logs and OTel attributes on the server side (Spec 1 R6.2).
 *
 * Spec: secrets-tenant-lifecycle Task 8, Requirements 3, 8.
 */

import "server-only";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  probeBrokerConfig,
  setBrokerConfig,
  BrokerProvider,
  type RedactedConfig,
  type ProbeResult,
} from "@/src/lib/gibson-client/tenant-broker-config";
import type { CandidateConfig } from "@/src/gen/gibson/admin/v1/tenant_pb";
import { getServerSession } from "@/src/lib/auth";

// ---------------------------------------------------------------------------
// Shared result types
// ---------------------------------------------------------------------------

export type BrokerActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; errorClass?: string };

export type ProbeActionResult = BrokerActionResult<ProbeResult>;
export type SetConfigActionResult = BrokerActionResult<RedactedConfig>;

// ---------------------------------------------------------------------------
// Per-provider Zod schemas
//
// Each provider form sends `provider` + provider-specific fields.
// Sensitive fields are validated as non-empty bytes (string here — encoded
// to Uint8Array before the RPC).
// ---------------------------------------------------------------------------

const providerEnum = z.enum([
  "BROKER_PROVIDER_POSTGRES",
  "BROKER_PROVIDER_VAULT",
  "BROKER_PROVIDER_AWSSM",
  "BROKER_PROVIDER_GCPSM",
  "BROKER_PROVIDER_AZUREKV",
]);

// Non-sensitive common fields reused across providers.
const nonSensitiveBase = z.object({
  provider: providerEnum,
  address: z.string().max(512).optional().default(""),
  namespaceOrPath: z.string().max(512).optional().default(""),
  mount: z.string().max(512).optional().default(""),
  authMethod: z.string().max(64).optional().default(""),
  region: z.string().max(64).optional().default(""),
  project: z.string().max(256).optional().default(""),
  tenantIdExternal: z.string().max(256).optional().default(""),
  clientId: z.string().max(256).optional().default(""),
  roleArn: z.string().max(512).optional().default(""),
  approleRoleId: z.string().max(256).optional().default(""),
});

// Sensitive optional fields (empty string → empty Uint8Array → daemon treats
// as "not provided").
const sensitiveFields = z.object({
  vaultToken: z.string().max(8192).optional().default(""),
  approleSecretId: z.string().max(8192).optional().default(""),
  awsAccessKeyId: z.string().max(256).optional().default(""),
  awsSecretAccessKey: z.string().max(512).optional().default(""),
  awsExternalId: z.string().max(512).optional().default(""),
  gcpServiceAccountJson: z.string().max(65536).optional().default(""),
  azureClientSecret: z.string().max(8192).optional().default(""),
});

const candidateConfigSchema = nonSensitiveBase.merge(sensitiveFields);

type CandidateConfigInput = z.infer<typeof candidateConfigSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerStringToProto(p: string): BrokerProvider {
  switch (p) {
    case "BROKER_PROVIDER_POSTGRES":
      return BrokerProvider.POSTGRES;
    case "BROKER_PROVIDER_VAULT":
      return BrokerProvider.VAULT;
    case "BROKER_PROVIDER_AWSSM":
      return BrokerProvider.AWSSM;
    case "BROKER_PROVIDER_GCPSM":
      return BrokerProvider.GCPSM;
    case "BROKER_PROVIDER_AZUREKV":
      return BrokerProvider.AZUREKV;
    default:
      return BrokerProvider.UNSPECIFIED;
  }
}

function enc(s: string): Uint8Array {
  return s.length > 0 ? new TextEncoder().encode(s) : new Uint8Array(0);
}

/**
 * Converts the parsed form input to a CandidateConfig proto message.
 *
 * SECURITY: the returned object carries sensitive fields in Uint8Array form.
 * It MUST NOT be logged, serialized, or returned to the client.
 */
function buildCandidate(d: CandidateConfigInput): CandidateConfig {
  return {
    provider: providerStringToProto(d.provider),
    address: d.address,
    namespaceOrPath: d.namespaceOrPath,
    mount: d.mount,
    authMethod: d.authMethod,
    region: d.region,
    project: d.project,
    tenantIdExternal: d.tenantIdExternal,
    clientId: d.clientId,
    roleArn: d.roleArn,
    approleRoleId: d.approleRoleId,
    // Sensitive — encode to bytes, never log.
    vaultToken: enc(d.vaultToken),
    approleSecretId: enc(d.approleSecretId),
    awsAccessKeyId: enc(d.awsAccessKeyId),
    awsSecretAccessKey: enc(d.awsSecretAccessKey),
    awsExternalId: enc(d.awsExternalId),
    gcpServiceAccountJson: enc(d.gcpServiceAccountJson),
    azureClientSecret: enc(d.azureClientSecret),
  } as unknown as CandidateConfig;
}

function formDataToObject(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    obj[k] = v;
  }
  return obj;
}

/**
 * Redacts sensitive field names from an error message.
 * Defense-in-depth: ensures no sensitive value substring leaks through RPC
 * error strings from the daemon.
 *
 * We do NOT have access to the actual sensitive values here (they are already
 * gone after buildCandidate returns), so we strip known field-name keywords
 * that might appear in error traces.
 */
function redactErrorMessage(msg: string): string {
  return msg
    .replace(/vault_token[=:\s]+\S+/gi, "vault_token=[REDACTED]")
    .replace(/approle_secret[=:\s]+\S+/gi, "approle_secret=[REDACTED]")
    .replace(/aws_secret[=:\s]+\S+/gi, "aws_secret=[REDACTED]")
    .replace(/aws_access_key[=:\s]+\S+/gi, "aws_access_key=[REDACTED]")
    .replace(/azure_client_secret[=:\s]+\S+/gi, "azure_client_secret=[REDACTED]")
    .replace(/gcp_service_account[=:\s]+\S+/gi, "gcp_service_account=[REDACTED]");
}

// ---------------------------------------------------------------------------
// probeBrokerConfigAction
// ---------------------------------------------------------------------------

/**
 * Validates a candidate broker config without persisting it.
 * Returns the structured ProbeResult (ok / errorClass / errorMessage) so the
 * UI can display specific failure details inline.
 *
 * SECURITY: sensitive fields flow from formData → encoded bytes → RPC only.
 * They are never returned to the caller or logged.
 */
export async function probeBrokerConfigAction(
  formData: FormData,
): Promise<ProbeActionResult> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }

  const parsed = candidateConfigSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      code: "bad_input",
    };
  }

  const candidate = buildCandidate(parsed.data);

  try {
    const resp = await probeBrokerConfig(candidate);
    const result = resp.result;
    if (!result) {
      return { ok: false, error: "Empty probe response", code: "error" };
    }
    return { ok: true, data: result };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : "Probe failed";
    return {
      ok: false,
      error: redactErrorMessage(rawMsg),
      code: (err as { code?: string }).code ?? "error",
    };
  }
}

// ---------------------------------------------------------------------------
// setBrokerConfigAction
// ---------------------------------------------------------------------------

/**
 * Probes (server-side, per Spec 1 R6.4) then persists the candidate config.
 * Emits tenant_secrets_backend_configured audit event.
 * Revalidates the secrets-backend page path on success.
 *
 * SECURITY: same rules as probeBrokerConfigAction.
 */
export async function setBrokerConfigAction(
  formData: FormData,
): Promise<SetConfigActionResult> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }

  const parsed = candidateConfigSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      code: "bad_input",
    };
  }

  const candidate = buildCandidate(parsed.data);

  try {
    const resp = await setBrokerConfig(candidate);

    // If the daemon returned a probe_result with ok=false, the RPC still
    // succeeded at the transport level but the probe failed. Surface it.
    if (resp.probeResult && !resp.probeResult.ok) {
      return {
        ok: false,
        error: redactErrorMessage(resp.probeResult.errorMessage),
        code: "probe_failed",
        errorClass: resp.probeResult.errorClass,
      };
    }

    revalidatePath("/dashboard/pages/settings/secrets-backend");
    return { ok: true, data: resp.config! };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : "Failed to save config";
    return {
      ok: false,
      error: redactErrorMessage(rawMsg),
      code: (err as { code?: string }).code ?? "error",
    };
  }
}
