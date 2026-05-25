"use server";

/**
 * Ownership-transfer Server Action.
 *
 * Atomically reassigns the `owner` FGA relation from the current caller
 * to a target admin in a single WriteAccessTuples call. The outgoing owner
 * is downgraded to `admin` so they remain a member of the workspace.
 *
 * FGA tuple changes (all four in a single WriteAccessTuples RPC):
 *   add:    (user:newOwner,     owner, tenant:X)
 *           (user:currentOwner, admin, tenant:X)
 *   delete: (user:currentOwner, owner, tenant:X)
 *           (user:newOwner,     admin, tenant:X)
 *
 * Display-cache: both TenantMember CRs are patched for spec.role so the
 * users list badge stays consistent. Same best-effort pattern as
 * setTenantRoleAction — FGA is authoritative, the patch is cosmetic.
 *
 * TODO: replace the "members:invite" permission gate with a dedicated
 * "org:transfer_ownership" permission once it has been added to the RBAC
 * schema in core/gibson/internal/auth/permissions.yaml.
 *
 * Spec: dashboard#266.
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

/**
 * Transfer the `owner` FGA relation from the calling user to `newOwnerUserId`.
 *
 * Preconditions (enforced server-side, not delegated to the client):
 *   1. Caller holds "members:invite" permission (proxy for owner-only gate —
 *      TODO: add "org:transfer_ownership" to RBAC schema).
 *   2. `newOwnerUserId` is non-empty.
 *   3. Target is an Active admin (spec.role === "admin", status.phase === "Active").
 *   4. Target is NOT already an owner.
 *
 * @param newOwnerUserId - The userId of the TenantMember to become the new owner.
 */
export async function transferOwnershipAction(
  newOwnerUserId: string,
): Promise<ActionResult<{ applied: boolean }>> {
  // Early validate before hitting the auth gate so we don't waste a round-trip.
  if (!newOwnerUserId) {
    return { ok: false, error: "newOwnerUserId required", code: "BAD_INPUT" };
  }

  const gate = await requireCrdSession<{ applied: boolean }>({
    action: "transferOwnershipAction",
    // TODO: replace with "org:transfer_ownership" once the RBAC schema has it.
    permission: "members:invite",
    inputKeys: ["newOwnerUserId"],
  });
  if (!gate.ok) return gate.result;

  const callerUserId = gate.session.user.id;
  if (!callerUserId) {
    return { ok: false, error: "session missing userId", code: "FORBIDDEN" };
  }
  const callerTenantId = gate.session.user.tenantId;
  if (!callerTenantId) {
    return { ok: false, error: "session missing tenantId", code: "FORBIDDEN" };
  }

  // Prevent self-transfer (no-op that would silently drop the owner relation
  // from FGA if the swap logic ran against itself).
  if (newOwnerUserId === callerUserId) {
    return {
      ok: false,
      error: "Cannot transfer ownership to yourself.",
      code: "BAD_INPUT",
    };
  }

  // ── Validate target ────────────────────────────────────────────────────────
  let targetMemberName: string | undefined;
  let currentOwnerMemberName: string | undefined;

  try {
    const ns = tenantNamespace(callerTenantId);
    const members = await listTenantMembers(ns);

    const targetMember = members.find((m) => m.status?.userId === newOwnerUserId);
    if (!targetMember) {
      return {
        ok: false,
        error: "Target user not found in this workspace.",
        code: "BAD_INPUT",
      };
    }
    if (targetMember.spec.role === "owner") {
      return {
        ok: false,
        error: "Target user is already an owner.",
        code: "BAD_INPUT",
      };
    }
    if (
      targetMember.spec.role !== "admin" ||
      targetMember.status?.phase !== "Active"
    ) {
      return {
        ok: false,
        error: "Ownership can only be transferred to an Active admin.",
        code: "BAD_INPUT",
      };
    }

    targetMemberName = targetMember.metadata.name;

    const currentOwnerMember = members.find(
      (m) => m.status?.userId === callerUserId,
    );
    if (currentOwnerMember) {
      currentOwnerMemberName = currentOwnerMember.metadata.name;
    }
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }

  // ── 1. Authoritative FGA write ─────────────────────────────────────────────
  // All four tuple mutations in a single WriteAccessTuples call so the
  // transition is atomic from the FGA perspective.
  try {
    const client = serviceClient(DaemonOperatorService, callerTenantId);
    await client.writeAccessTuples({
      add: [
        {
          user: `user:${newOwnerUserId}`,
          relation: "owner",
          object: `tenant:${callerTenantId}`,
        },
        {
          user: `user:${callerUserId}`,
          relation: "admin",
          object: `tenant:${callerTenantId}`,
        },
      ],
      delete: [
        {
          user: `user:${callerUserId}`,
          relation: "owner",
          object: `tenant:${callerTenantId}`,
        },
        {
          user: `user:${newOwnerUserId}`,
          relation: "admin",
          object: `tenant:${callerTenantId}`,
        },
      ],
      reason: `dashboard: transfer ownership from ${callerUserId} to ${newOwnerUserId}`,
    });
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }

  // ── 2. Display-cache writes (best-effort) ──────────────────────────────────
  // FGA is already authoritative after the write above. These patches keep
  // the role badge consistent across reloads. Failures are swallowed with a
  // warn — same pattern as setTenantRoleAction (dashboard#173).
  const ns = tenantNamespace(callerTenantId);

  try {
    if (targetMemberName) {
      await patchTenantMember(ns, targetMemberName, {
        spec: { role: "owner" },
      });
    }
  } catch (err) {
    logger.warn(
      {
        userId: newOwnerUserId,
        tenantId: callerTenantId,
        memberName: targetMemberName,
        err: err instanceof Error ? err.message : String(err),
      },
      "[transferOwnershipAction] FGA write succeeded but new-owner TenantMember.spec.role patch failed; badge may show stale role on reload",
    );
  }

  try {
    if (currentOwnerMemberName) {
      await patchTenantMember(ns, currentOwnerMemberName, {
        spec: { role: "admin" },
      });
    } else {
      logger.warn(
        { userId: callerUserId, tenantId: callerTenantId },
        "[transferOwnershipAction] no TenantMember found for current owner userId; FGA write succeeded but spec.role not patched to admin",
      );
    }
  } catch (err) {
    logger.warn(
      {
        userId: callerUserId,
        tenantId: callerTenantId,
        memberName: currentOwnerMemberName,
        err: err instanceof Error ? err.message : String(err),
      },
      "[transferOwnershipAction] FGA write succeeded but outgoing-owner TenantMember.spec.role patch failed; badge may show stale role on reload",
    );
  }

  return { ok: true, data: { applied: true } };
}
