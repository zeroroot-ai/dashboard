// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * Server actions for the registration queue (dashboard#193, gibson#620,
 * ADR-0074).
 *
 * Each action calls gibson.tenant.v1.AdminTenantService through the user
 * client. The RPCs carry the "platform_owner" relation on the system tenant.
 * The dashboard does not hold that relation, so ext-authz decides it, and a
 * caller without it gets a permission denial.
 */

import "server-only";

import { z } from "zod";
import { ConnectError, Code } from "@connectrpc/connect";

import {
  daemonApproveRegistration,
  daemonListPendingRegistrations,
  daemonRejectRegistration,
  type ApprovedRegistrationDTO,
  type PendingRegistrationDTO,
} from "@/src/lib/gibson-client/registrations";
import { getServerSession } from "@/src/lib/auth";
import { permissionDeniedResult } from "@/src/lib/auth/assert-authorized";
import { serverActionError } from "@/src/lib/errors/server-action-error";
import { REGISTRATIONS_TEXT } from "@/components/gibson/registrations/texts";

type RegistrationActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

const idSchema = z.string().min(1).max(1024);
const rejectSchema = z.object({
  registrationId: idSchema,
  reason: z.string().max(4096),
});

/** A decision on a registration that is no longer pending. */
function alreadyDecided(err: unknown): RegistrationActionResult<never> | null {
  if (err instanceof ConnectError && err.code === Code.FailedPrecondition) {
    return { ok: false, error: REGISTRATIONS_TEXT.alreadyDecided, code: "already_decided" };
  }
  return null;
}

/** The registrations that wait for a decision, oldest first. */
export async function listPendingRegistrationsAction(): Promise<
  RegistrationActionResult<PendingRegistrationDTO[]>
> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  try {
    return { ok: true, data: await daemonListPendingRegistrations() };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "listPendingRegistrationsAction" });
  }
}

/** Approve one registration. */
export async function approveRegistrationAction(
  registrationId: string,
): Promise<RegistrationActionResult<ApprovedRegistrationDTO>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  const parsed = idSchema.safeParse(registrationId);
  if (!parsed.success) {
    return { ok: false, error: "The registration is not valid.", code: "invalid" };
  }
  try {
    return { ok: true, data: await daemonApproveRegistration(parsed.data) };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    const decided = alreadyDecided(err);
    if (decided) return decided;
    return serverActionError(err, { action: "approveRegistrationAction" });
  }
}

/** Reject one registration. The reason goes to the audit event only. */
export async function rejectRegistrationAction(input: {
  registrationId: string;
  reason: string;
}): Promise<RegistrationActionResult<null>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "The registration or the reason is not valid.", code: "invalid" };
  }
  try {
    await daemonRejectRegistration(parsed.data.registrationId, parsed.data.reason.trim());
    return { ok: true, data: null };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    const decided = alreadyDecided(err);
    if (decided) return decided;
    return serverActionError(err, { action: "rejectRegistrationAction" });
  }
}
