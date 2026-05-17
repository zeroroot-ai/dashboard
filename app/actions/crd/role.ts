"use server";

/**
 * Role / admin-relation mutator Server Actions.
 *
 * These two actions exist because the existing patchTenantMember actions in
 * member.ts handle invitation status only (acceptedByUserId,
 * resendRequestedAt), not role. They are FGA-tuple writes that flip the
 * relevant relation atomically — same pattern as teams.ts for membership
 * tuples.
 *
 *   setTenantRoleAction    — flips a user's tenant-level role between
 *                            tenant_admin and tenant_member by writing the
 *                            (user:X, admin|member, tenant:Y) tuple and
 *                            deleting the inverse in a single WriteAccessTuples
 *                            call. Used by dashboard#150 (S6) inline role
 *                            dropdown.
 *
 *   setTeamAdminAction     — toggles only the `admin` relation on a team
 *                            without touching the `member` relation. The
 *                            proper fix for the TeamDetailContent.onToggleAdmin
 *                            remove+re-add dance noted in dashboard#148.
 *                            Used by dashboard#151 (S7) per-team admin toggle.
 *
 * Spec: dashboard#168.
 */

import { PlatformOperatorService } from "@/src/gen/gibson/platform/v1/platform_operator_pb";
import { serviceClient } from "@/src/lib/gibson-client";

import { requireCrdSession } from "./_authz";
import type { ActionResult } from "./types";

export type { ActionResult };

export type TenantRole = "admin" | "member";

/**
 * Flip a user's tenant-level role between admin and member.
 *
 * The write is atomic: the inverse relation is deleted and the requested one
 * is written in a single WriteAccessTuples call, so the user is never
 * momentarily without a tenant role. Idempotent — re-writing the user's
 * current role is a no-op at the FGA level (FGA treats `add` of an existing
 * tuple as a no-op).
 */
export async function setTenantRoleAction(input: {
  userId: string;
  role: TenantRole;
}): Promise<ActionResult<{ applied: boolean }>> {
  if (!input.userId) {
    return { ok: false, error: "userId required", code: "BAD_INPUT" };
  }
  if (input.role !== "admin" && input.role !== "member") {
    return { ok: false, error: "role must be 'admin' or 'member'", code: "BAD_INPUT" };
  }
  const gate = await requireCrdSession<{ applied: boolean }>({
    action: "setTenantRoleAction",
    permission: "members:invite",
    inputKeys: ["userId", "role"],
  });
  if (!gate.ok) return gate.result;
  const callerTenantId = gate.session.user.tenantId;
  if (!callerTenantId) {
    return { ok: false, error: "session missing tenantId", code: "FORBIDDEN" };
  }
  const inverse: TenantRole = input.role === "admin" ? "member" : "admin";
  try {
    const client = serviceClient(PlatformOperatorService, callerTenantId);
    await client.writeAccessTuples({
      add: [
        {
          user: `user:${input.userId}`,
          relation: input.role,
          object: `tenant:${callerTenantId}`,
        },
      ],
      delete: [
        {
          user: `user:${input.userId}`,
          relation: inverse,
          object: `tenant:${callerTenantId}`,
        },
      ],
      reason: `dashboard: set ${input.userId} tenant role to ${input.role}`,
    });
    return { ok: true, data: { applied: true } };
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }
}

/**
 * Toggle a user's admin status on a team without touching their member
 * relation.
 *
 *   isAdmin=true  → adds (user:X, admin, team:Y); does NOT add `member` (the
 *                   caller is expected to also call addTeamMemberAction if
 *                   the user isn't already a member, but in practice the
 *                   FGA model derives `member` from `admin`, so admins
 *                   automatically count as members).
 *   isAdmin=false → deletes (user:X, admin, team:Y); leaves `member` intact
 *                   so the user stays on the roster as a plain member.
 *
 * Replaces the remove + re-add dance in TeamDetailContent.onToggleAdmin
 * which briefly dropped the user from the visible roster.
 */
export async function setTeamAdminAction(input: {
  teamId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<ActionResult<{ applied: boolean }>> {
  if (!input.teamId || !input.userId) {
    return { ok: false, error: "teamId + userId required", code: "BAD_INPUT" };
  }
  const gate = await requireCrdSession<{ applied: boolean }>({
    action: "setTeamAdminAction",
    permission: "members:invite",
    inputKeys: ["teamId", "userId", "isAdmin"],
  });
  if (!gate.ok) return gate.result;
  const callerTenantId = gate.session.user.tenantId;
  if (!callerTenantId) {
    return { ok: false, error: "session missing tenantId", code: "FORBIDDEN" };
  }
  const adminTuple = {
    user: `user:${input.userId}`,
    relation: "admin",
    object: `team:${input.teamId}`,
  };
  try {
    const client = serviceClient(PlatformOperatorService, callerTenantId);
    await client.writeAccessTuples({
      add: input.isAdmin ? [adminTuple] : [],
      delete: input.isAdmin ? [] : [adminTuple],
      reason: `dashboard: ${input.isAdmin ? "promote" : "demote"} ${input.userId} on team ${input.teamId}`,
    });
    return { ok: true, data: { applied: true } };
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }
}
