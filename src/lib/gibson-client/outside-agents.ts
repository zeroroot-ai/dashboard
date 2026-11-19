// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import "server-only";
/**
 * Typed dashboard client for gibson.tenant.v1.OutsideAgentService (epic
 * gibson#1366, gibson#1403). Each RPC needs the tenant "admin" relation. The
 * transport runs the registry check before it sends the call. A ConnectError
 * reaches the caller unchanged, so the actions can show a validation error.
 */
import { userClient } from "../gibson-client";
import { walkItems, walkPages } from "./paging";
import type { WalkResult } from "./paging";
import { OutsideAgentService } from "@/src/gen/gibson/tenant/v1/outside_agent_pb";
import type { OutsideAgentEntry } from "@/src/gen/gibson/tenant/v1/outside_agent_pb";

import type { OutsideAgentDTO } from "./outside-agent-types";

function toDTO(e: OutsideAgentEntry): OutsideAgentDTO {
  const ms = e.createdAt ? Number(e.createdAt.seconds) * 1000 + Math.floor(e.createdAt.nanos / 1e6) : 0;
  return {
    name: e.name,
    a2aUrl: e.a2aUrl,
    credentialSecret: e.credentialSecret,
    caBundleSecret: e.caBundleSecret,
    description: e.description,
    createdAt: e.createdAt ? new Date(ms).toISOString() : "",
  };
}

/** List each outside agent of the tenant. */
export async function daemonListOutsideAgents(): Promise<OutsideAgentDTO[]> {
  const client = userClient(OutsideAgentService);
  const entries = await walkItems("tenant.outsideAgents", async (pageSize, pageToken) => {
    const resp = await client.listOutsideAgents({ pageSize, pageToken });
    return { items: resp.entries, nextPageToken: resp.nextPageToken };
  });
  return entries.map(toDTO);
}

/** Read one outside agent. Null when the response holds no entry. */
export async function daemonGetOutsideAgent(name: string): Promise<OutsideAgentDTO | null> {
  const resp = await userClient(OutsideAgentService).getOutsideAgent({ name });
  return resp.entry ? toDTO(resp.entry) : null;
}

/** Register an outside agent. The daemon checks the URL and the secrets. */
export async function daemonRegisterOutsideAgent(input: {
  name: string;
  a2aUrl: string;
  credentialSecret: string;
  caBundleSecret: string;
  description: string;
}): Promise<OutsideAgentDTO | null> {
  const resp = await userClient(OutsideAgentService).registerOutsideAgent(input);
  return resp.entry ? toDTO(resp.entry) : null;
}

/** Remove the record and each grant of it. */
export async function daemonDeleteOutsideAgent(name: string): Promise<void> {
  await userClient(OutsideAgentService).deleteOutsideAgent({ name });
}

/** Let one mission call an outside agent. */
export async function daemonGrantOutsideAgent(name: string, missionId: string): Promise<void> {
  await userClient(OutsideAgentService).grantOutsideAgent({ name, missionId });
}

/** Remove the grant of one mission. */
export async function daemonRevokeOutsideAgent(name: string, missionId: string): Promise<void> {
  await userClient(OutsideAgentService).revokeOutsideAgent({ name, missionId });
}

/**
 * List the ids of the missions that may call one outside agent. `truncated` is
 * true when the walk stopped at its bound with grants left.
 */
export async function daemonListOutsideAgentGrants(name: string): Promise<WalkResult<string>> {
  const client = userClient(OutsideAgentService);
  return walkPages(async (pageSize, pageToken) => {
    const resp = await client.listOutsideAgentGrants({ name, pageSize, pageToken });
    return { items: resp.missionIds, nextPageToken: resp.nextPageToken };
  });
}
