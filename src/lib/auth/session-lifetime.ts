/**
 * Session lifetime policy for the Auth.js jwt strategy.
 *
 * Kept in its own module, with no Auth.js import, so the policy can be tested
 * as a pure function without evaluating the auth singleton (which reads
 * required Zitadel env at module load and constructs the whole NextAuth
 * handler set).
 *
 * The distinction this module exists to enforce:
 *
 *   IDLE window    , `session.maxAge`. Auth.js re-mints the session JWT with a
 *                    fresh `exp` on every server render while the OIDC session
 *                    is valid, so this bounds INACTIVITY only.
 *   ABSOLUTE cap   , measured from sign-in and never extended. Without it a
 *                    session has no maximum age at all: any tab that polls
 *                    keeps re-minting indefinitely, and the login is never
 *                    revalidated against the IdP, so a disabled account or a
 *                    revoked grant takes effect only when the user happens to
 *                    stop using the product.
 */

/**
 * Idle window. Bounds inactivity, not total session length. 8 hours matches a
 * typical working session; the Zitadel access-token lifetime is shorter.
 */
export const SESSION_IDLE_MAX_AGE_SECONDS = 8 * 60 * 60;

/**
 * Absolute session lifetime, measured from sign-in.
 *
 * Deliberately longer than the idle window: someone working continuously
 * through a normal day is not interrupted, but a session cannot be held open
 * forever. At the cap the jwt callback returns null, Auth.js drops the session
 * cookie, and the next request re-authenticates against Zitadel, which is the
 * point — it forces a fresh IdP decision within a bounded window.
 */
export const SESSION_ABSOLUTE_MAX_AGE_SECONDS = 12 * 60 * 60;

/**
 * True when a login stamped `authIssuedAt` more than the absolute cap ago.
 *
 * A token with NO stamp is also treated as expired. Sessions minted before this
 * control existed carry no stamp and there is no honest way to date them, so
 * they end rather than being grandfathered; the cost is one re-login at deploy,
 * and the alternative is a permanent second codepath for uncapped sessions
 * (ADR-0027, no parallel codepaths).
 *
 * @param authIssuedAt Unix seconds stamped once at sign-in. Typed `unknown`
 *   because it arrives off a decoded JWT and must not be trusted to be a number.
 * @param nowSeconds Injectable clock, for tests.
 */
export function isSessionBeyondAbsoluteCap(
  authIssuedAt: unknown,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (typeof authIssuedAt !== 'number' || !Number.isFinite(authIssuedAt)) {
    return true;
  }
  return nowSeconds - authIssuedAt >= SESSION_ABSOLUTE_MAX_AGE_SECONDS;
}
