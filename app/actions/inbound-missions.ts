// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * Server Actions for the inbound missions page (epic gibson#1367, gibson#1408).
 *
 * Each action calls functions of src/lib/gibson-client/inbound-missions.ts.
 * Those functions use the user-acting transport, which runs the registry check
 * before each RPC. Each InboundMissionService RPC needs the tenant "admin"
 * relation, so a member gets a "Permission denied" result. The daemon checks
 * the relation again. A validation error of the daemon shows as text.
 *
 * A caller is always a new identity. The flow makes the identity, then the
 * publication, then the caller grant. When a step fails after the identity
 * exists, the flow revokes the identity and never returns its token. The
 * result states what the flow made and which step failed.
 */

import "server-only";

import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";

import {
  daemonCreateInboundCallerIdentity,
  daemonGrantInboundCaller,
  daemonListDefinitionAgents,
  daemonListInboundCallerNames,
  daemonListInboundCallers,
  daemonListInboundDefinitionOptions,
  daemonListInboundMissions,
  daemonListInboundTargetOptions,
  daemonPublishInboundMission,
  daemonRevokeInboundCaller,
  daemonRevokeInboundCallerIdentity,
  daemonUnpublishInboundMission,
} from "@/src/lib/gibson-client/inbound-missions";
import type {
  InboundCallerDTO,
  InboundCallerFlowResult,
  InboundCallerIdentityDTO,
  InboundFlowStep,
  InboundMissionDTO,
  InboundOptionDTO,
} from "@/src/lib/gibson-client/inbound-mission-types";
import { getServerSession } from "@/src/lib/auth";
import { shownDaemonFailure } from "@/src/lib/errors/shown-daemon-failure";
import { providerNameError } from "@/src/lib/providers/provider-name";

type InboundActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

const UNAUTHENTICATED = { ok: false, error: "Unauthenticated", code: "unauthenticated" } as const;

// The agent name and the caller name are DNS labels, the same rule as the name
// of a provider.
const nameSchema = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    const problem = providerNameError(v);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

const idSchema = z.string().trim().min(1, "An id is required.").max(255, "An id must be at most 255 characters.");

const targetIdsSchema = z
  .array(idSchema)
  .min(1, "Choose at least one target.")
  .max(100, "Choose at most 100 targets.")
  .refine((ids) => new Set(ids).size === ids.length, "A target appears two times.");

// The daemon accepts 1 to 10000 and has no default.
const maxActiveMissionsSchema = z
  .number({ error: "Enter the maximum number of missions at one time." })
  .int("The maximum number of missions must be a whole number.")
  .min(1, "The maximum number of missions must be at least 1.")
  .max(10000, "The maximum number of missions must be at most 10000.");

function bad(message: string | undefined): { ok: false; error: string; code: string } {
  return { ok: false, error: message ?? "Invalid input", code: "bad_input" };
}

/** List each published definition of the tenant. */
export async function listInboundMissionsAction(): Promise<InboundActionResult<InboundMissionDTO[]>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  try {
    return { ok: true, data: await daemonListInboundMissions() };
  } catch (err) {
    return shownDaemonFailure(err, "listInboundMissionsAction");
  }
}

/** List the mission definitions and the targets of the tenant, for the pickers. */
export async function listInboundPublishOptionsAction(): Promise<
  InboundActionResult<{ definitions: InboundOptionDTO[]; targets: InboundOptionDTO[] }>
> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  try {
    const [definitions, targets] = await Promise.all([
      daemonListInboundDefinitionOptions(),
      daemonListInboundTargetOptions(),
    ]);
    return { ok: true, data: { definitions, targets } };
  } catch (err) {
    return shownDaemonFailure(err, "listInboundPublishOptionsAction");
  }
}

/** List the agent names in the agent nodes of one mission definition. */
export async function listDefinitionAgentsAction(definitionName: string): Promise<InboundActionResult<string[]>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const n = idSchema.safeParse(definitionName);
  if (!n.success) return bad(n.error.issues[0]?.message);
  try {
    return { ok: true, data: await daemonListDefinitionAgents(n.data) };
  } catch (err) {
    return shownDaemonFailure(err, "listDefinitionAgentsAction");
  }
}

/** Remove the mark and each caller grant of it. */
export async function unpublishInboundMissionAction(agent: string): Promise<InboundActionResult> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const a = nameSchema.safeParse(agent);
  if (!a.success) return bad(a.error.issues[0]?.message);
  try {
    await daemonUnpublishInboundMission(a.data);
    return { ok: true, data: null };
  } catch (err) {
    return shownDaemonFailure(err, "unpublishInboundMissionAction");
  }
}

/**
 * Publish a stale publication again with the same agent, definition and
 * targets. The daemon approves the present state of the definition and the
 * targets. The flow makes no identity, and the callers keep their grants.
 */
export async function republishInboundMissionAction(input: {
  agent: string;
  missionDefinitionId: string;
  targetIds: string[];
  maxActiveMissions: number;
}): Promise<InboundActionResult<InboundMissionDTO | null>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const a = nameSchema.safeParse(input.agent);
  if (!a.success) return bad(a.error.issues[0]?.message);
  const d = idSchema.safeParse(input.missionDefinitionId);
  if (!d.success) return bad(d.error.issues[0]?.message);
  const t = targetIdsSchema.safeParse(input.targetIds);
  if (!t.success) return bad(t.error.issues[0]?.message);
  const n = maxActiveMissionsSchema.safeParse(input.maxActiveMissions);
  if (!n.success) return bad(n.error.issues[0]?.message);
  try {
    const entry = await daemonPublishInboundMission({
      agent: a.data,
      missionDefinitionId: d.data,
      targetIds: t.data,
      maxActiveMissions: n.data,
    });
    return { ok: true, data: entry };
  } catch (err) {
    return shownDaemonFailure(err, "republishInboundMissionAction");
  }
}

/** List the callers of one published definition, each with the name of its identity. */
export async function listInboundCallersAction(
  agent: string,
): Promise<InboundActionResult<{ items: InboundCallerDTO[]; truncated: boolean }>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const a = nameSchema.safeParse(agent);
  if (!a.success) return bad(a.error.issues[0]?.message);
  try {
    const [callers, names] = await Promise.all([daemonListInboundCallers(a.data), daemonListInboundCallerNames()]);
    return {
      ok: true,
      data: {
        items: callers.items.map((identityId) => ({ identityId, name: names[identityId] ?? "" })),
        truncated: callers.truncated,
      },
    };
  } catch (err) {
    return shownDaemonFailure(err, "listInboundCallersAction");
  }
}

/** Remove the grant of one caller. */
export async function revokeInboundCallerAction(input: {
  agent: string;
  identityId: string;
}): Promise<InboundActionResult> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const a = nameSchema.safeParse(input.agent);
  if (!a.success) return bad(a.error.issues[0]?.message);
  const i = idSchema.safeParse(input.identityId);
  if (!i.success) return bad(i.error.issues[0]?.message);
  try {
    await daemonRevokeInboundCaller(a.data, i.data);
    return { ok: true, data: null };
  } catch (err) {
    return shownDaemonFailure(err, "revokeInboundCallerAction");
  }
}

/**
 * Make one new identity, publish when `publish` is set, and grant the identity
 * to the published definition. The calls run in that order.
 */
async function runCallerFlow(
  action: string,
  agent: string,
  callerName: string,
  publish: { missionDefinitionId: string; targetIds: string[]; maxActiveMissions: number } | null,
): Promise<InboundCallerFlowResult> {
  let identity: InboundCallerIdentityDTO;
  try {
    identity = await daemonCreateInboundCallerIdentity(callerName);
  } catch (err) {
    return { ...shownDaemonFailure(err, action), failedStep: "identity", published: publish === null };
  }
  const caller: InboundCallerDTO = { identityId: identity.principalId, name: identity.name };

  let step: InboundFlowStep = publish ? "publish" : "grant";
  // The flow that only adds a caller works on a definition that is published.
  let published = publish === null;
  try {
    if (publish) {
      await daemonPublishInboundMission({ agent, ...publish });
      published = true;
      step = "grant";
    }
    await daemonGrantInboundCaller(agent, identity.principalId);
  } catch (err) {
    // The token of this identity never reaches the browser, so the identity
    // has no use. Revoke it, and report the result of the revoke.
    let removed = true;
    let revokeNote: string | undefined;
    try {
      await daemonRevokeInboundCallerIdentity(identity.principalId);
    } catch (revokeErr) {
      removed = false;
      // The daemon answers Unavailable with a text for the admin. One case is a
      // revoke that blocked the access and did not finish its cleanup: a retry
      // finishes it.
      if (revokeErr instanceof ConnectError && revokeErr.code === Code.Unavailable) {
        revokeNote = revokeErr.rawMessage.trim() || undefined;
      }
    }
    return {
      ...shownDaemonFailure(err, action),
      failedStep: step,
      identity: { ...caller, removed, ...(revokeNote ? { revokeNote } : {}) },
      published,
    };
  }

  return {
    ok: true,
    caller,
    credentials: { bootstrapToken: identity.bootstrapToken, gibsonUrl: identity.gibsonUrl },
  };
}

/**
 * Publish one mission definition for inbound calls, with one new caller. The
 * caller is a new identity with only the grant to this definition.
 */
export async function publishInboundMissionAction(input: {
  agent: string;
  missionDefinitionId: string;
  targetIds: string[];
  maxActiveMissions: number;
  callerName: string;
}): Promise<InboundCallerFlowResult> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const a = nameSchema.safeParse(input.agent);
  if (!a.success) return bad(a.error.issues[0]?.message);
  const d = idSchema.safeParse(input.missionDefinitionId);
  if (!d.success) return bad(d.error.issues[0]?.message);
  const t = targetIdsSchema.safeParse(input.targetIds);
  if (!t.success) return bad(t.error.issues[0]?.message);
  const n = maxActiveMissionsSchema.safeParse(input.maxActiveMissions);
  if (!n.success) return bad(n.error.issues[0]?.message);
  const c = nameSchema.safeParse(input.callerName);
  if (!c.success) return bad(c.error.issues[0]?.message);
  return runCallerFlow("publishInboundMissionAction", a.data, c.data, {
    missionDefinitionId: d.data,
    targetIds: t.data,
    maxActiveMissions: n.data,
  });
}

/** Add one new caller to a definition that is published. */
export async function addInboundCallerAction(input: {
  agent: string;
  callerName: string;
}): Promise<InboundCallerFlowResult> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const a = nameSchema.safeParse(input.agent);
  if (!a.success) return bad(a.error.issues[0]?.message);
  const c = nameSchema.safeParse(input.callerName);
  if (!c.success) return bad(c.error.issues[0]?.message);
  return runCallerFlow("addInboundCallerAction", a.data, c.data, null);
}
