// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * Server Actions for the /settings/model-access page.
 *
 * Wraps the daemon's gibson.tenant.v1.ModelAccessService RPCs so the
 * dashboard can grant / revoke per-user / per-team access to providers
 * and models, and render the model_resolved audit trail.
 *
 * Spec: llm-user-attribution-governance (Requirement 4).
 *
 * Authz: the daemon's ext-authz layer is authoritative and rejects
 * non-admin mutations. As defense-in-depth, every RPC dispatched through the
 * user-acting client is registry-gated by the transport's baked-in
 * assertAuthorized check (dashboard#848 / #902); a denial is thrown from
 * inside the RPC call as AuthzDeniedError and mapped to the canonical
 * "Permission denied" result by permissionDeniedResult (dashboard#904).
 * The relation each method requires is derived from the generated authz
 * registry (the same source ext-authz enforces); it is never hand-picked here.
 */

import { getModelAccessClient, userClient } from "@/src/lib/gibson-client";
import {
  chatCapableModels,
  fromProtoCapabilities,
  hasChatCapability,
  isEmbeddingOnlyProviderType,
  modelCapabilitiesFromProto,
} from "@/src/lib/provider-capabilities";
import { ProviderService } from "@/src/gen/gibson/tenant/v1/provider_pb";
import { getServerSession } from "@/src/lib/auth";
import { permissionDeniedResult } from "@/src/lib/auth/assert-authorized";
import {
  GrantSubjectKind,
  GrantTargetKind,
} from "@/src/gen/gibson/tenant/v1/model_access_pb";

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export type SubjectKindInput = "user" | "team" | "tenant";
export type TargetKindInput = "provider" | "model";

export interface AccessGrantRow {
  tenantId: string;
  subjectKind: SubjectKindInput;
  subjectId: string;
  targetKind: TargetKindInput;
  targetId: string;
  grantedAtUnix: number;
  grantedByUserId: string;
}

export interface ModelResolutionEventRow {
  tenantId: string;
  userId: string;
  missionId: string;
  runId: string;
  agentId: string;
  slotName: string;
  chosenProvider: string;
  chosenModel: string;
  timestampUnix: number;
}

function subjectToProto(k: SubjectKindInput): GrantSubjectKind {
  switch (k) {
    case "user":
      return GrantSubjectKind.USER;
    case "team":
      return GrantSubjectKind.TEAM;
    case "tenant":
      return GrantSubjectKind.TENANT;
  }
}

/**
 * The subject id sent to the daemon. A tenant subject is always the caller's
 * own tenant, so it carries no id: the daemon resolves it from the session
 * and refuses the id of another tenant (hosted#358).
 */
function subjectIdForProto(k: SubjectKindInput, id: string): string {
  return k === "tenant" ? "" : id;
}

function targetToProto(k: TargetKindInput): GrantTargetKind {
  switch (k) {
    case "provider":
      return GrantTargetKind.PROVIDER;
    case "model":
      return GrantTargetKind.MODEL;
  }
}

function subjectFromProto(k: GrantSubjectKind): SubjectKindInput {
  switch (k) {
    case GrantSubjectKind.USER:
      return "user";
    case GrantSubjectKind.TEAM:
      return "team";
    case GrantSubjectKind.TENANT:
      return "tenant";
    default:
      return "user";
  }
}

function targetFromProto(k: GrantTargetKind): TargetKindInput {
  switch (k) {
    case GrantTargetKind.PROVIDER:
      return "provider";
    case GrantTargetKind.MODEL:
      return "model";
    default:
      return "provider";
  }
}

// ---------------------------------------------------------------------
// Grant / Revoke
// ---------------------------------------------------------------------

export interface GrantInput {
  subjectKind: SubjectKindInput;
  subjectId: string;
  targetKind: TargetKindInput;
  /**
   * A provider type name for a provider grant (for example "anthropic"), or a
   * model name for a model grant. Gibson matches grants against the provider
   * type, never against the name of a tenant's own provider config.
   */
  targetId: string;
  /**
   * The provider type that lists the model. A model grant needs it, and the
   * action does not send it. A provider grant ignores it.
   */
  providerType?: string;
}

/** Deadline for one ListProviderModels call, so a slow config cannot stall the form. */
const LIST_MODELS_TIMEOUT_MS = 5000;

/**
 * The tenant's provider configs that can become a grant target: enabled, of a
 * type that can chat, and saved with the chat capability. A config with no
 * stored capabilities counts as chat. This is the rule of the daemon. A
 * catalog type with no such config is not a target.
 */
async function grantableConfigs() {
  const { providers } = await userClient(ProviderService).listProviders({});
  return providers.filter(
    (p) =>
      p.enabled &&
      !isEmbeddingOnlyProviderType(p.type) &&
      hasChatCapability(fromProtoCapabilities(p.capabilities ?? [])),
  );
}

/** The provider types the form may offer, one for each grantable config type. */
async function grantableTypes(): Promise<string[]> {
  const configs = await grantableConfigs();
  return [...new Set(configs.map((c) => c.type))].sort();
}

/**
 * The chat model names of the tenant's enabled configs of one type. The live
 * list from ListProviderModels is the source. It is keyed by the name of a
 * provider config, so each enabled config of the type is asked in parallel and
 * the names are merged. A config that throws, times out or replies ok:false
 * adds nothing. A model that reports capabilities without chat is dropped. The
 * saved default model of each config is also allowed, so a default that the
 * live list no longer returns can still be granted.
 */
async function chatModelsForType(type: string): Promise<string[]> {
  const client = userClient(ProviderService);
  const configs = (await grantableConfigs()).filter((c) => c.type === type);
  const names = new Set<string>();
  for (const cfg of configs) {
    if (cfg.defaultModel) names.add(cfg.defaultModel);
  }
  const replies = await Promise.allSettled(
    configs.map((cfg) =>
      client.listProviderModels(
        { name: cfg.name },
        { timeoutMs: LIST_MODELS_TIMEOUT_MS },
      ),
    ),
  );
  for (const reply of replies) {
    if (reply.status !== "fulfilled" || !reply.value.ok) continue;
    const models = reply.value.models.map((m) => ({
      name: m.name,
      capabilities: modelCapabilitiesFromProto(m.capabilities ?? []),
    }));
    for (const m of chatCapableModels(models)) names.add(m.name);
  }
  return [...names].sort();
}

/**
 * Checks a grant target against the tenant's enabled configs. A provider
 * grant must name the type of an enabled, chat-capable config. A model grant
 * must also name a chat model that an enabled config of that type lists.
 * Returns an error text, or null when valid.
 */
async function checkGrantTarget(input: GrantInput): Promise<string | null> {
  const type = input.targetKind === "provider" ? input.targetId : input.providerType ?? "";
  if (isEmbeddingOnlyProviderType(type)) {
    return `"${type}" serves embeddings only and cannot be granted`;
  }
  const types = await grantableTypes();
  if (!types.includes(type)) {
    return `"${type}" has no enabled provider config`;
  }
  if (input.targetKind === "provider") return null;
  const models = await chatModelsForType(type);
  return models.includes(input.targetId)
    ? null
    : `"${input.targetId}" is not a chat model of an enabled ${type} config`;
}

/** Provider types for the grant form's type picker. */
export async function listGrantableProviderTypesAction(): Promise<ActionResult<string[]>> {
  const session = await getServerSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    return { ok: true, data: await grantableTypes() };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Chat models for the grant form's model picker. */
export async function listChatModelsForTypeAction(
  providerType: string,
): Promise<ActionResult<string[]>> {
  const session = await getServerSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    return { ok: true, data: await chatModelsForType(providerType) };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function grantModelAccessAction(
  input: GrantInput,
): Promise<ActionResult<null>> {
  const session = await getServerSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    const invalid = await checkGrantTarget(input);
    if (invalid) return { ok: false, error: invalid, code: "invalid_target" };
    const client = await getModelAccessClient();
    await client.grantAccess({
      grant: {
        tenantId: "", // daemon overwrites with session tenant
        subjectKind: subjectToProto(input.subjectKind),
        subjectId: subjectIdForProto(input.subjectKind, input.subjectId),
        targetKind: targetToProto(input.targetKind),
        targetId: input.targetId,
        grantedAtUnix: BigInt(Math.floor(Date.now() / 1000)),
        grantedByUserId: "", // daemon overwrites from session identity
      },
    });
    return { ok: true, data: null };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function revokeModelAccessAction(
  input: GrantInput,
): Promise<ActionResult<null>> {
  const session = await getServerSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    const client = await getModelAccessClient();
    await client.revokeAccess({
      subjectKind: subjectToProto(input.subjectKind),
      subjectId: subjectIdForProto(input.subjectKind, input.subjectId),
      targetKind: targetToProto(input.targetKind),
      targetId: input.targetId,
    });
    return { ok: true, data: null };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------
// List grants for a specific subject (required because listing by
// object type needs a subject reference; see design.md § ListAccess).
// ---------------------------------------------------------------------

export async function listModelAccessAction(
  subjectKind: SubjectKindInput,
  subjectId: string,
): Promise<ActionResult<AccessGrantRow[]>> {
  const session = await getServerSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    const client = await getModelAccessClient();
    const resp = await client.listAccess({
      subjectKind: subjectToProto(subjectKind),
      subjectId: subjectIdForProto(subjectKind, subjectId),
    });
    return {
      ok: true,
      data: resp.grants.map((g) => ({
        tenantId: g.tenantId,
        subjectKind: subjectFromProto(g.subjectKind),
        subjectId: g.subjectId,
        targetKind: targetFromProto(g.targetKind),
        targetId: g.targetId,
        grantedAtUnix: Number(g.grantedAtUnix),
        grantedByUserId: g.grantedByUserId,
      })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------

interface ListAuditInput {
  fromUnix: number;
  toUnix: number;
  userId?: string;
  slotName?: string;
}

export async function listModelAccessAuditAction(
  input: ListAuditInput,
): Promise<ActionResult<ModelResolutionEventRow[]>> {
  const session = await getServerSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    const client = await getModelAccessClient();
    const resp = await client.listModelResolutionEvents({
      startTimeUnix: BigInt(input.fromUnix),
      endTimeUnix: BigInt(input.toUnix),
      userId: input.userId ?? "",
      slotName: input.slotName ?? "",
    });
    return {
      ok: true,
      data: resp.events.map((e) => ({
        tenantId: e.tenantId,
        userId: e.userId,
        missionId: e.missionId,
        runId: e.runId,
        agentId: e.agentId,
        slotName: e.slotName,
        chosenProvider: e.chosenProvider,
        chosenModel: e.chosenModel,
        timestampUnix: Number(e.timestampUnix),
      })),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
