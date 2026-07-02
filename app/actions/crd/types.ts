/**
 * Shared types for CRD Server Actions.
 *
 * Every action in `app/actions/crd/*.ts` returns `ActionResult<T>` and is
 * identified by a member of `CrdActionName`. The authorization gate in
 * `_authz.ts` and the audit emitter in `src/lib/audit/crd.ts` both key off
 * `CrdActionName` so permission-to-action and rate-limit-preset lookups are
 * exhaustive at the type level.
 */

export type CrdActionName =
  | "provisionTenantAction"
  | "deleteTenantAction"
  | "updateTenantAction"
  | "grantComponentAction"
  | "revokeGrantAction"
  | "inviteMemberAction"
  | "acceptInvitationAction"
  | "revokeMemberAction"
  | "resendInvitationAction"
  | "revokeUserSessionsAction"
  | "setComponentAccessAction"
  | "installAgentAction"
  | "listTeamsAction"
  | "listTeamMembersAction"
  | "createTeamAction"
  | "deleteTeamAction"
  | "addTeamMemberAction"
  | "removeTeamMemberAction"
  | "setTenantRoleAction"
  | "setTeamAdminAction"
  | "transferOwnershipAction";

export type ActionErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "BAD_INPUT"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "CONFLICT"
  | "NOT_FOUND";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: ActionErrorCode };

/**
 * A tenant member's role. Relocated here from the deleted `src/lib/k8s/types`
 * surface (dashboard#855 zero-kubeconfig capstone): the dashboard no longer
 * reads the TenantMember CR, so the role enum is a dashboard-side type, not a
 * mirror of a Kubernetes schema. Membership is owned by the daemon's
 * MembershipService (ADR-0043/0044); these are the role strings that service
 * returns.
 */
export type MemberRole = "owner" | "admin" | "member" | "viewer";

/**
 * A tenant plan tier. Re-exported from the generated plan registry, which
 * mirrors the operator's `plans.PlanID` Go enum.
 */
export type { PlanID as TenantTier } from "@/src/generated/plans";

