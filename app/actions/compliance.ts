// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * Server actions for the compliance evidence page (dashboard#224, ADR-0113,
 * D56).
 *
 * Both actions call gibson.tenant.v1.ComplianceService through the user
 * client. The RPC carries the "admin" relation on the tenant, so the
 * transport refuses every role except Owner and Admin before dispatch, and
 * the daemon checks the same relation again.
 */

import "server-only";

import { z } from "zod";

import {
  daemonListComplianceEvidence,
  daemonListCompliancePacks,
  type ComplianceEvidenceDTO,
} from "@/src/lib/gibson-client/compliance";
import { getServerSession } from "@/src/lib/auth";
import { permissionDeniedResult } from "@/src/lib/auth/assert-authorized";
import { serverActionError } from "@/src/lib/errors/server-action-error";

type ComplianceActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

const evidenceInputSchema = z.object({
  pack: z.string().min(1).max(1024),
  start: z.string().datetime(),
  end: z.string().datetime(),
});

/** The enabled packs of the tenant that are compliance frameworks. */
export async function listCompliancePacksAction(): Promise<ComplianceActionResult<string[]>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  try {
    return { ok: true, data: await daemonListCompliancePacks() };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "listCompliancePacksAction" });
  }
}

/** The evidence of each control of one pack in one time range. */
export async function getComplianceEvidenceAction(input: {
  pack: string;
  start: string;
  end: string;
}): Promise<ComplianceActionResult<ComplianceEvidenceDTO>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  const parsed = evidenceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "The pack or the time range is not valid.", code: "invalid" };
  }
  try {
    const data = await daemonListComplianceEvidence({
      pack: parsed.data.pack,
      start: new Date(parsed.data.start),
      end: new Date(parsed.data.end),
    });
    return { ok: true, data };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "getComplianceEvidenceAction" });
  }
}
