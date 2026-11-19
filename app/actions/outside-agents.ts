// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * Server Actions for the outside agent pages (epic gibson#1366, gibson#1403).
 *
 * Each action calls one function of src/lib/gibson-client/outside-agents.ts.
 * Those functions use the user-acting transport, which runs the registry check
 * before each RPC. Each OutsideAgentService RPC needs the tenant "admin"
 * relation, so a member gets a "Permission denied" result. The daemon checks
 * the relation again. A validation error of the daemon shows as text.
 */

import "server-only";

import { z } from "zod";

import {
  daemonDeleteOutsideAgent,
  daemonGetOutsideAgent,
  daemonGrantOutsideAgent,
  daemonListOutsideAgentGrants,
  daemonListOutsideAgents,
  daemonRegisterOutsideAgent,
  daemonRevokeOutsideAgent,
} from "@/src/lib/gibson-client/outside-agents";
import type { OutsideAgentDTO } from "@/src/lib/gibson-client/outside-agent-types";
import { getServerSession } from "@/src/lib/auth";
import { shownDaemonFailure } from "@/src/lib/errors/shown-daemon-failure";
import { outsideAgentUrlError } from "@/src/lib/outside-agents/url";
import { providerNameError } from "@/src/lib/providers/provider-name";

type OutsideAgentActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

const UNAUTHENTICATED = { ok: false, error: "Unauthenticated", code: "unauthenticated" } as const;

// The name is a DNS label, the same rule as the name of a provider.
const nameSchema = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    const problem = providerNameError(v);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

const urlSchema = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    const problem = outsideAgentUrlError(v);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

const secretNameSchema = z.string().trim().max(255, "A secret name must be at most 255 characters.");
const descriptionSchema = z.string().trim().max(1024, "The description must be at most 1024 characters.");
const missionIdSchema = z
  .string()
  .trim()
  .min(1, "A mission id is required.")
  .max(255, "The mission id must be at most 255 characters.");

function bad(message: string | undefined): OutsideAgentActionResult<never> {
  return { ok: false, error: message ?? "Invalid input", code: "bad_input" };
}

/** List each outside agent of the tenant. */
export async function listOutsideAgentsAction(): Promise<OutsideAgentActionResult<OutsideAgentDTO[]>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  try {
    return { ok: true, data: await daemonListOutsideAgents() };
  } catch (err) {
    return shownDaemonFailure(err, "listOutsideAgentsAction");
  }
}

/** Read one outside agent. */
export async function getOutsideAgentAction(
  name: string,
): Promise<OutsideAgentActionResult<OutsideAgentDTO | null>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const n = nameSchema.safeParse(name);
  if (!n.success) return bad(n.error.issues[0]?.message);
  try {
    return { ok: true, data: await daemonGetOutsideAgent(n.data) };
  } catch (err) {
    return shownDaemonFailure(err, "getOutsideAgentAction");
  }
}

/** Register an outside agent. The daemon checks the URL, the host and the secrets. */
export async function registerOutsideAgentAction(input: {
  name: string;
  a2aUrl: string;
  credentialSecret: string;
  caBundleSecret: string;
  description: string;
}): Promise<OutsideAgentActionResult<OutsideAgentDTO | null>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const n = nameSchema.safeParse(input.name);
  if (!n.success) return bad(n.error.issues[0]?.message);
  const u = urlSchema.safeParse(input.a2aUrl);
  if (!u.success) return bad(u.error.issues[0]?.message);
  const c = secretNameSchema.safeParse(input.credentialSecret);
  if (!c.success) return bad(c.error.issues[0]?.message);
  const ca = secretNameSchema.safeParse(input.caBundleSecret);
  if (!ca.success) return bad(ca.error.issues[0]?.message);
  const d = descriptionSchema.safeParse(input.description);
  if (!d.success) return bad(d.error.issues[0]?.message);
  try {
    const entry = await daemonRegisterOutsideAgent({
      name: n.data,
      a2aUrl: u.data,
      credentialSecret: c.data,
      caBundleSecret: ca.data,
      description: d.data,
    });
    return { ok: true, data: entry };
  } catch (err) {
    return shownDaemonFailure(err, "registerOutsideAgentAction");
  }
}

/** Remove the record and each grant of it. */
export async function deleteOutsideAgentAction(name: string): Promise<OutsideAgentActionResult> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const n = nameSchema.safeParse(name);
  if (!n.success) return bad(n.error.issues[0]?.message);
  try {
    await daemonDeleteOutsideAgent(n.data);
    return { ok: true, data: null };
  } catch (err) {
    return shownDaemonFailure(err, "deleteOutsideAgentAction");
  }
}

/** List the ids of the missions that may call one outside agent. */
export async function listOutsideAgentGrantsAction(
  name: string,
): Promise<OutsideAgentActionResult<{ items: string[]; truncated: boolean }>> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const n = nameSchema.safeParse(name);
  if (!n.success) return bad(n.error.issues[0]?.message);
  try {
    return { ok: true, data: await daemonListOutsideAgentGrants(n.data) };
  } catch (err) {
    return shownDaemonFailure(err, "listOutsideAgentGrantsAction");
  }
}

/** Let one mission call an outside agent. */
export async function grantOutsideAgentAction(input: {
  name: string;
  missionId: string;
}): Promise<OutsideAgentActionResult> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const n = nameSchema.safeParse(input.name);
  if (!n.success) return bad(n.error.issues[0]?.message);
  const m = missionIdSchema.safeParse(input.missionId);
  if (!m.success) return bad(m.error.issues[0]?.message);
  try {
    await daemonGrantOutsideAgent(n.data, m.data);
    return { ok: true, data: null };
  } catch (err) {
    return shownDaemonFailure(err, "grantOutsideAgentAction");
  }
}

/** Remove the grant of one mission. */
export async function revokeOutsideAgentAction(input: {
  name: string;
  missionId: string;
}): Promise<OutsideAgentActionResult> {
  const session = await getServerSession();
  if (!session?.user) return UNAUTHENTICATED;
  const n = nameSchema.safeParse(input.name);
  if (!n.success) return bad(n.error.issues[0]?.message);
  const m = missionIdSchema.safeParse(input.missionId);
  if (!m.success) return bad(m.error.issues[0]?.message);
  try {
    await daemonRevokeOutsideAgent(n.data, m.data);
    return { ok: true, data: null };
  } catch (err) {
    return shownDaemonFailure(err, "revokeOutsideAgentAction");
  }
}
