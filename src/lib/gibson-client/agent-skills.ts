// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import "server-only";
/**
 * Typed dashboard client for gibson.tenant.v1.AgentSkillService (epic
 * gibson#1364).
 *
 * Each function calls one RPC through the user-acting transport. The
 * transport runs the registry check for the RPC before it sends the call. Each
 * RPC needs the tenant "admin" relation.
 *
 * These functions do not flatten a ConnectError. The Agent Skill actions read
 * the code and the message of a validation error and show them to the person
 * who published.
 */
import { userClient } from "../gibson-client";
import { walkItems } from "./paging";
import {
  AgentSkillService,
  AgentSkillSource,
  AgentSkillSubjectKind,
} from "@/src/gen/gibson/tenant/v1/agent_skill_pb";
import type {
  AgentSkillEntry,
  GetAgentSkillResponse,
  SharedAgentSkillEntry,
} from "@/src/gen/gibson/tenant/v1/agent_skill_pb";

import type {
  AgentSkillDTO,
  AgentSkillDetailDTO,
  AgentSkillGrantDTO,
  AgentSkillSubjectKindDTO,
  SharedAgentSkillDTO,
} from "./agent-skill-types";

function isoOrEmpty(ts: AgentSkillEntry["publishedAt"]): string {
  if (!ts) return "";
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6);
  return new Date(ms).toISOString();
}

function toAgentSkillDTO(e: AgentSkillEntry): AgentSkillDTO {
  return {
    name: e.name,
    digest: e.digest,
    reference: e.reference,
    description: e.description,
    license: e.license,
    compatibility: e.compatibility,
    metadata: { ...e.metadata },
    allowedTools: [...e.allowedTools],
    publishedAt: isoOrEmpty(e.publishedAt),
    current: e.current,
    source: e.source === AgentSkillSource.SHARED ? "shared" : "tenant",
  };
}

function toDetailDTO(r: GetAgentSkillResponse): AgentSkillDetailDTO | null {
  if (!r.entry) return null;
  return {
    entry: toAgentSkillDTO(r.entry),
    body: r.body,
    files: r.files.map((f) => ({ path: f.path, sizeBytes: Number(f.sizeBytes) })),
  };
}

function toSharedDTO(e: SharedAgentSkillEntry): SharedAgentSkillDTO {
  return { name: e.name, description: e.description, digest: e.digest, enabled: e.enabled };
}

function subjectKind(kind: AgentSkillSubjectKindDTO): AgentSkillSubjectKind {
  return kind === "agent"
    ? AgentSkillSubjectKind.AGENT
    : AgentSkillSubjectKind.MISSION;
}

/** List the Agent Skills of the tenant. By default each name shows once. */
export async function daemonListAgentSkills(
  opts: { name?: string; allVersions?: boolean } = {},
): Promise<AgentSkillDTO[]> {
  const client = userClient(AgentSkillService);
  const entries = await walkItems("tenant.agentSkills", async (pageSize, pageToken) => {
    const resp = await client.listAgentSkills({
      name: opts.name ?? "",
      allVersions: opts.allVersions ?? false,
      pageSize,
      pageToken,
    });
    return { items: resp.entries, nextPageToken: resp.nextPageToken };
  });
  return entries.map(toAgentSkillDTO);
}

/** Read one version with its body and its files. An empty digest means the current version. */
export async function daemonGetAgentSkill(
  name: string,
  digest = "",
): Promise<AgentSkillDetailDTO | null> {
  const resp = await userClient(AgentSkillService).getAgentSkill({ name, digest });
  return toDetailDTO(resp);
}

/** Publish a version from an OCI reference with a digest. */
export async function daemonPublishAgentSkill(input: {
  name: string;
  reference: string;
  registrySecret: string;
}): Promise<AgentSkillDTO | null> {
  const resp = await userClient(AgentSkillService).publishAgentSkill({
    name: input.name,
    reference: input.reference,
    registrySecret: input.registrySecret,
  });
  return resp.entry ? toAgentSkillDTO(resp.entry) : null;
}

/** Delete each version of a name, with its grants. Returns the version count. */
export async function daemonDeleteAgentSkill(name: string): Promise<number> {
  const resp = await userClient(AgentSkillService).deleteAgentSkill({ name });
  return resp.deletedVersions;
}

/** Let one agent or one mission load an Agent Skill. */
export async function daemonGrantAgentSkill(
  name: string,
  kind: AgentSkillSubjectKindDTO,
  subjectId: string,
): Promise<void> {
  await userClient(AgentSkillService).grantAgentSkill({
    name,
    subjectKind: subjectKind(kind),
    subjectId,
  });
}

/** Remove the grant of one agent or one mission. */
export async function daemonRevokeAgentSkill(
  name: string,
  kind: AgentSkillSubjectKindDTO,
  subjectId: string,
): Promise<void> {
  await userClient(AgentSkillService).revokeAgentSkill({
    name,
    subjectKind: subjectKind(kind),
    subjectId,
  });
}

/** List the Shared Agent Skills that the operator offers. */
export async function daemonListSharedAgentSkills(): Promise<SharedAgentSkillDTO[]> {
  const client = userClient(AgentSkillService);
  const entries = await walkItems("tenant.sharedAgentSkills", async (pageSize, pageToken) => {
    const resp = await client.listSharedAgentSkills({ pageSize, pageToken });
    return { items: resp.entries, nextPageToken: resp.nextPageToken };
  });
  return entries.map(toSharedDTO);
}

/** Copy one Shared Agent Skill into the tenant. It grants nothing. */
export async function daemonEnableSharedAgentSkill(name: string): Promise<AgentSkillDTO | null> {
  const resp = await userClient(AgentSkillService).enableSharedAgentSkill({ name });
  return resp.entry ? toAgentSkillDTO(resp.entry) : null;
}

/** List each agent and each mission that may load an Agent Skill. */
export async function daemonListAgentSkillGrants(name: string): Promise<AgentSkillGrantDTO[]> {
  const client = userClient(AgentSkillService);
  const grants = await walkItems("tenant.agentSkillGrants", async (pageSize, pageToken) => {
    const resp = await client.listAgentSkillGrants({ name, pageSize, pageToken });
    return { items: resp.grants, nextPageToken: resp.nextPageToken };
  });
  const out: AgentSkillGrantDTO[] = [];
  for (const g of grants) {
    if (g.subjectKind === AgentSkillSubjectKind.AGENT) {
      out.push({ kind: "agent", subjectId: g.subjectId });
    } else if (g.subjectKind === AgentSkillSubjectKind.MISSION) {
      out.push({ kind: "mission", subjectId: g.subjectId });
    }
  }
  return out;
}
