// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * @server-action-authz-exempt: pre-authentication. Registration runs before
 * any session or tenant exists. The daemon rate-limits Register and refuses
 * it on every rung except the approval rung.
 *
 * registerAction, the registration of the APPROVAL rung (ADR-0074,
 * dashboard#267).
 *
 * On this rung the daemon refuses the open-rung verification RPCs and serves
 * SignupService.Register. One call sends the whole form. The daemon stores a
 * pending registration and a deactivated identity user, and an administrator
 * approves it in the registration queue (dashboard#193). No tenant exists
 * until then, so there is nothing to poll.
 */

import "server-only";

import { randomUUID } from "node:crypto";

import { ConnectError, Code } from "@connectrpc/connect";

import {
  registerInputSchema,
  type RegisterActionResult,
  type RegisterInput,
} from "@/app/(public)/signup/types";
import { REGISTER_TEXT } from "@/app/(public)/signup/register-texts";
import { getDeploymentProfile } from "@/src/lib/deployment-profile";
import { assertPasswordNotBreached } from "@/src/lib/auth/breached-password-gate";
import { registerForApproval } from "@/src/lib/signup/owner-provisioning";
import { logger } from "@/src/lib/logger";

export async function registerAction(rawInput: RegisterInput): Promise<RegisterActionResult> {
  // The page renders the form only on the approval rung. The check here keeps
  // a stale page from calling the RPC on another rung.
  if (getDeploymentProfile().signupRung !== "approval") {
    return { ok: false, userMessage: REGISTER_TEXT.closed };
  }

  const parsed = registerInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<keyof RegisterInput, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !(field in fieldErrors)) {
        fieldErrors[field as keyof RegisterInput] = issue.message;
      }
    }
    return { ok: false, userMessage: REGISTER_TEXT.invalid, fieldErrors };
  }
  const input = parsed.data;
  const email = input.email.trim().toLowerCase();

  // Fail-open on an unreachable breach service: see assertPasswordNotBreached.
  const breach = await assertPasswordNotBreached(input.password, "signup", email);
  if (!breach.allowed) {
    return {
      ok: false,
      userMessage: REGISTER_TEXT.breached,
      fieldErrors: { password: REGISTER_TEXT.breached },
    };
  }

  try {
    await registerForApproval({
      attemptId: randomUUID(),
      ownerEmail: email,
      workspaceName: input.workspaceName.trim(),
      tier: input.tier,
      ownerFirstName: input.firstName.trim(),
      ownerLastName: input.lastName.trim(),
      password: input.password,
    });
    return { ok: true };
  } catch (err) {
    return mapRegisterError(err);
  }
}

/**
 * mapRegisterError turns a Register failure into a user-safe result. The
 * daemon answers AlreadyExists only when the address has an account. On this
 * rung an administrator reads every registration, so the form says so.
 */
function mapRegisterError(err: unknown): RegisterActionResult {
  const code = err instanceof ConnectError ? err.code : undefined;
  switch (code) {
    case Code.AlreadyExists:
      return {
        ok: false,
        userMessage: REGISTER_TEXT.accountExists,
        fieldErrors: { email: REGISTER_TEXT.accountExists },
      };
    case Code.ResourceExhausted:
      return { ok: false, userMessage: REGISTER_TEXT.rateLimited };
    case Code.InvalidArgument:
      return { ok: false, userMessage: REGISTER_TEXT.invalid };
    case Code.PermissionDenied:
      return { ok: false, userMessage: REGISTER_TEXT.closed };
    default:
      logger.error({ err, action: "registerAction" }, "register RPC failed");
      return { ok: false, userMessage: REGISTER_TEXT.unavailable };
  }
}
