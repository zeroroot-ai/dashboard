import "server-only";

/**
 * The single authorization gate every CRD Server Action passes through.
 *
 * Checks happen in order: session → permission → tenant-scope →
 * cross-tenant-only (where required) → rate-limit. Every denial branch
 * emits an audit event. Success returns the resolved session so the caller
 * can emit its own success/failure audit after the K8s call.
 */

import { getServerSession, type GibsonSession } from "@/src/lib/auth";
import {
  requireActiveTenant,
  NoActiveTenantError,
  StaleActiveTenantError,
} from "@/src/lib/auth/active-tenant";
import { isCrossTenant } from "@/src/lib/auth/schema";
import { satisfiesRelation } from "@/src/lib/auth/relation-hierarchy";

import { emitCrdAudit } from "@/src/lib/audit/crd";

import { consumeRateLimit, type CrdRateLimitPreset } from "./_rate_limits";
import type { ActionErrorCode, ActionResult, CrdActionName } from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CrdAuthzParams {
  action: CrdActionName;
  /** Tenant scope to enforce; omit for create-time actions like provision. */
  tenantName?: string;
  /**
   * Input keys (field names, never values) to record in any denial audit
   * event emitted by the gate. Callers pass their input keys so denial
   * events record what was attempted.
   */
  inputKeys?: string[];
}

export type CrdAuthzResult<T = void> =
  | {
      ok: true;
      session: GibsonSession;
      userId: string;
      tenantName: string | null;
    }
  | { ok: false; result: ActionResult<T> };

/**
 * Primary gate. Returns `{ok:true, session, userId, tenantName}` or
 * `{ok:false, result}` where `result` is the ActionResult to return
 * directly from the action.
 */
export async function requireCrdSession<T = void>(
  params: CrdAuthzParams,
): Promise<CrdAuthzResult<T>> {
  const denial = (
    outcome: "unauthenticated" | "forbidden" | "rate_limited",
    code: ActionErrorCode,
    error: string,
    session: GibsonSession | null,
  ): { ok: false; result: ActionResult<T> } => {
    emitCrdAudit({
      ts: new Date().toISOString(),
      action: params.action,
      outcome,
      userId: session?.user?.id ?? "anonymous",
      // Active tenant is not yet resolved on the denial path — record null.
      // session.user.tenantId was removed in dashboard#583 lock-in.
      sessionTenantId: null,
      targetTenant: params.tenantName ?? null,
      crossTenant: Boolean(session?.user?.crossTenant),
      inputKeys: params.inputKeys ?? [],
    });
    return { ok: false, result: { ok: false, code, error } };
  };

  // 1. Session
  let session: GibsonSession | null;
  try {
    session = await getServerSession();
  } catch {
    // getServerSession already catches internally; belt-and-braces.
    session = null;
  }
  if (!session || !session.user?.id) {
    return denial(
      "unauthenticated",
      "UNAUTHENTICATED",
      "You must be signed in.",
      session,
    );
  }

  // The required relation (and any cross-tenant / rate-limit policy) for this
  // action is declared once in CRD_PERMISSIONS — the single source of truth.
  // An action missing from the map fails closed.
  const policy = CRD_PERMISSIONS[params.action];
  if (!policy) {
    return denial("forbidden", "FORBIDDEN", "Not authorized.", session);
  }

  // 2. Cross-tenant-only actions (e.g. provisionTenantAction)
  if (policy.requireCrossTenant && !isCrossTenant(session)) {
    return denial("forbidden", "FORBIDDEN", "Not authorized.", session);
  }

  // 3. Relation — authorize on the caller's role for the cookie-confirmed
  //    active tenant (session.user.roles holds that single role) against the
  //    action's required relation. This is the server mirror of the client's
  //    useAuthorize(method) check: one authorization source (the FGA relation
  //    hierarchy), no static permission closure. Cross-tenant callers are
  //    already authorized by the requireCrossTenant check above.
  //    Cross-tenant callers (platform-operator) are authorized for any tenant
  //    and bypass the per-tenant relation check, exactly as before when they
  //    held the full admin permission set.
  if (!policy.requireCrossTenant && !isCrossTenant(session)) {
    const activeRole = session.user.roles?.[0] ?? "";
    if (!satisfiesRelation(activeRole, policy.relation)) {
      return denial("forbidden", "FORBIDDEN", "Not authorized.", session);
    }
  }

  // 4. Tenant-scope match — skipped when params.tenantName is omitted.
  //    Cross-tenant sessions bypass this check; the result is recorded in
  //    the success-path audit by the caller. The active tenant is resolved
  //    via requireActiveTenant() (HMAC-signed cookie) — not from the session
  //    JWT — so a revoked membership cannot smuggle a stale tenantId past
  //    this gate.
  if (params.tenantName && !isCrossTenant(session)) {
    let activeTenantId: string;
    try {
      activeTenantId = await requireActiveTenant();
    } catch (err) {
      if (err instanceof NoActiveTenantError || err instanceof StaleActiveTenantError) {
        return denial("forbidden", "FORBIDDEN", "No active tenant.", session);
      }
      throw err;
    }
    if (activeTenantId !== params.tenantName) {
      return denial("forbidden", "FORBIDDEN", "Not authorized.", session);
    }
  }

  // 5. Rate-limit
  if (policy.rateLimit) {
    const verdict = await consumeRateLimit(session.user.id, policy.rateLimit);
    if (!verdict.ok) {
      return denial(
        "rate_limited",
        "RATE_LIMITED",
        `Too many requests. Try again in ${verdict.retryAfter}s.`,
        session,
      );
    }
  }

  return {
    ok: true,
    session,
    userId: session.user.id,
    tenantName: params.tenantName ?? null,
  };
}

// ---------------------------------------------------------------------------
// Self-action variant — used only by acceptInvitationAction.
// ---------------------------------------------------------------------------

/**
 * Gate for self-actions (the caller must be the user being acted on).
 * No permission string, no tenant-scope — just identity equality.
 *
 * Used exclusively by `acceptInvitationAction`, which an invitee must be
 * able to call without holding any tenant permission first.
 */
export async function requireCrdSessionForSelfAction<T = void>(
  action: CrdActionName,
  expectedUserId: string,
  inputKeys: string[] = [],
): Promise<CrdAuthzResult<T>> {
  const denial = (
    outcome: "unauthenticated" | "forbidden",
    code: ActionErrorCode,
    error: string,
    session: GibsonSession | null,
  ): { ok: false; result: ActionResult<T> } => {
    emitCrdAudit({
      ts: new Date().toISOString(),
      action,
      outcome,
      userId: session?.user?.id ?? "anonymous",
      // Active tenant is not yet resolved on the denial path — record null.
      // session.user.tenantId was removed in dashboard#583 lock-in.
      sessionTenantId: null,
      targetTenant: null,
      crossTenant: Boolean(session?.user?.crossTenant),
      inputKeys,
    });
    return { ok: false, result: { ok: false, code, error } };
  };

  let session: GibsonSession | null;
  try {
    session = await getServerSession();
  } catch {
    session = null;
  }
  if (!session || !session.user?.id) {
    return denial(
      "unauthenticated",
      "UNAUTHENTICATED",
      "You must be signed in.",
      session,
    );
  }
  if (session.user.id !== expectedUserId) {
    return denial("forbidden", "FORBIDDEN", "Not authorized.", session);
  }
  return {
    ok: true,
    session,
    userId: session.user.id,
    tenantName: null,
  };
}

// ---------------------------------------------------------------------------
// Action → required FGA relation (single source of truth). requireCrdSession
// authorizes the caller's active-tenant role against `relation`; the coverage
// test asserts every CrdActionName has an entry and vice versa.
//
// Every CRD action is admin-scoped today (creating/removing members, teams,
// roles, grants, enrollments, and tenant lifecycle), so the required relation
// is "admin" — admin/owner satisfy it, plain members do not. Exceptions:
//   - provisionTenantAction: no existing tenant scope can authorize it; gated
//     on cross-tenant (platform-operator) instead of a relation.
//   - acceptInvitationAction: not relation-gated — it uses the self-action
//     helper (identity equality). The "__self__" sentinel is never evaluated
//     by requireCrdSession; the entry exists only for coverage.
// ---------------------------------------------------------------------------

export const CRD_PERMISSIONS: Record<
  CrdActionName,
  { relation: string; requireCrossTenant?: boolean; rateLimit?: CrdRateLimitPreset }
> = {
  provisionTenantAction: {
    relation: "admin",
    requireCrossTenant: true,
    rateLimit: "provisionTenant",
  },
  deleteTenantAction: { relation: "admin" },
  updateTenantAction: { relation: "admin" },
  grantComponentAction: { relation: "admin" },
  revokeGrantAction: { relation: "admin" },
  inviteMemberAction: { relation: "admin", rateLimit: "inviteMember" },
  acceptInvitationAction: { relation: "__self__" },
  revokeMemberAction: { relation: "admin" },
  resendInvitationAction: { relation: "admin", rateLimit: "inviteMember" },
  createEnrollmentAction: { relation: "admin" },
  revokeEnrollmentAction: { relation: "admin" },
  fetchBootstrapTokenAction: {
    relation: "admin",
    rateLimit: "fetchBootstrapToken",
  },
  setComponentAccessAction: { relation: "admin" },
  installAgentAction: { relation: "admin" },
  listTeamsAction: { relation: "admin" },
  listTeamMembersAction: { relation: "admin" },
  createTeamAction: { relation: "admin" },
  deleteTeamAction: { relation: "admin" },
  addTeamMemberAction: { relation: "admin" },
  removeTeamMemberAction: { relation: "admin" },
  setTenantRoleAction: { relation: "admin" },
  setTeamAdminAction: { relation: "admin" },
  transferOwnershipAction: { relation: "admin" },
};
