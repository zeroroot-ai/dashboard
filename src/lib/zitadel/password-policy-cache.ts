/**
 * Default password policy for the client-side signup strength meter.
 *
 * The meter is ADVISORY ONLY. The authoritative Zitadel password-complexity
 * policy is enforced DAEMON-SIDE at user-create time (via the
 * `gibson.tenant.v1.SignupService.Signup` RPC, gibson#812). The dashboard no
 * longer fetches the live policy — that required a privileged Zitadel
 * signup-bot PAT, retired in E9 (dashboard#812). So this module exposes only
 * the static default the strength meter renders with; there is no live fetch
 * and no security regression (the daemon rejects a non-compliant password and
 * the signup action maps that to a POLICY_VIOLATION).
 *
 * No external dependencies. No network calls. Safe to import from client
 * components (the strength meter is client-side) — it carries no secrets and
 * no `server-only` guard.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape of a Zitadel password-complexity policy as consumed by the client-side
 * strength meter and the signup action's advisory pre-check.
 */
export interface PasswordPolicy {
  minLength: number;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSymbol: boolean;
}

// ---------------------------------------------------------------------------
// Default policy
// ---------------------------------------------------------------------------

/**
 * Baseline policy the signup strength meter seeds with. Reflects a sensible
 * default; the daemon's create-time check is authoritative.
 */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = Object.freeze({
  minLength: 12,
  hasUppercase: true,
  hasLowercase: true,
  hasNumber: true,
  hasSymbol: false,
});
