/**
 * Discriminated union of login-error reasons + the user-facing copy table.
 *
 * Replaces ad-hoc string-based error matching across the auth path. Every
 * deterministic auth failure mode maps to one of these reasons; the
 * `/login/error?reason=<code>` page reads the value, runs `safeReason()`
 * to whitelist it (no XSS / no untrusted-input echo), and renders the
 * copy via `ERROR_COPY[reason]`. The `Record<LoginErrorReason, ...>`
 * shape forces TypeScript to keep the table exhaustive.
 *
 * Spec: auth-resolution-hardening (R2.3, R2.5).
 *
 * @module auth/error-codes
 */

export type LoginErrorReason =
  | "fga_unavailable"
  | "daemon_unavailable"
  | "jwks_unavailable"
  | "oidc_token_exchange_failed"
  | "session_invalid"
  | "permission_denied"
  | "membership_revoked"
  | "unknown";

interface LoginErrorCopy {
  /** Headline shown in the page title + Card title. */
  title: string;
  /** One-paragraph plain-English description of what happened. */
  description: string;
  /** Primary action the user should take. */
  cta: { label: string; href: string };
}

/**
 * Exhaustive copy table. New `LoginErrorReason` values force a
 * compile-time error here until copy is added.
 */
export const ERROR_COPY: Record<LoginErrorReason, LoginErrorCopy> = {
  fga_unavailable: {
    title: "Authorization service unavailable",
    description:
      "We couldn't reach the authorization service to load your organization memberships. This usually clears within a minute. Please retry.",
    cta: { label: "Retry sign-in", href: "/login" },
  },
  daemon_unavailable: {
    title: "Service unavailable",
    description:
      "We couldn't reach the Gibson daemon to complete your sign-in. Our on-call has been paged automatically. Please retry shortly.",
    cta: { label: "Retry sign-in", href: "/login" },
  },
  jwks_unavailable: {
    title: "Identity provider unavailable",
    description:
      "We couldn't reach our identity provider to validate your session. This is usually a transient network issue. Please retry.",
    cta: { label: "Retry sign-in", href: "/login" },
  },
  oidc_token_exchange_failed: {
    title: "Sign-in failed",
    description:
      "Your sign-in attempt couldn't be completed. If you reached this page after clicking a stale link, please start a fresh sign-in.",
    cta: { label: "Sign in", href: "/login" },
  },
  session_invalid: {
    title: "Your session is no longer valid",
    description:
      "Your session has expired or was revoked. Please sign in again.",
    cta: { label: "Sign in", href: "/login" },
  },
  permission_denied: {
    // ConnectRPC code 7 from the daemon path: the user's session validated
    // fine at the JWT layer, but ext-authz / FGA denied the specific RPC.
    // The CTA must NOT be "retry sign-in", retrying just repeats the
    // failing call. Sign-out-then-sign-in is the recovery path because
    // the user's group/role grants are loaded into the session at sign-in.
    title: "Your sign-in isn't authorized yet",
    description:
      "You signed in successfully, but you don't have access to this workspace. Sign out and sign back in to refresh your permissions, or contact your administrator if the problem persists.",
    cta: { label: "Sign out", href: "/api/auth/signout" },
  },
  membership_revoked: {
    title: "Your access was revoked",
    description:
      "Your access to the organization you were signed into was removed. If you belong to other organizations, you can switch to one of those; otherwise contact your administrator.",
    cta: { label: "Continue", href: "/select-tenant" },
  },
  unknown: {
    title: "Something went wrong",
    description:
      "An unexpected error interrupted your sign-in. The correlation ID below will help support track it down.",
    cta: { label: "Contact support", href: "mailto:support@zeroroot.ai" },
  },
};

const KNOWN: ReadonlySet<LoginErrorReason> = new Set([
  "fga_unavailable",
  "daemon_unavailable",
  "jwks_unavailable",
  "oidc_token_exchange_failed",
  "session_invalid",
  "permission_denied",
  "membership_revoked",
  "unknown",
]);

/**
 * Whitelist a raw `?reason=` query value. Anything not in the union
 * collapses to `"unknown"`. Never returns user-controlled input.
 */
export function safeReason(raw: string | null | undefined): LoginErrorReason {
  if (typeof raw !== "string") return "unknown";
  return KNOWN.has(raw as LoginErrorReason) ? (raw as LoginErrorReason) : "unknown";
}
