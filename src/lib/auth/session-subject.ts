// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The subject a dashboard session carries: the person's Zitadel user id.
 *
 * Auth.js v5 does not use the provider's `sub` as the user id. With no
 * adapter it gives each sign-in a new random UUID (`@auth/core`
 * `lib/actions/callback/oauth/callback.js`), writes that UUID to `token.sub`,
 * and keeps the provider's `sub` only as `account.providerAccountId`. The
 * daemon records the Zitadel id as the owner of what a person creates (a bank,
 * a mission), so a session that kept the UUID could never match itself to
 * anything it owns, and every per-user key changed on each sign-in.
 *
 * `providerAccountId` alone is not enough: Auth.js fills it with a random UUID
 * too when the profile has no id. So the subject is the profile's `sub`, and
 * the account must name the same id.
 *
 * Pure function, no env or session reads, so it is unit testable the same way
 * `evaluateMfaGate` is.
 *
 * @module auth/session-subject
 */

/**
 * Returns the Zitadel user id of a sign-in, from the profile and the account
 * that Auth.js passes to the `jwt` callback on the first call. Returns `null`
 * when the profile names no `sub` or the account names a different id, so the
 * caller fails closed instead of keeping a random UUID.
 */
export function sessionSubject(
  account: { providerAccountId?: unknown } | null | undefined,
  profile: { sub?: unknown } | null | undefined,
): string | null {
  const sub = profile?.sub;
  if (typeof sub !== "string" || sub === "") {
    return null;
  }
  return account?.providerAccountId === sub ? sub : null;
}
