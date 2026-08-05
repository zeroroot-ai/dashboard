/**
 * The verified-signup session cookie.
 *
 * After the emailed link is redeemed the daemon hands back a short-lived
 * completion session token. Everything downstream of redemption — creating the
 * billing customer, confirming the card, creating the account — is authorised
 * by that token and by nothing else.
 *
 * It lives in an httpOnly cookie for one reason: it is a capability. If it were
 * reachable from client JavaScript, any script running on the page could carry
 * a proven-address session away with it. The completion page therefore never
 * receives the token, only the display fields alongside it.
 *
 * The cookie also carries the fields the completion page shows (address,
 * workspace name, tier) and, on the paid path, the billing customer pinned to
 * this session. Those are not secrets in the same sense — they belong to the
 * person who just proved control of the mailbox — but they ride in the same
 * httpOnly cookie because there is no reason for the browser to read them
 * either.
 *
 * WHAT IS NOT IN HERE: the password. It is typed on the completion page and
 * goes straight to the daemon in the completion call. A password held across
 * the email round-trip would be a stored credential for an address that, at the
 * time it was stored, nobody had proven they controlled.
 */

import 'server-only';

import type { RedeemedSignupVerification } from './owner-provisioning';

/**
 * Cookie name. Deliberately not prefixed `__Host-`: kind serves the dashboard
 * over plain HTTP on a NodePort, and a `__Host-` cookie would be dropped there,
 * silently breaking the flow in the one environment where it is exercised most.
 */
export const SIGNUP_VERIFIED_COOKIE = 'gibson_signup_verified';

/**
 * Cookie lifetime, in seconds.
 *
 * Matches the daemon's completion-session TTL (30 minutes). Longer would leave
 * a cookie that looks live and is not; shorter would expire the user mid-form.
 * The daemon is the authority either way — an expired session is refused there
 * regardless of what the browser still holds.
 */
export const SIGNUP_VERIFIED_MAX_AGE_SECONDS = 30 * 60;

/** What the cookie carries between redemption and completion. */
export interface VerifiedSignupSession {
  /** The completion capability. Never sent to the browser as readable data. */
  verifiedSessionToken: string;
  attemptId: string;
  email: string;
  workspaceName: string;
  tier: string;
  /**
   * Paid path only: the billing customer pinned to this session. The daemon
   * holds the authoritative copy (AttachSignupCustomer wrote it to the
   * verification row) and does not hand it back, so completion needs its own
   * reference to subscribe it.
   */
  stripeCustomerId?: string;
}

/** The subset the completion page may render. Note the absent token. */
export type VerifiedSignupDisplay = Omit<
  VerifiedSignupSession,
  'verifiedSessionToken'
>;

/** Cookie attributes. Shared by the set and clear paths so they cannot drift. */
export function signupCookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
} {
  return {
    httpOnly: true,
    // `lax` rather than `strict`: the user arrives by following a link from
    // their mail client, which is a top-level navigation from another origin.
    // `strict` would withhold the cookie on exactly that navigation.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/signup',
  };
}

/** Serialise for the cookie value. */
export function encodeVerifiedSession(s: VerifiedSignupSession): string {
  return JSON.stringify(s);
}

/**
 * Parse a cookie value back into a session.
 *
 * Returns null on anything malformed or incomplete rather than throwing, and on
 * anything missing the token — a cookie without the capability cannot authorise
 * completion, so treating it as absent is the same answer with less code.
 */
export function decodeVerifiedSession(
  raw: string | undefined,
): VerifiedSignupSession | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const s = parsed as Partial<VerifiedSignupSession>;
    if (
      typeof s.verifiedSessionToken !== 'string' ||
      s.verifiedSessionToken === '' ||
      typeof s.attemptId !== 'string' ||
      typeof s.email !== 'string' ||
      typeof s.workspaceName !== 'string' ||
      typeof s.tier !== 'string'
    ) {
      return null;
    }
    return {
      verifiedSessionToken: s.verifiedSessionToken,
      attemptId: s.attemptId,
      email: s.email,
      workspaceName: s.workspaceName,
      tier: s.tier,
      stripeCustomerId:
        typeof s.stripeCustomerId === 'string' ? s.stripeCustomerId : undefined,
    };
  } catch {
    return null;
  }
}

/** Build a session record from a redemption. Billing is attached later. */
export function verifiedSessionFrom(
  redeemed: RedeemedSignupVerification,
): VerifiedSignupSession {
  return {
    verifiedSessionToken: redeemed.verifiedSessionToken,
    attemptId: redeemed.attemptId,
    email: redeemed.ownerEmail,
    workspaceName: redeemed.workspaceName,
    tier: redeemed.tier,
  };
}

/** Strip the capability before anything is handed to a client component. */
export function displayOnly(s: VerifiedSignupSession): VerifiedSignupDisplay {
  const { verifiedSessionToken: _token, ...rest } = s;
  return rest;
}
