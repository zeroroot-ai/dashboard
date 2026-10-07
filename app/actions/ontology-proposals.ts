// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * Server actions for the ontology proposal page (dashboard#191, gibson#618,
 * ADR-0033 decision 3).
 *
 * Each action calls gibson.tenant.v1.OntologyExtensionService through the
 * user client. The list carries the "admin" relation on the tenant and the
 * decisions carry "owner", so the transport refuses a role below them before
 * dispatch, and the daemon checks the same relation again.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  daemonApproveOntologyProposal,
  daemonListOntologyProposals,
  daemonRejectOntologyProposal,
  daemonSubmitOntologyUpstream,
  type OntologyProposalDTO,
  type UpstreamContributionDTO,
} from "@/src/lib/gibson-client/ontology-proposals";
import { getServerSession } from "@/src/lib/auth";
import { permissionDeniedResult } from "@/src/lib/auth/assert-authorized";
import { serverActionError } from "@/src/lib/errors/server-action-error";

type OntologyActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

const targetSchema = z.object({
  kind: z.enum(["node_label", "relationship_type"]),
  label: z.string().min(1).max(4096),
});
const rejectSchema = targetSchema.extend({ reason: z.string().max(4096) });

const INVALID = { ok: false as const, error: "The proposal is not valid.", code: "invalid" };

/** Every proposal of the tenant, pending and decided. */
export async function listOntologyProposalsAction(): Promise<
  OntologyActionResult<OntologyProposalDTO[]>
> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  try {
    return { ok: true, data: await daemonListOntologyProposals() };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "listOntologyProposalsAction" });
  }
}

/** Approve one pending proposal. */
export async function approveOntologyProposalAction(input: {
  kind: string;
  label: string;
}): Promise<OntologyActionResult<null>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  try {
    await daemonApproveOntologyProposal(parsed.data.kind, parsed.data.label);
    return { ok: true, data: null };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "approveOntologyProposalAction" });
  }
}

/** Reject one pending proposal with a reason. */
export async function rejectOntologyProposalAction(input: {
  kind: string;
  label: string;
  reason: string;
}): Promise<OntologyActionResult<null>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  try {
    await daemonRejectOntologyProposal(
      parsed.data.kind,
      parsed.data.label,
      parsed.data.reason.trim(),
    );
    return { ok: true, data: null };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "rejectOntologyProposalAction" });
  }
}

/** Render one promoted proposal as an SDK contribution. */
export async function submitOntologyUpstreamAction(input: {
  kind: string;
  label: string;
}): Promise<OntologyActionResult<UpstreamContributionDTO>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  const parsed = targetSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  try {
    const data = await daemonSubmitOntologyUpstream(
      parsed.data.kind,
      parsed.data.label,
      randomUUID(),
    );
    return { ok: true, data };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "submitOntologyUpstreamAction" });
  }
}
