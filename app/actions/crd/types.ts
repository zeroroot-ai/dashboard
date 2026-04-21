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
  | "createEnrollmentAction"
  | "revokeEnrollmentAction"
  | "fetchBootstrapTokenAction"
  | "setComponentAccessAction"
  | "installAgentAction"
  | "listTeamsAction"
  | "createTeamAction"
  | "deleteTeamAction"
  | "addTeamMemberAction"
  | "removeTeamMemberAction";

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
 * Classify a K8sError (or any error with a `.name` property from
 * `src/lib/k8s/errors.ts`) into the closed `ActionErrorCode` union.
 * Unknown errors map to `INTERNAL`.
 */
export function classifyK8sError(err: { name?: string }): ActionErrorCode {
  switch (err?.name) {
    case "K8sNotFoundError":
      return "NOT_FOUND";
    case "K8sConflictError":
      return "CONFLICT";
    case "K8sForbiddenError":
      return "FORBIDDEN";
    case "K8sValidationError":
      return "BAD_INPUT";
    case "K8sUnavailableError":
    case "K8sError":
    default:
      return "INTERNAL";
  }
}

