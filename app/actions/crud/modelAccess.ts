"use server";

/**
 * Server Actions for the /settings/model-access page.
 *
 * Wraps the daemon's gibson.authz.v1.ModelAccessService RPCs so the
 * dashboard can grant / revoke per-user / per-team access to providers
 * and models, and render the model_resolved audit trail.
 *
 * Spec: llm-user-attribution-governance (Requirement 4).
 */

import { getModelAccessClient } from "@/src/lib/gibson-client";
import { getServerSession } from "@/src/lib/auth";
import {
  GrantSubjectKind,
  GrantTargetKind,
} from "@/src/gen/gibson/authz/v1/model_access_pb";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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
  targetId: string;
}

export async function grantModelAccessAction(
  input: GrantInput,
): Promise<ActionResult<null>> {
  const session = await getServerSession();
  if (!session?.user) return { ok: false, error: "unauthenticated" };
  try {
    const client = await getModelAccessClient();
    await client.grantAccess({
      grant: {
        tenantId: "", // daemon overwrites with session tenant
        subjectKind: subjectToProto(input.subjectKind),
        subjectId: input.subjectId,
        targetKind: targetToProto(input.targetKind),
        targetId: input.targetId,
        grantedAtUnix: BigInt(Math.floor(Date.now() / 1000)),
        grantedByUserId: "", // daemon overwrites from session identity
      },
    });
    return { ok: true, data: null };
  } catch (err) {
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
      subjectId: input.subjectId,
      targetKind: targetToProto(input.targetKind),
      targetId: input.targetId,
    });
    return { ok: true, data: null };
  } catch (err) {
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
      subjectId,
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

export interface ListAuditInput {
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
