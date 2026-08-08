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
 *
 * THE COOKIE IS SIGNED. httpOnly stops a script on the page reading it; it does
 * nothing about the person holding the browser, who can put whatever they like
 * in it and send it back. That mattered because `tier` rides in here and the
 * dashboard prices from it: the daemon resolves the plan from its own
 * verification row (`row.Tier`) and provisions accordingly, so a browser-chosen
 * tier could not change what got provisioned, but it could change what got
 * billed and how long the trial ran. Provisioned as one plan, charged for
 * another. `stripeCustomerId` rides here too and had to be re-checked against
 * Stripe at completion for exactly the same reason.
 *
 * Signing removes the class rather than the one field: every value in the
 * payload is now tamper-evident, and a cookie that does not verify is treated
 * as absent. Same construction as the `gibson_active_tenant` cookie in
 * `src/lib/auth/active-tenant.ts` — `<payload>.<hex hmac-sha256>` keyed on
 * AUTH_SECRET, compared in constant time.
 *
 * This is confidentiality-preserving only in the sense that matters here: the
 * payload stays readable to anyone who can read the cookie jar, and that is
 * fine, because every field in it belongs to the person who just proved control
 * of the mailbox. What they must not be able to do is CHANGE one, and now they
 * cannot.
 */

import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

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

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * The signing key. Deliberately the same one `active-tenant.ts` uses: it is a
 * generic server-side signing secret that happens to be named for Auth.js, the
 * chart already generates it into the dashboard Secret, and a second key would
 * be a second thing to rotate for no gain.
 *
 * Hard-fails rather than falling back to a guessable value. A signup flow that
 * silently signs with the empty string is worse than one that does not start.
 */
function signingKey(): Buffer {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error('AUTH_SECRET is missing or too short to sign cookies');
  }
  return Buffer.from(s, 'utf8');
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('hex');
}

/**
 * Constant-time signature compare. Returns false on a length mismatch so a
 * caller cannot use timing to learn anything about the expected signature.
 */
function signatureMatches(payload: string, providedHex: string): boolean {
  const expected = Buffer.from(sign(payload), 'hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/**
 * Serialise and sign for the cookie value.
 *
 * Format is `<json>.<hex hmac>`. The JSON is not escaped or encoded further:
 * `JSON.stringify` cannot emit a `.` outside a string literal, and the split on
 * read takes the LAST `.`, so a payload containing dots round-trips intact.
 */
export function encodeVerifiedSession(s: VerifiedSignupSession): string {
  const payload = JSON.stringify(s);
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify, then parse, a cookie value back into a session.
 *
 * Returns null on anything malformed, incomplete, unsigned or wrongly signed
 * rather than throwing, and on anything missing the token — a cookie without
 * the capability cannot authorise completion, so treating it as absent is the
 * same answer with less code. A tampered cookie takes the same path: the user
 * is told the link is no longer valid and starts again.
 */
export function decodeVerifiedSession(
  raw: string | undefined,
): VerifiedSignupSession | null {
  if (!raw) return null;

  // Split on the LAST dot: the signature is fixed-width hex and cannot contain
  // one, but the JSON payload can.
  const lastDot = raw.lastIndexOf('.');
  if (lastDot <= 0) return null;
  const payload = raw.slice(0, lastDot);
  const signature = raw.slice(lastDot + 1);
  if (!signature || !signatureMatches(payload, signature)) return null;

  try {
    const parsed: unknown = JSON.parse(payload);
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
