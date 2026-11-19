// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * Server Actions for the Agent Skill pages (epic gibson#1364).
 *
 * Each action calls one function of src/lib/gibson-client/agent-skills.ts.
 * Those functions use the user-acting transport. The transport runs the
 * registry check before each RPC. Each AgentSkillService RPC needs the tenant
 * "admin" relation, so a member gets a "Permission denied" result. The daemon
 * and ext-authz check the relation again.
 *
 * A validation error of the daemon is shown to the publisher as text. See
 * src/lib/errors/shown-daemon-failure.ts.
 */

import "server-only";

import { z } from "zod";

import {
  daemonDeleteAgentSkill,
  daemonEnableSharedAgentSkill,
  daemonGetAgentSkill,
  daemonGrantAgentSkill,
  daemonListAgentSkillGrants,
  daemonListAgentSkills,
  daemonListSharedAgentSkills,
  daemonPublishAgentSkill,
  daemonRevokeAgentSkill,
} from "@/src/lib/gibson-client/agent-skills";
import type {
  AgentSkillDTO,
  AgentSkillDetailDTO,
  AgentSkillGrantDTO,
  SharedAgentSkillDTO,
} from "@/src/lib/gibson-client/agent-skill-types";
import { getServerSession } from "@/src/lib/auth";
import { listMissions } from "@/src/lib/gibson-client";
import { shownDaemonFailure } from "@/src/lib/errors/shown-daemon-failure";

type AgentSkillActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

const UNAUTHENTICATED = {
  ok: false,
  error: "Unauthenticated",
  code: "unauthenticated",
} as const;

// ---------------------------------------------------------------------------
// Input schemas. The limits match the validation rules of the proto.
// ---------------------------------------------------------------------------

const nameSchema = z
  .string()
  .trim()
  .min(1, "An Agent Skill name is required.")
  .max(64, "The Agent Skill name must be at most 64 characters.");

// The daemon decides if a reference is valid. It refuses a tag and shows why.
const referenceSchema = z
  .string()
  .trim()
  .min(1, "An OCI reference is required.")
  .max(1024, "The OCI reference must be at most 1024 characters.");

const registrySecretSchema = z
  .string()
  .trim()
  .max(255, "The registry secret name must be at most 255 characters.");

const digestSchema = z
  .string()
  .trim()
  .max(128, "The digest must be at most 128 characters.");

const subjectKindSchema = z.enum(["agent", "mission"], {
  message: "Choose an agent or a mission.",
});

const subjectIdSchema = z
  .string()
  .trim()
  .min(1, "An id is required.")
  .max(255, "The id must be at most 255 characters.");

function bad(message: string | undefined): AgentSkillActionResult<never> {
  return { ok: false, error: message ?? "Invalid input", code: "bad_input" };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** List the current version of each Agent Skill of the tenant. */
export async function listAgentSkillsAction(): Promise<AgentSkillActionResult<AgentSkillDTO[]>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  try {
    return { ok: true, data: await daemonListAgentSkills() };
  } catch (err) {
    return shownDaemonFailure(err, "listAgentSkillsAction");
  }
}

/** List each version of one Agent Skill, newest first as the daemon orders them. */
export async function listAgentSkillVersionsAction(
  name: string,
): Promise<AgentSkillActionResult<AgentSkillDTO[]>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const n = nameSchema.safeParse(name);
  if (!n.success) return bad(n.error.issues[0]?.message);
  try {
    return { ok: true, data: await daemonListAgentSkills({ name: n.data, allVersions: true }) };
  } catch (err) {
    return shownDaemonFailure(err, "listAgentSkillVersionsAction");
  }
}

/** Read one version. An empty digest reads the current version. */
export async function getAgentSkillAction(
  name: string,
  digest: string,
): Promise<AgentSkillActionResult<AgentSkillDetailDTO | null>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const n = nameSchema.safeParse(name);
  if (!n.success) return bad(n.error.issues[0]?.message);
  const d = digestSchema.safeParse(digest);
  if (!d.success) return bad(d.error.issues[0]?.message);
  try {
    return { ok: true, data: await daemonGetAgentSkill(n.data, d.data) };
  } catch (err) {
    return shownDaemonFailure(err, "getAgentSkillAction");
  }
}

/** Publish a version from an OCI reference with a digest. */
export async function publishAgentSkillAction(input: {
  name: string;
  reference: string;
  registrySecret: string;
}): Promise<AgentSkillActionResult<AgentSkillDTO | null>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const n = nameSchema.safeParse(input.name);
  if (!n.success) return bad(n.error.issues[0]?.message);
  const r = referenceSchema.safeParse(input.reference);
  if (!r.success) return bad(r.error.issues[0]?.message);
  const s = registrySecretSchema.safeParse(input.registrySecret);
  if (!s.success) return bad(s.error.issues[0]?.message);
  try {
    const entry = await daemonPublishAgentSkill({
      name: n.data,
      reference: r.data,
      registrySecret: s.data,
    });
    return { ok: true, data: entry };
  } catch (err) {
    return shownDaemonFailure(err, "publishAgentSkillAction");
  }
}

/** Delete each version of a name, with its grants. */
export async function deleteAgentSkillAction(
  name: string,
): Promise<AgentSkillActionResult<{ deletedVersions: number }>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const n = nameSchema.safeParse(name);
  if (!n.success) return bad(n.error.issues[0]?.message);
  try {
    return { ok: true, data: { deletedVersions: await daemonDeleteAgentSkill(n.data) } };
  } catch (err) {
    return shownDaemonFailure(err, "deleteAgentSkillAction");
  }
}

/** Let one agent or one mission load an Agent Skill. */
export async function grantAgentSkillAction(input: {
  name: string;
  subjectKind: string;
  subjectId: string;
}): Promise<AgentSkillActionResult> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const n = nameSchema.safeParse(input.name);
  if (!n.success) return bad(n.error.issues[0]?.message);
  const k = subjectKindSchema.safeParse(input.subjectKind);
  if (!k.success) return bad(k.error.issues[0]?.message);
  const id = subjectIdSchema.safeParse(input.subjectId);
  if (!id.success) return bad(id.error.issues[0]?.message);
  try {
    await daemonGrantAgentSkill(n.data, k.data, id.data);
    return { ok: true, data: null };
  } catch (err) {
    return shownDaemonFailure(err, "grantAgentSkillAction");
  }
}

/** Remove the grant of one agent or one mission. */
export async function revokeAgentSkillAction(input: {
  name: string;
  subjectKind: string;
  subjectId: string;
}): Promise<AgentSkillActionResult> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const n = nameSchema.safeParse(input.name);
  if (!n.success) return bad(n.error.issues[0]?.message);
  const k = subjectKindSchema.safeParse(input.subjectKind);
  if (!k.success) return bad(k.error.issues[0]?.message);
  const id = subjectIdSchema.safeParse(input.subjectId);
  if (!id.success) return bad(id.error.issues[0]?.message);
  try {
    await daemonRevokeAgentSkill(n.data, k.data, id.data);
    return { ok: true, data: null };
  } catch (err) {
    return shownDaemonFailure(err, "revokeAgentSkillAction");
  }
}

/** List each agent and each mission that may load an Agent Skill. */
export async function listAgentSkillGrantsAction(
  name: string,
): Promise<AgentSkillActionResult<{ items: AgentSkillGrantDTO[]; truncated: boolean }>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const n = nameSchema.safeParse(name);
  if (!n.success) return bad(n.error.issues[0]?.message);
  try {
    return { ok: true, data: await daemonListAgentSkillGrants(n.data) };
  } catch (err) {
    return shownDaemonFailure(err, "listAgentSkillGrantsAction");
  }
}

/** The id and the name of one mission, for the picker of a grant. */
interface MissionOption {
  id: string;
  name: string;
}

/**
 * List the missions of the tenant for the picker of a grant. It reads the
 * same ListMissions call as the missions page. The picker is a convenience,
 * and the form keeps a text field for an id that the list does not hold.
 */
export async function listMissionOptionsAction(): Promise<AgentSkillActionResult<MissionOption[]>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  try {
    const resp = await listMissions(false, 200, session.user.id);
    return {
      ok: true,
      data: resp.missions.map((m) => ({ id: m.id, name: m.name || m.id })),
    };
  } catch (err) {
    return shownDaemonFailure(err, "listMissionOptionsAction");
  }
}

/** List the Shared Agent Skills that the operator offers. */
export async function listSharedAgentSkillsAction(): Promise<
  AgentSkillActionResult<SharedAgentSkillDTO[]>
> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  try {
    return { ok: true, data: await daemonListSharedAgentSkills() };
  } catch (err) {
    return shownDaemonFailure(err, "listSharedAgentSkillsAction");
  }
}

/** Copy one Shared Agent Skill into the tenant. It grants nothing. */
export async function enableSharedAgentSkillAction(
  name: string,
): Promise<AgentSkillActionResult<AgentSkillDTO | null>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const n = nameSchema.safeParse(name);
  if (!n.success) return bad(n.error.issues[0]?.message);
  try {
    return { ok: true, data: await daemonEnableSharedAgentSkill(n.data) };
  } catch (err) {
    return shownDaemonFailure(err, "enableSharedAgentSkillAction");
  }
}
