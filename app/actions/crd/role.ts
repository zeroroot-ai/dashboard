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

import { DaemonOperatorService } from "@/src/gen/gibson/daemon/operator/v1/operator_pb";
import { serviceClient } from "@/src/lib/gibson-client";
import { logger } from "@/src/lib/logger";
import { listTenantMembers, patchTenantMember } from "@/src/lib/k8s/tenants";

import { requireCrdSession } from "./_authz";
import type { ActionResult } from "./types";

function tenantNamespace(slug: string): string {
  return `tenant-${slug}`;
}

export type TenantRole = "admin" | "member";

/**
 * Flip a user's tenant-level role between admin and member.
 *
 * Two writes, in order:
 *   1. FGA WriteAccessTuples — the AUTHORITATIVE write. Adds the requested
 *      relation, deletes the inverse, atomically. If this fails the action
 *      returns the existing INTERNAL error path and the second write is
 *      skipped.
 *   2. patchTenantMember(spec.role) — a DISPLAY CACHE write so the users
 *      list role badge (which reads from spec.role via useCRDWatch) stays
 *      consistent across reloads. If this fails the action still returns
 *      ok — the FGA gate is authoritative for actual access — but emits a
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
    permission: "members:invite",
    inputKeys: ["userId", "role"],
  });
  if (!gate.ok) return gate.result;
  const callerTenantId = gate.session.user.tenantId;
  if (!callerTenantId) {
    return { ok: false, error: "session missing tenantId", code: "FORBIDDEN" };
  }
  const inverse: TenantRole = input.role === "admin" ? "member" : "admin";

  // 1. Authoritative FGA write. Fail here returns INTERNAL with no mutation.
  try {
    const client = serviceClient(DaemonOperatorService, callerTenantId);
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
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }

  // 2. Display-cache write on TenantMember.spec.role. FGA is already
  // authoritative; this keeps the badge fresh across reloads. Best-effort:
  // we look up the TenantMember by status.userId in the caller's tenant
  // namespace, patch spec.role. If the lookup fails or the patch fails,
  // log + continue. Some scenarios where the patch is legitimately a no-op:
  // (a) the user has never had a TenantMember CR (signed in via a path that
  // skipped invite), (b) the CR was deleted between FGA write + this patch.
  try {
    const ns = tenantNamespace(callerTenantId);
    const members = await listTenantMembers(ns);
    const target = members.find(
      (m) => m.status?.userId === input.userId,
    );
    if (target) {
      await patchTenantMember(ns, target.metadata.name, {
        spec: { role: input.role },
      });
    } else {
      logger.warn(
        { userId: input.userId, tenantId: callerTenantId },
        "[setTenantRoleAction] no TenantMember found for userId; FGA write succeeded but spec.role not updated",
      );
    }
  } catch (err) {
    logger.warn(
      {
        userId: input.userId,
        tenantId: callerTenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      "[setTenantRoleAction] FGA write succeeded but TenantMember.spec.role patch failed; badge may show stale role on reload",
    );
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
    const client = serviceClient(DaemonOperatorService, callerTenantId);
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
