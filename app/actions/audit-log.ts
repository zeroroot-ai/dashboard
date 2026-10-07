// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * Server action for the audit log page (lane 11 row G23).
 *
 * It calls gibson.tenant.v1.TenantService.ListAuditEvents through the user
 * client. The RPC carries the "admin" relation on the tenant, so the
 * transport refuses every role except Owner and Admin before dispatch, and
 * the daemon checks the same relation again.
 */

import "server-only";

import { z } from "zod";

import { daemonListAuditRecords, type AuditPageDTO } from "@/src/lib/gibson-client/audit-log";
import { getServerSession } from "@/src/lib/auth";
import { permissionDeniedResult } from "@/src/lib/auth/assert-authorized";
import { serverActionError } from "@/src/lib/errors/server-action-error";

type AuditActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

const cursorSchema = z.string().max(4096);

/** One page of the audit log. An empty cursor reads the first page. */
export async function listAuditRecordsAction(
  cursor: string,
): Promise<AuditActionResult<AuditPageDTO>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  const parsed = cursorSchema.safeParse(cursor);
  if (!parsed.success) {
    return { ok: false, error: "The page is not valid.", code: "invalid" };
  }
  try {
    return { ok: true, data: await daemonListAuditRecords(parsed.data) };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "listAuditRecordsAction" });
  }
}
