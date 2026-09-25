// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

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
 * setTenantRoleAction, FGA is authoritative, the patch is cosmetic.
 *
 * Owner-only (hosted#190 / ADR-0093 rule 5): `CRD_PERMISSIONS.transferOwnershipAction`
 * in `_authz.ts` requires the "owner" relation, so an Admin is refused by
 * `requireCrdSession` before this function does anything else. The daemon's
 * own MembershipService.TransferOwnership enforces the same rule; the gate
 * here is defense-in-depth, not the only line of defense.
 *
 * Spec: dashboard#266.
 */

import { ConnectError, Code } from "@connectrpc/connect";

import { MembershipService } from "@/src/gen/gibson/tenant/v1/membership_pb";
import { userClient } from "@/src/lib/gibson-client";
import { listMembersAction } from "@/app/actions/read/listMembers";
import {
  requireActiveTenant,
  NoActiveTenantError,
  StaleActiveTenantError,
} from "@/src/lib/auth/active-tenant";

import { requireCrdSession } from "./_authz";
import type { ActionResult } from "./types";

/** Map a daemon RPC error to the dashboard ActionResult error shape. A denial
 * is always reported with a fixed, user-facing message: the daemon's own
 * message can carry internal role/relation detail that should not reach the
 * client. */
function rpcError<T>(e: unknown): ActionResult<T> {
  if (e instanceof ConnectError && e.code === Code.PermissionDenied) {
    return {
      ok: false,
      error: "Only the current workspace owner can transfer ownership.",
      code: "FORBIDDEN",
    };
  }
  return { ok: false, error: e instanceof Error ? e.message : String(e), code: "INTERNAL" };
}

/**
 * Transfer the `owner` FGA relation from the calling user to `newOwnerUserId`.
 *
 * Preconditions (enforced server-side, not delegated to the client):
 *   1. Caller holds the "owner" relation on the active tenant
 *      (`CRD_PERMISSIONS.transferOwnershipAction`, hosted#190).
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
    inputKeys: ["newOwnerUserId"],
  });
  if (!gate.ok) return gate.result;

  const callerUserId = gate.session.user.id;
  if (!callerUserId) {
    return { ok: false, error: "session missing userId", code: "FORBIDDEN" };
  }
  let callerTenantId: string;
  try {
    callerTenantId = await requireActiveTenant();
  } catch (err) {
    if (err instanceof NoActiveTenantError || err instanceof StaleActiveTenantError) {
      return { ok: false, error: "No active tenant.", code: "FORBIDDEN" };
    }
    throw err;
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

  // ── Validate target against the daemon roster (dashboard#716) ───────────────
  // The daemon's TransferOwnership is authoritative + validates server-side;
  // this pre-check gives a clear UX error before the RPC. Reads ListMembers
  // (MemberRow), not the TenantMember CR.
  try {
    const roster = await listMembersAction();
    if (!roster.ok) {
      return { ok: false, error: roster.error, code: "INTERNAL" };
    }
    const targetMember = roster.data.find((m) => m.userId === newOwnerUserId);
    if (!targetMember) {
      return {
        ok: false,
        error: "Target user not found in this workspace.",
        code: "BAD_INPUT",
      };
    }
    if (targetMember.role === "owner") {
      return {
        ok: false,
        error: "Target user is already an owner.",
        code: "BAD_INPUT",
      };
    }
    if (targetMember.role !== "admin" || targetMember.status !== "active") {
      return {
        ok: false,
        error: "Ownership can only be transferred to an Active admin.",
        code: "BAD_INPUT",
      };
    }
  } catch (err) {
    return { ok: false, error: String(err), code: "INTERNAL" };
  }

  // ── Authoritative MembershipService write ──────────────────────────────────
  // TransferOwnership atomically swaps the owner tuple from the current owner
  // to new_owner_user_id, all four tuple mutations happen server-side in a
  // single atomic call. dashboard#716 removed the former TenantMember.spec.role
  // display-cache patches: ListMembers derives role from FGA, so a roster
  // refetch reflects the swap with no CR to keep in sync.
  try {
    const client = userClient(MembershipService);
    await client.transferOwnership({
      tenantId: callerTenantId,
      newOwnerUserId,
    });
  } catch (err) {
    return rpcError(err);
  }

  return { ok: true, data: { applied: true } };
}
