"use server";

/**
 * Session-revocation Server Action (dashboard#717).
 *
 * revokeUserSessionsAction terminates a target user's IdP sessions and revokes
 * their refresh-token grants via gibson.tenant.v1.UserService.RevokeUserSessions
 * (gibson#622). It is the dashboard surface behind the "Revoke sessions" admin
 * control and the self "Sign out everywhere" action.
 *
 * Authorization is two-layered (matching the daemon, gibson#622):
 *   1. requireCrdSession gate (relation "member"), any authenticated tenant
 *      member may call; this is what lets a plain member revoke THEIR OWN
 *      sessions.
 *   2. The daemon enforces the fine-grained can_revoke_sessions decision
 *      (self OR team-admin-over-target OR tenant-admin). A member with no admin
 *      relation over a *different* target is rejected by the daemon with
 *      PermissionDenied. The UI additionally hides the "revoke others" control
 *      behind the admin gate so non-admins never see it for other users.
 *
 * v1 revocation model: blocks NEW tokens immediately; the target's current
 * access token ages out within the access-token TTL (≤15m).
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

export async function revokeUserSessionsAction(input: {
  targetUserId: string;
}): Promise<ActionResult<{ sessionsTerminated: number; grantsRevoked: number }>> {
  if (!input?.targetUserId) {
    return { ok: false, error: "targetUserId required", code: "BAD_INPUT" };
  }
  const gate = await requireCrdSession<{
    sessionsTerminated: number;
    grantsRevoked: number;
  }>({
    action: "revokeUserSessionsAction",
    inputKeys: ["targetUserId"],
  });
  if (!gate.ok) return gate.result;

  // requireActiveTenant supplies the x-gibson-tenant header the coarse
  // ext-authz gate needs; the daemon resolves the caller from the JWT.
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
    const res = await client.revokeUserSessions({ targetUserId: input.targetUserId });
    return {
      ok: true,
      data: {
        sessionsTerminated: res.sessionsTerminated,
        grantsRevoked: res.grantsRevoked,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }
}
