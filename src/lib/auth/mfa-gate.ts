// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Defense-in-depth MFA gate for the `signIn` callback (hosted#193 decision
 * D3, part of the ADR-0093 identity epic).
 *
 * Zitadel's login app is supposed to force a second factor before it ever
 * issues a session (a sibling change, not this one). This gate makes the
 * dashboard independently refuse to establish its OWN session for a token
 * whose `amr` claim shows no MFA factor, so a login-app regression fails
 * closed here too.
 *
 * Zitadel sets `amr` from the session's methods:
 *   - `["pwd","otp","mfa"]` for a password plus a TOTP code.
 *   - `["user","mfa"]` for a passkey (counts as two factors on its own).
 *   - `["pwd"]` alone for a password with no second factor — REFUSED.
 *   - missing entirely — REFUSED.
 *
 * Pure function, no env or session reads, so it is exhaustively unit
 * testable the same way `resolvePostSignInRedirect` is.
 *
 * @module auth/mfa-gate
 */

/** The `amr` value must include this entry for a sign-in to be accepted. */
const MFA_AMR_ENTRY = "mfa";

/**
 * Returns `true` when `amr` (the ID token's Authentication Methods
 * Reference claim, forwarded on the OIDC `profile`) shows a completed MFA
 * step, `false` otherwise (missing, not an array, or lacking the `"mfa"`
 * entry).
 */
export function amrShowsMfa(amr: unknown): boolean {
  return Array.isArray(amr) && amr.includes(MFA_AMR_ENTRY);
}

/**
 * Decides whether a sign-in from `providerId` with the given `amr` claim
 * should be accepted.
 *
 * Only gates the `"zitadel"` provider: this check is meaningless for any
 * other provider id this app might one day register, and returning `true`
 * for those keeps the gate scoped to what it actually verifies.
 *
 * @returns `true` to accept, or a redirect path string
 *   (`/login/error?reason=mfa_required`) for the `signIn` callback to
 *   return directly, which Auth.js honors as a redirect rather than its
 *   default error page.
 */
export function evaluateMfaGate(providerId: string | undefined, amr: unknown): true | string {
  if (providerId !== "zitadel") return true;
  return amrShowsMfa(amr) ? true : "/login/error?reason=mfa_required";
}
