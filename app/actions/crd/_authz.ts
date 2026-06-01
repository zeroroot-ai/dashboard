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
import { hasPermission, isCrossTenant } from "@/src/lib/auth/schema";

import { emitCrdAudit } from "@/src/lib/audit/crd";

import { consumeRateLimit, type CrdRateLimitPreset } from "./_rate_limits";
import type { ActionErrorCode, ActionResult, CrdActionName } from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CrdAuthzParams {
  action: CrdActionName;
  permission: string;
  /** Tenant scope to enforce; omit for create-time actions like provision. */
  tenantName?: string;
  /**
   * When true, the session MUST be cross-tenant (platform-operator etc.).
   * Used for `provisionTenantAction` where no existing scope can authorize
   * the call.
   */
  requireCrossTenant?: boolean;
  rateLimit?: CrdRateLimitPreset;
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
      sessionTenantId: session?.user?.tenantId ?? null,
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
  // Fail closed if the permissions array was not populated (schema-cache
  // miss or partial-session fallback from auth.ts).
  if (!Array.isArray(session.user.permissions)) {
    return denial(
      "unauthenticated",
      "UNAUTHENTICATED",
      "Session incomplete.",
      session,
    );
  }

  // 2. Cross-tenant-only actions (e.g. provisionTenantAction)
  if (params.requireCrossTenant && !isCrossTenant(session)) {
    return denial("forbidden", "FORBIDDEN", "Not authorized.", session);
  }

  // 3. Permission
  if (!hasPermission(session, params.permission)) {
    return denial("forbidden", "FORBIDDEN", "Not authorized.", session);
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
  if (params.rateLimit) {
    const verdict = await consumeRateLimit(session.user.id, params.rateLimit);
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
      sessionTenantId: session?.user?.tenantId ?? null,
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
// Permission → action mapping (ground truth). Used by the coverage test
// to assert every CrdActionName has an entry and vice versa.
// ---------------------------------------------------------------------------

export const CRD_PERMISSIONS: Record<
  CrdActionName,
  { permission: string; requireCrossTenant?: boolean; rateLimit?: CrdRateLimitPreset }
> = {
  provisionTenantAction: {
    permission: "tenants:provision",
    requireCrossTenant: true,
    rateLimit: "provisionTenant",
  },
  deleteTenantAction: { permission: "tenants:delete" },
  updateTenantAction: { permission: "tenants:update" },
  grantComponentAction: { permission: "grants:create" },
  revokeGrantAction: { permission: "grants:delete" },
  inviteMemberAction: { permission: "members:invite", rateLimit: "inviteMember" },
  // acceptInvitationAction is NOT permission-gated — it uses the self-check
  // helper. Still listed so the coverage test finds it.
  acceptInvitationAction: { permission: "__self__" },
  revokeMemberAction: { permission: "members:revoke" },
  resendInvitationAction: { permission: "members:invite", rateLimit: "inviteMember" },
  createEnrollmentAction: { permission: "enrollments:create" },
  revokeEnrollmentAction: { permission: "enrollments:delete" },
  fetchBootstrapTokenAction: {
    permission: "enrollments:read_bootstrap",
    rateLimit: "fetchBootstrapToken",
  },
  setComponentAccessAction: { permission: "grants:create" },
  installAgentAction: { permission: "grants:create" },
  listTeamsAction: { permission: "members:invite" },
  listTeamMembersAction: { permission: "members:invite" },
  createTeamAction: { permission: "members:invite" },
  deleteTeamAction: { permission: "members:revoke" },
  addTeamMemberAction: { permission: "members:invite" },
  removeTeamMemberAction: { permission: "members:revoke" },
  setTenantRoleAction: { permission: "members:invite" },
  setTeamAdminAction: { permission: "members:invite" },
  // TODO: replace "members:invite" with a dedicated "org:transfer_ownership"
  // permission once it has been added to the RBAC schema (permissions.yaml).
  transferOwnershipAction: { permission: "members:invite" },
};
