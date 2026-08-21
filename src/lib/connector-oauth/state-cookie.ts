import 'server-only';

/**
 * The in-flight connector-authorization cookie.
 *
 * Between "the operator clicked Authorize" and "the vendor redirected back
 * with a code", the flow needs the PKCE code_verifier, the anti-forgery
 * state, and everything the completion call will store on the grant. All of
 * it rides in one signed httpOnly cookie:
 *
 *  - httpOnly, because the code_verifier is a capability: PKCE exists so that
 *    only the party that started the authorization can finish it, and a
 *    verifier readable from page JavaScript defeats exactly that. (The
 *    plugin-register wizard's "no wizard state in browser storage" rule,
 *    applied to OAuth.)
 *  - Signed, because the callback trusts these fields to decide which
 *    connector the resulting grant belongs to and which token endpoint the
 *    platform will call for the life of the grant. Same construction as the
 *    verified-signup cookie: `<base64url payload>.<hex hmac-sha256>` keyed on
 *    AUTH_SECRET, constant-time compare, unverifiable treated as absent.
 *  - sameSite lax, because the operator returns from the vendor by top-level
 *    cross-origin navigation and `strict` would withhold the cookie on
 *    exactly that hop.
 */

import { createHmac, timingSafeEqual, randomBytes, createHash } from 'node:crypto';

export const CONNECTOR_OAUTH_COOKIE = 'gibson_connector_oauth';

/**
 * Ten minutes. An authorization is one login + one consent click; a cookie
 * that outlives the sitting is attack surface, and an expired one just means
 * clicking Authorize again.
 */
const CONNECTOR_OAUTH_MAX_AGE_SECONDS = 10 * 60;

/** Where the callback route lives; the cookie is scoped to it. */
export const CONNECTOR_OAUTH_CALLBACK_PATH = '/dashboard/connectors/oauth/callback';

/** What rides in the cookie for the callback to act on. */
export interface ConnectorOAuthSession {
  /** Anti-forgery value the vendor echoes back in ?state=. */
  state: string;
  /** PKCE verifier; finishes what the challenge started. */
  codeVerifier: string;
  /** The plugin install the operator authorized from (for the redirect back). */
  installId: string;
  /** The connector component name the grant belongs to. */
  connector: string;
  /** Vendor endpoints, discovered before the redirect and stored on the grant. */
  tokenEndpoint: string;
  revocationEndpoint?: string;
  clientId: string;
  scope: string;
  /** The exact redirect_uri used at authorize time; the exchange must repeat it. */
  redirectUri: string;
}

export function connectorOAuthCookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: CONNECTOR_OAUTH_CALLBACK_PATH,
    maxAge: CONNECTOR_OAUTH_MAX_AGE_SECONDS,
  };
}

/**
 * The signing key — deliberately the same server-side signing secret the
 * verified-signup and active-tenant cookies use. Hard-fails rather than
 * signing with a guessable value.
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

/** Serialise + sign a session into the cookie value. */
export function sealConnectorOAuthSession(session: ConnectorOAuthSession): string {
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify + parse a cookie value. Returns null for anything that does not
 * verify — a cookie that fails its signature is treated as absent, never as
 * an error to reason about.
 */
export function openConnectorOAuthSession(value: string | undefined): ConnectorOAuthSession | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ConnectorOAuthSession;
    if (!parsed.state || !parsed.codeVerifier || !parsed.connector || !parsed.tokenEndpoint || !parsed.clientId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// PKCE material
// ---------------------------------------------------------------------------

/** RFC 7636 §4.1: a high-entropy verifier in the unreserved alphabet. */
export function newCodeVerifier(): string {
  return randomBytes(48).toString('base64url');
}

/** RFC 7636 §4.2: S256 challenge for a verifier. */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** Anti-forgery state; single-use, bound to the cookie. */
export function newState(): string {
  return randomBytes(24).toString('base64url');
}
