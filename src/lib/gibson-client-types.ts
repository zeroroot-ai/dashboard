/**
 * Type-only definitions extracted from gibson-client.ts so client components
 * (React hooks, dashboard components) can type-import them WITHOUT pulling
 * gibson-client.ts's runtime dependencies into the browser bundle.
 *
 * Why: gibson-client.ts is `'server-only'` and transitively imports
 * @grpc/grpc-js (via the SPIFFE workload-API client). Next.js 16 / Turbopack
 * traces type-only imports through the module graph at build time, so a
 * `'use client'` file that does `import type { Foo } from './gibson-client'`
 * still forces grpc-js (with its node:fs / node:dns / node:cluster requires)
 * into the browser bundle, fatally.
 *
 * This file MUST stay free of runtime imports. Anything that needs the
 * server-side machinery imports from gibson-client.ts directly; anything
 * that just needs the shape imports from here.
 *
 * Keep gibson-client.ts as the canonical source of these types, it
 * re-exports them so `import { Foo } from '@/src/lib/gibson-client'` keeps
 * working from server code; client code should prefer this file directly.
 */

/**
 * Mirrors gibson.tenant.v1.CredentialFieldType proto enum values.
 * 0=UNSPECIFIED, 1=TEXT, 2=PASSWORD, 3=URL, 4=REGION, 5=BOOL.
 *
 * Defined here rather than imported from the proto-generated file so that
 * client components can use the numeric values without pulling
 * @bufbuild/protobuf (and transitively @grpc/grpc-js) into the browser bundle.
 */
export type CredentialFieldType = 0 | 1 | 2 | 3 | 4 | 5;

export const CREDENTIAL_FIELD_TYPE = {
  UNSPECIFIED: 0,
  TEXT: 1,
  PASSWORD: 2,
  URL: 3,
  REGION: 4,
  BOOL: 5,
} as const satisfies Record<string, CredentialFieldType>;

/**
 * Credential field descriptor returned by the daemon's GetSupportedProviders
 * RPC. One entry per input the operator must supply in the provider form.
 */
export interface CredentialFieldDescriptor {
  /** ProviderConfig.Extra map key the daemon resolver reads ("api_key" / "base_url" for typed fields). */
  key: string;
  /** Human-facing form label. */
  label: string;
  /** Mandatory-for-construction flag. */
  required: boolean;
  /** Render as password input; mask in logs and audit records. */
  secret: boolean;
  /** Example value for the empty input. */
  placeholder: string;
  /** Short description rendered beneath the field. */
  help: string;
  /**
   * Semantic field type from the daemon's CredentialFieldType enum.
   * Optional, absent (or 0/UNSPECIFIED) falls back to the secret flag:
   * secret=true → PASSWORD, secret=false → TEXT. BOOL renders as a Checkbox.
   */
  fieldType?: CredentialFieldType;
}

/**
 * Model descriptor returned per provider so the dashboard can populate a
 * model picker. Mirrors the proto `gibson.tenant.v1.ModelDescriptor` shape.
 */
export interface ModelDescriptor {
  name: string;
  /** Optional vendor family / display group, e.g. "Claude 3.5", "GPT-4". */
  family: string;
  /** Maximum input tokens; 0 when unknown. */
  contextWindow: number;
  /** True when the provider catalogue marks this model as superseded. */
  deprecated?: boolean;
}

/**
 * Supported LLM provider descriptor, the client-side shape of the daemon's
 * ProviderDescriptor proto message.
 */
export interface SupportedProviderDescriptor {
  /** Provider type identifier (e.g. "bedrock", "openai"). */
  type: string;
  /** Human-facing label shown in the dashboard dropdown. */
  displayName: string;
  /** Upstream provider's credential/setup docs. */
  docsUrl: string;
  /** True for providers running on operator-controlled infrastructure. */
  selfHosted: boolean;
  /** Form schema, one entry per credential input. */
  credentials: CredentialFieldDescriptor[];
  /** Default model catalogue the provider advertises. */
  defaultModels: ModelDescriptor[];
}

/**
 * Input shape for creating/updating a daemon-managed provider configuration.
 * Mirrors the daemon's CreateProviderConfig RPC input.
 */
export interface DaemonProviderConfigInput {
  /** Tenant-scoped human name. */
  name: string;
  /** Provider type identifier (e.g. "anthropic", "openai"). */
  type: string;
  /** Model to use when none is specified by the caller. */
  defaultModel: string;
  /** Plaintext credentials, e.g. {"api_key": "sk-..."}. Transient, not retained by dashboard. */
  credentials: Record<string, string>;
  /** When true, atomically designates this provider as the tenant's default. */
  setAsDefault?: boolean;
}
