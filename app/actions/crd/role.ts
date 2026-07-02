"use server";

/**
 * Role / admin-relation mutator Server Actions.
 *
 * These two actions exist because the existing patchTenantMember actions in
 * member.ts handle invitation status only (acceptedByUserId,
 * resendRequestedAt), not role. They are FGA-tuple writes that flip the
 * relevant relation atomically, same pattern as teams.ts for membership
 * tuples.
 *
 *   setTenantRoleAction   , flips a user's tenant-level role between
 *                            tenant_admin and tenant_member by writing the
 *                            (user:X, admin|member, tenant:Y) tuple and
 *                            deleting the inverse in a single WriteAccessTuples
 *                            call. Used by dashboard#150 (S6) inline role
 *                            dropdown.
 *
 *   setTeamAdminAction    , toggles only the `admin` relation on a team
 *                            without touching the `member` relation. The
 *                            proper fix for the TeamDetailContent.onToggleAdmin
 *                            remove+re-add dance noted in dashboard#148.
 *                            Used by dashboard#151 (S7) per-team admin toggle.
 *
 * Spec: dashboard#168.
 */

import { MembershipService } from "@/src/gen/gibson/tenant/v1/membership_pb";
import { userClient } from "@/src/lib/gibson-client";
import {
  requireActiveTenant,
  NoActiveTenantError,
  StaleActiveTenantError,
} from "@/src/lib/auth/active-tenant";

import { requireCrdSession } from "./_authz";
import type { ActionResult } from "./types";

export type TenantRole = "admin" | "member";

/**
 * Flip a user's tenant-level role between admin and member.
 *
 * Two writes, in order:
 *   1. FGA WriteAccessTuples, the AUTHORITATIVE write. Adds the requested
 *      relation, deletes the inverse, atomically. If this fails the action
 *      returns the existing INTERNAL error path and the second write is
 *      skipped.
 *   2. patchTenantMember(spec.role), a DISPLAY CACHE write so the users
 *      list role badge (which reads from spec.role via useCRDWatch) stays
 *      consistent across reloads. If this fails the action still returns
 *      ok, the FGA gate is authoritative for actual access, but emits a
 *      logger.warn so an operator can diagnose. The badge will briefly
 *      show the stale role on the next hard-reload until either a
 *      tenant-operator reconcile or the next role change repairs it.
 *
 * dashboard#173 documents the dual-write decision and the rationale for
 * choosing this over an operator-side reconcile.
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
    inputKeys: ["userId", "role"],
  });
  if (!gate.ok) return gate.result;
  let callerTenantId: string;
  try {
    callerTenantId = await requireActiveTenant();
  } catch (err) {
    if (err instanceof NoActiveTenantError || err instanceof StaleActiveTenantError) {
      return { ok: false, error: "No active tenant.", code: "FORBIDDEN" };
    }
    throw err;
  }
  // Authoritative MembershipService write (FGA tuples). dashboard#715 removed
  // the former TenantMember.spec.role display-cache patch, the daemon's
  // ListMembers derives role from FGA, so a roster refetch reflects the change
  // with no CR to keep in sync.
  try {
    const client = userClient(MembershipService);
    await client.setTenantRole({
      tenantId: callerTenantId,
      userId: input.userId,
      role: input.role,
      remove: false,
    });
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }

  return { ok: true, data: { applied: true } };
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
    inputKeys: ["teamId", "userId", "isAdmin"],
  });
  if (!gate.ok) return gate.result;
  let callerTenantId: string;
  try {
    callerTenantId = await requireActiveTenant();
  } catch (err) {
    if (err instanceof NoActiveTenantError || err instanceof StaleActiveTenantError) {
      return { ok: false, error: "No active tenant.", code: "FORBIDDEN" };
    }
    throw err;
  }
  try {
    const client = userClient(MembershipService);
    await client.setTeamAdmin({
      tenantId: callerTenantId,
      teamId: input.teamId,
      userId: input.userId,
      isAdmin: input.isAdmin,
    });
    return { ok: true, data: { applied: true } };
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }
}
