// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * MFA-reset Server Action (hosted#206).
 *
 * resetUserMfaAction recovers a tenant member locked out of a lost
 * authenticator device: it revokes the target's active sessions, clears
 * every second factor and passkey on file for them, and emails the target
 * their own sign-in link via gibson.tenant.v1.UserService.ResetUserMFA.
 *
 * Unlike revokeUserSessionsAction, this is NOT self-service: the
 * requireCrdSession gate below is relation "admin", matching the daemon's
 * own coarse ext-authz gate on ResetUserMFA. An Owner or Admin may reset
 * any member's MFA in their tenant, including the Owner's own (owner
 * implies admin) — see model.fga. The caller receives nothing back that
 * grants access to the reset account; the notice email goes only to the
 * target's own address.
 */

import { UserService } from "@/src/gen/gibson/tenant/v1/user_pb";
import { userClient } from "@/src/lib/gibson-client";
import {
  requireActiveTenant,
  NoActiveTenantError,
  StaleActiveTenantError,
} from "@/src/lib/auth/active-tenant";

import { requireCrdSession } from "./_authz";
import type { ActionResult } from "./types";

export interface ResetUserMfaResult {
  sessionsTerminated: number;
  otpCleared: boolean;
  u2fCleared: number;
  passkeysCleared: number;
  notified: boolean;
}

export async function resetUserMfaAction(input: {
  targetUserId: string;
}): Promise<ActionResult<ResetUserMfaResult>> {
  if (!input?.targetUserId) {
    return { ok: false, error: "targetUserId required", code: "BAD_INPUT" };
  }
  const gate = await requireCrdSession<ResetUserMfaResult>({
    action: "resetUserMfaAction",
    inputKeys: ["targetUserId"],
  });
  if (!gate.ok) return gate.result;

  // requireActiveTenant confirms the caller has a current tenant; ext-authz
  // itself derives the tenant from the caller's token (ADR-0093 decision 4),
  // never from a header this action sets.
  try {
    await requireActiveTenant();
  } catch (err) {
    if (err instanceof NoActiveTenantError || err instanceof StaleActiveTenantError) {
      return { ok: false, error: "No active tenant.", code: "FORBIDDEN" };
    }
    throw err;
  }

  try {
    const client = userClient(UserService);
    const res = await client.resetUserMFA({ targetUserId: input.targetUserId });
    return {
      ok: true,
      data: {
        sessionsTerminated: res.sessionsTerminated,
        otpCleared: res.otpCleared,
        u2fCleared: res.u2fCleared,
        passkeysCleared: res.passkeysCleared,
        notified: res.notified,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }
}
