// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import "server-only";
/**
 * Typed dashboard client for gibson.tenant.v1.InboundMissionService (epic
 * gibson#1367, gibson#1408), with the reads and the identity calls that the
 * publish page needs. Each InboundMissionService RPC needs the tenant "admin"
 * relation. The transport runs the registry check before it sends the call. A
 * ConnectError reaches the caller unchanged, so the actions can show a
 * validation error.
 */
import { randomUUID } from "node:crypto";

import { userClient } from "../gibson-client";
import { walkItems } from "./paging";
import { AgentIdentityService, PrincipalKind } from "@/src/gen/gibson/agentidentity/v1/agent_identity_pb";
import { DaemonService } from "@/src/gen/gibson/daemon/v1/daemon_pb";
import { InboundMissionService } from "@/src/gen/gibson/tenant/v1/inbound_mission_pb";
import type { InboundMissionEntry } from "@/src/gen/gibson/tenant/v1/inbound_mission_pb";

import type {
  InboundCallerIdentityDTO,
  InboundMissionDTO,
  InboundOptionDTO,
} from "./inbound-mission-types";

/**
 * The one session capability of an inbound caller (ADR-0045). The identity
 * gets no component grant, so its only right is the caller grant.
 */
export const INBOUND_CALLER_CEILING = "mission:originate";

const AGENT_PRINCIPAL_PREFIX = "agent_principal:";

function toDTO(e: InboundMissionEntry): InboundMissionDTO {
  const ms = e.createdAt ? Number(e.createdAt.seconds) * 1000 + Math.floor(e.createdAt.nanos / 1e6) : 0;
  return {
    agent: e.agent,
    missionDefinitionId: e.missionDefinitionId,
    targetIds: [...e.targetIds],
    publishedBy: e.publishedBy,
    createdAt: e.createdAt ? new Date(ms).toISOString() : "",
    stale: e.stale,
    staleReason: e.staleReason,
  };
}

/** List each published definition of the tenant. */
export async function daemonListInboundMissions(): Promise<InboundMissionDTO[]> {
  const client = userClient(InboundMissionService);
  const entries = await walkItems("tenant.inboundMissions", async (pageSize, pageToken) => {
    const resp = await client.listInboundMissions({ pageSize, pageToken });
    return { items: resp.entries, nextPageToken: resp.nextPageToken };
  });
  return entries.map(toDTO);
}

/**
 * Publish one mission definition under one agent name, with the approved
 * targets. The same agent, definition and targets again approve the present
 * state of a stale publication, and the callers keep their grants.
 */
export async function daemonPublishInboundMission(input: {
  agent: string;
  missionDefinitionId: string;
  targetIds: string[];
}): Promise<InboundMissionDTO | null> {
  const resp = await userClient(InboundMissionService).publishInboundMission({
    agent: input.agent,
    missionDefinitionId: input.missionDefinitionId,
    targetIds: input.targetIds,
  });
  return resp.entry ? toDTO(resp.entry) : null;
}

/** Remove the mark and each caller grant of it. */
export async function daemonUnpublishInboundMission(agent: string): Promise<void> {
  await userClient(InboundMissionService).unpublishInboundMission({ agent });
}

/**
 * Let one agent identity call a published definition. The id is the typed
 * principal id that CreateAgentIdentity returns, unchanged.
 */
export async function daemonGrantInboundCaller(agent: string, identityId: string): Promise<void> {
  await userClient(InboundMissionService).grantInboundCaller({ agent, identityId });
}

/** Remove the grant of one agent identity. */
export async function daemonRevokeInboundCaller(agent: string, identityId: string): Promise<void> {
  await userClient(InboundMissionService).revokeInboundCaller({ agent, identityId });
}

/** List the ids of the agent identities that may call one published definition. */
export async function daemonListInboundCallers(agent: string): Promise<string[]> {
  const client = userClient(InboundMissionService);
  return walkItems("tenant.inboundCallers", async (pageSize, pageToken) => {
    const resp = await client.listInboundCallers({ agent, pageSize, pageToken });
    return { items: resp.identityIds, nextPageToken: resp.nextPageToken };
  });
}

/**
 * Make the identity of one new caller: kind agent, the ceiling
 * "mission:originate" and no component grant. The response holds the one-time
 * bootstrap token.
 */
export async function daemonCreateInboundCallerIdentity(name: string): Promise<InboundCallerIdentityDTO> {
  const resp = await userClient(AgentIdentityService).createAgentIdentity({
    name,
    kind: PrincipalKind.AGENT,
    description: "Inbound A2A caller",
    componentGrants: [],
    capabilityCeiling: [INBOUND_CALLER_CEILING],
    idempotencyKey: randomUUID(),
  });
  if (!resp.principalId.startsWith(AGENT_PRINCIPAL_PREFIX)) {
    throw new Error("the daemon returned a principal that is not an agent identity");
  }
  return {
    principalId: resp.principalId,
    name: resp.name || name,
    bootstrapToken: resp.bootstrapToken,
    gibsonUrl: resp.gibsonUrl,
  };
}

/** Revoke an identity that the publish flow made and could not finish. */
export async function daemonRevokeInboundCallerIdentity(principalId: string): Promise<void> {
  await userClient(AgentIdentityService).revokeAgentIdentity({ principalId });
}

/** List the name of each agent identity of the tenant, keyed by the typed principal id. */
export async function daemonListInboundCallerNames(): Promise<Record<string, string>> {
  const client = userClient(AgentIdentityService);
  const identities = await walkItems("agentIdentity.agents", async (pageSize, pageToken) => {
    const resp = await client.listAgentIdentities({ pageSize, pageToken, kindFilter: PrincipalKind.AGENT });
    return { items: resp.identities, nextPageToken: resp.nextPageToken };
  });
  const names: Record<string, string> = {};
  for (const i of identities) {
    if (i.name) names[i.principalId] = i.name;
  }
  return names;
}

/** List each mission definition of the tenant, for the picker. */
export async function daemonListInboundDefinitionOptions(): Promise<InboundOptionDTO[]> {
  const client = userClient(DaemonService);
  const defs = await walkItems("daemon.missionDefinitions", async (pageSize, pageToken) => {
    const resp = await client.listMissionDefinitions({ pageSize, pageToken });
    return { items: resp.missions, nextPageToken: resp.nextPageToken };
  });
  return defs
    .filter((d) => d.missionDefinitionId !== "")
    .map((d) => ({ id: d.missionDefinitionId, name: d.name }));
}

/** List each target of the tenant, for the picker. */
export async function daemonListInboundTargetOptions(): Promise<InboundOptionDTO[]> {
  const client = userClient(DaemonService);
  const targets = await walkItems("daemon.targets", async (pageSize, pageToken) => {
    const resp = await client.listTargets({ pageSize, pageToken });
    return { items: resp.targets, nextPageToken: resp.nextPageToken };
  });
  return targets.map((t) => ({ id: t.id, name: t.name || t.id }));
}

/**
 * The agent names in the agent nodes of one mission definition. The daemon
 * publishes a definition only under one of these names.
 */
export async function daemonListDefinitionAgents(definitionName: string): Promise<string[]> {
  const resp = await userClient(DaemonService).getMissionDefinition({ name: definitionName });
  const names = new Set<string>();
  for (const node of Object.values(resp.definition?.nodes ?? {})) {
    if (node.config.case === "agentConfig" && node.config.value.agentName) {
      names.add(node.config.value.agentName);
    }
  }
  return [...names].sort();
}
