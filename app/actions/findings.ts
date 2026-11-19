// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * Server Actions for the finding pages (gibson#1365).
 *
 * getFindingAction reads one finding with all its evidence. The list of
 * findings holds no evidence. exportFindingsAction calls ExportFindings and
 * passes include_evidence when the person asks for it. Both calls go through
 * the user-acting transport, which runs the registry check ("member" relation)
 * before it sends the call.
 */

import "server-only";

import { Code, ConnectError } from "@connectrpc/connect";
import { z } from "zod";

import { daemonExportFindings, daemonGetFinding } from "@/src/lib/gibson-client/findings";
import type {
  FindingDetailDTO,
  FindingsExportDTO,
} from "@/src/lib/gibson-client/finding-types";
import { getServerSession } from "@/src/lib/auth";
import { permissionDeniedResult } from "@/src/lib/auth/assert-authorized";
import { serverActionError } from "@/src/lib/errors/server-action-error";

type FindingActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const findingIdSchema = z.string().trim().regex(UUID, "The finding id is not valid.");

const exportSchema = z.object({
  format: z.enum(["json", "csv", "sarif"]),
  findingIds: z.array(findingIdSchema).min(1, "Choose at least one finding.").max(5000),
  includeEvidence: z.boolean(),
});

/** Read one finding with all its evidence, in the stored order. */
export async function getFindingAction(
  findingId: string,
): Promise<FindingActionResult<FindingDetailDTO>> {
  const session = await getServerSession();
  if (!session?.user) return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  const id = findingIdSchema.safeParse(findingId);
  if (!id.success) {
    return { ok: false, error: id.error.issues[0]?.message ?? "Invalid input", code: "bad_input" };
  }
  try {
    const finding = await daemonGetFinding(id.data);
    if (!finding) return { ok: false, error: "The finding was not found.", code: "not_found" };
    return { ok: true, data: finding };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    if (err instanceof ConnectError && err.code === Code.NotFound) {
      return { ok: false, error: "The finding was not found.", code: "not_found" };
    }
    return serverActionError(err, { action: "getFindingAction" });
  }
}

/** Export findings as a file. includeEvidence adds all evidence of each finding. */
export async function exportFindingsAction(input: {
  format: string;
  findingIds: string[];
  includeEvidence: boolean;
}): Promise<FindingActionResult<FindingsExportDTO>> {
  const session = await getServerSession();
  if (!session?.user) return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  const parsed = exportSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      code: "bad_input",
    };
  }
  try {
    return { ok: true, data: await daemonExportFindings(parsed.data) };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "exportFindingsAction" });
  }
}
