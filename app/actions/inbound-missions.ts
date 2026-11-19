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
  AGENT_PRINCIPAL_PREFIX,
  daemonCreateInboundCallerIdentity,
  daemonGrantInboundCaller,
  daemonListDefinitionAgents,
  daemonListInboundCallerNames,
  daemonListInboundCallers,
  daemonListInboundDefinitionOptions,
  daemonListInboundMissions,
  daemonListInboundTargetOptions,
  daemonWalkInboundMissions,
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
import { assertAuthorized } from "@/src/lib/auth/assert-authorized";
import { shownDaemonFailure } from "@/src/lib/errors/shown-daemon-failure";
import { revokeCleanupNote } from "@/src/lib/inbound-missions/revoke-note";
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

/**
 * The walk of the published definitions stopped at its bound. A check for the
 * absence of an agent cannot pass then, so the action refuses (fail closed).
 */
const LIST_INCOMPLETE = {
  ok: false,
  error:
    "The list of published definitions is too long to read in full, so the agent name cannot be checked. Nothing was changed.",
  code: "list_incomplete",
} as const;

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
 * Publish a stale publication again. The browser sends only the agent name.
 * The action reads the stored entry and sends its definition, its targets and
 * its limit, so a changed value from the browser changes nothing. It refuses
 * an entry that is not stale, because that publish would approve nothing new.
 * The flow makes no identity, and the callers keep their grants.
 */
export async function republishInboundMissionAction(
  agent: string,
): Promise<InboundActionResult<InboundMissionDTO | null>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const a = nameSchema.safeParse(agent);
  if (!a.success) return bad(a.error.issues[0]?.message);
  try {
    const present = await daemonWalkInboundMissions();
    const stored = present.items.find((e) => e.agent === a.data);
    if (!stored && present.truncated) return LIST_INCOMPLETE;
    if (!stored) {
      return { ok: false, error: `The agent ${a.data} is not published.`, code: "not_found" };
    }
    if (!stored.stale) {
      return {
        ok: false,
        error: `The publication of ${a.data} is not stale. It needs no new approval.`,
        code: "not_stale",
      };
    }
    const entry = await daemonPublishInboundMission({
      agent: stored.agent,
      missionDefinitionId: stored.missionDefinitionId,
      targetIds: stored.targetIds,
      maxActiveMissions: stored.maxActiveMissions,
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

const PUBLISH_METHOD = "/gibson.tenant.v1.InboundMissionService/PublishInboundMission";
const GRANT_METHOD = "/gibson.tenant.v1.InboundMissionService/GrantInboundCaller";

/**
 * Check that the caller may publish and grant, before the flow makes an
 * identity. CreateAgentIdentity needs only the "writer" relation. Without this
 * check a writer who calls the action directly gets an identity made, and only
 * then the publish is refused.
 */
async function refuseUnlessAdmin(action: string): Promise<InboundCallerFlowResult | null> {
  try {
    await assertAuthorized(PUBLISH_METHOD);
    await assertAuthorized(GRANT_METHOD);
    return null;
  } catch (err) {
    return shownDaemonFailure(err, action);
  }
}

/** The grant got Aborted two times: the publication changed during each try. */
class PublicationChangedError extends Error {
  constructor() {
    super("The publication changed during the grant. Try again.");
    this.name = "PublicationChangedError";
  }
}

/**
 * Grant the identity to the published definition. The daemon answers Aborted
 * when the publication changed during the grant. The flow sends the grant one
 * more time. A second Aborted becomes a fixed message.
 */
async function grantWithOneRetry(agent: string, identityId: string): Promise<void> {
  const aborted = (err: unknown) => err instanceof ConnectError && err.code === Code.Aborted;
  try {
    await daemonGrantInboundCaller(agent, identityId);
  } catch (first) {
    if (!aborted(first)) throw first;
    try {
      await daemonGrantInboundCaller(agent, identityId);
    } catch (second) {
      throw aborted(second) ? new PublicationChangedError() : second;
    }
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

  let step: InboundFlowStep = "identity";
  // The flow that only adds a caller works on a definition that is published.
  let published = publish === null;
  try {
    // The identity exists now. A principal of another type is a failure of the
    // identity step, and the flow revokes it like each later failure.
    if (!identity.principalId.startsWith(AGENT_PRINCIPAL_PREFIX)) {
      throw new Error("the daemon returned a principal that is not an agent identity");
    }
    if (publish) {
      step = "publish";
      await daemonPublishInboundMission({ agent, ...publish });
      published = true;
    }
    step = "grant";
    await grantWithOneRetry(agent, identity.principalId);
  } catch (err) {
    // The token of this identity never reaches the browser, so the identity
    // has no use. Revoke it, and report the result of the revoke.
    let removed = true;
    let revokeNote: string | undefined;
    try {
      await daemonRevokeInboundCallerIdentity(identity.principalId);
    } catch (revokeErr) {
      removed = false;
      // The daemon answers Unavailable when it blocked the access and did not
      // finish its cleanup: a retry finishes it. Envoy and the transport use
      // Unavailable too, so only the cleanup message gives a note, and the note
      // is a fixed text.
      if (revokeErr instanceof ConnectError && revokeErr.code === Code.Unavailable) {
        revokeNote = revokeCleanupNote(revokeErr.rawMessage) ?? undefined;
      }
    }
    const failure =
      err instanceof PublicationChangedError
        ? { ok: false as const, error: err.message, code: "aborted" }
        : shownDaemonFailure(err, action);
    return {
      ...failure,
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
  const denied = await refuseUnlessAdmin("publishInboundMissionAction");
  if (denied) return denied;
  // The daemon accepts a publish of an agent that is published with the same
  // definition and targets: it approves the present state again and replaces
  // the limit. This form must never do that, so it refuses a published agent
  // before it makes an identity.
  try {
    const present = await daemonWalkInboundMissions();
    if (present.items.some((e) => e.agent === a.data)) {
      return {
        ok: false,
        error: `The agent ${a.data} is already published. Use "Publish again" on its row to approve a change, or unpublish it first.`,
        code: "already_published",
      };
    }
    // An agent past the bound of the walk would pass the check above.
    if (present.truncated) return LIST_INCOMPLETE;
  } catch (err) {
    return shownDaemonFailure(err, "publishInboundMissionAction");
  }
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
  const denied = await refuseUnlessAdmin("addInboundCallerAction");
  if (denied) return denied;
  return runCallerFlow("addInboundCallerAction", a.data, c.data, null);
}
