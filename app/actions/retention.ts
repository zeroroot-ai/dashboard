// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * Server actions for the retention period of the tenant (gibson#676,
 * gibson#992). One period covers the audit log and the Timeline history.
 * Both RPCs carry the "admin" relation on the tenant, so the transport
 * refuses every role except Owner and Admin before dispatch, and the daemon
 * checks the same relation again. The daemon refuses a period shorter than
 * the period of the install.
 */

import "server-only";

import { z } from "zod";

import {
  daemonGetRetention,
  daemonSetRetention,
  type RetentionDTO,
} from "@/src/lib/gibson-client/retention";
import { getServerSession } from "@/src/lib/auth";
import { permissionDeniedResult } from "@/src/lib/auth/assert-authorized";
import { serverActionError } from "@/src/lib/errors/server-action-error";

type RetentionActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

const setInputSchema = z.object({
  months: z.number().int().min(0).max(1200),
});

/** The retention periods of the tenant. */
export async function getRetentionAction(): Promise<RetentionActionResult<RetentionDTO>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  try {
    return { ok: true, data: await daemonGetRetention() };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "getRetentionAction" });
  }
}

/** Set the retention period of the tenant. 0 returns to the period of the install. */
export async function setRetentionAction(input: {
  months: number;
}): Promise<RetentionActionResult<RetentionDTO>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  const parsed = setInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "The period is not a number of months.", code: "bad_input" };
  }
  try {
    return { ok: true, data: await daemonSetRetention(parsed.data.months) };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "setRetentionAction" });
  }
}
