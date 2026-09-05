/**
 * Maps `MembershipResolutionReason` (the wire-level classification produced
 * by `fetchMembershipsFromDaemon`) to `LoginErrorReason` (the user-facing
 * `/login/error?reason=...` URL parameter).
 *
 * The two type families are intentionally distinct. The first describes WHAT
 * happened at the daemon-call boundary; the second describes WHICH error-page
 * copy + CTA to render. Lumping them together is what caused dashboard#45 -
 * `permission_denied` was silently coerced to `daemon_unavailable`, surfacing
 * "Service unavailable / on-call has been paged" to users whose actual
 * problem was a missing FGA grant. No on-call action would have helped.
 *
 * @module auth/login-error-mapping
 */

import type { LoginErrorReason } from "./error-codes";
import type { MembershipResolutionReason } from "./membership";

export function membershipReasonToLoginErrorReason(
  reason: MembershipResolutionReason,
): LoginErrorReason {
  switch (reason) {
    case "unauthenticated":
      // Session invalid at the JWT layer, sign in again is the recovery.
      return "session_invalid";
    case "permission_denied":
      // Session valid; FGA / ext-authz denied this RPC. Sign-out CTA.
      return "permission_denied";
    case "daemon_unavailable":
      return "daemon_unavailable";
    case "fga_unavailable":
      return "fga_unavailable";
    case "malformed_response":
    case "unknown":
      return "unknown";
  }
}
