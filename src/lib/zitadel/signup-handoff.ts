/**
 * signup-handoff.ts — server-side helpers for the signup → auto-login
 * pipeline (issue dashboard#41).
 *
 * After admin-API user provisioning succeeds we want the browser to land on
 * the dashboard home AUTHENTICATED, without bouncing through Zitadel's
 * hosted login UI. Zitadel V2's "build your own login UI" flow is the
 * mechanism: the relying party initiates the OIDC auth_request itself, then
 * uses a freshly-minted session (mint-on-behalf via a privileged PAT) to
 * CreateCallback the parked auth_request — the resulting callbackUrl is
 * the standard `?code=...&state=...` redirect Auth.js already knows how
 * to consume.
 *
 * This module owns step 1: server-side initiation of the OIDC auth_request.
 * It is invoked from `app/actions/signup.ts` at the START of `signupAction`
 * so that the state/PKCE cookies are written on the Server Action response
 * (which the browser receives BEFORE it navigates to the returned
 * callbackUrl). The authRequestId is returned to the caller and threaded
 * through to `finalizeAuthRequest` after admin-API provisioning succeeds.
 *
 * SECURITY notes:
 *   - State and PKCE code_verifier are encrypted with AUTH_SECRET using the
 *     same JWE scheme Auth.js itself uses (`@auth/core/jwt`). The salts
 *     match the cookie names exactly, which is what the callback handler
 *     uses for AAD on decode (`@auth/core/lib/actions/callback/oauth/checks`).
 *   - We do NOT reach into Auth.js's private `lib/` paths for cookie
 *     creation — we replicate the small slice we need (sealCookie with the
 *     correct salt) on top of the public `@auth/core/jwt` API.
 *   - The state cookie payload SHAPE must match what Auth.js's state.decode
 *     expects: `{ origin, random }` encoded with salt `"encodedState"`,
 *     then re-encoded with salt = cookie name as the outer seal.
 */

import 'server-only';

import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
// `next-auth/jwt` is the public export that re-exports @auth/core/jwt. We
// use the public path so the import survives Auth.js internal restructures.
import { encode as authjsEncode } from 'next-auth/jwt';

// ---------------------------------------------------------------------------
// Constants — mirror @auth/core defaults so the callback handler can decode
// cookies we set here.
// ---------------------------------------------------------------------------

const COOKIE_TTL_SECONDS = 60 * 15; // 15 minutes — matches @auth/core
const ENCODED_STATE_SALT = 'encodedState';

/**
 * Cookie-name table. The dashboard runs with `secure: true` only in production
 * (matches the Auth.js `cookies.sessionToken.options.secure` switch in
 * `auth.ts`). In dev (NODE_ENV !== "production") the cookies are NOT prefixed.
 */
function cookieNames(secure: boolean) {
  const cookiePrefix = secure ? '__Secure-' : '';
  return {
    state: `${cookiePrefix}authjs.state`,
    pkceCodeVerifier: `${cookiePrefix}authjs.pkce.code_verifier`,
    callbackUrl: `${cookiePrefix}authjs.callback-url`,
  };
}

/**
 * Whether to mint __Secure- prefixed cookies. The browser only honours that
 * prefix for cookies set with `Secure` over HTTPS; matches the auth.ts
 * `NODE_ENV === "production"` check exactly so the callback handler's
 * `defaultCookies()` lookup finds the same names.
 *
 * Named without the "use" prefix to avoid React's hooks linter mistaking
 * this for a custom hook (it is plain server-side branching logic).
 */
function shouldUseSecureCookies(): boolean {
  return process.env.NODE_ENV === 'production';
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

/**
 * RFC 7636 PKCE code_verifier: 43..128 chars from the unreserved set
 * `[A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"`. We use 64 bytes of
 * crypto-randomness → 86 base64url chars, well above the minimum.
 */
function generateCodeVerifier(): string {
  return base64Url(randomBytes(64));
}

/** S256 code_challenge = base64url(SHA-256(code_verifier)) — RFC 7636 §4.2. */
function deriveCodeChallenge(codeVerifier: string): string {
  return base64Url(createHash('sha256').update(codeVerifier).digest());
}

function base64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// State helpers — match @auth/core/lib/actions/callback/oauth/checks.ts
// ---------------------------------------------------------------------------

/**
 * Builds the inner state value Auth.js will hand to its `state.decode`
 * helper. The inner payload shape matches Auth.js verbatim — `{ origin,
 * random }` encoded with salt `"encodedState"` — so the callback handler's
 * decode step succeeds when our cookie is the one in flight.
 */
async function encodeStateInner(
  secret: string,
  origin?: string,
): Promise<string> {
  const payload = {
    origin,
    random: base64Url(randomBytes(24)),
  };
  return authjsEncode({
    secret,
    token: payload,
    salt: ENCODED_STATE_SALT,
    maxAge: COOKIE_TTL_SECONDS,
  });
}

/**
 * Builds the JWE that goes inside the state COOKIE (the outer seal, with
 * salt = cookie name). Auth.js wraps `inner` again with the cookie name
 * as the salt before storing it in the cookie body; we do the same.
 */
async function sealForCookie(
  secret: string,
  cookieName: string,
  innerValue: string,
): Promise<string> {
  return authjsEncode({
    secret,
    token: { value: innerValue },
    salt: cookieName,
    maxAge: COOKIE_TTL_SECONDS,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Result of `initiateOidcAuthRequest`. Callers that get a non-null result
 * thread `authRequestId` through to `client.finalizeAuthRequest()` after
 * admin-API user creation succeeds. The state/PKCE cookies have already
 * been set on the calling response.
 */
export interface OidcAuthRequestHandoff {
  /** Zitadel's auth_request ID — the path-parameter for CreateCallback. */
  authRequestId: string;
  /** The full Location URL Zitadel emitted; primarily for diagnostics. */
  zitadelLoginUrl: string;
}

export interface InitiateOidcAuthRequestConfig {
  /**
   * Issuer the BROWSER sees. Source: `ZITADEL_ISSUER` (mirrors auth.ts).
   * Used for the visible `state` cookie origin field; the dashboard does
   * not embed this in the authorize URL since Zitadel discovers it from
   * the request itself.
   */
  issuer: string;
  /**
   * Issuer the DASHBOARD POD uses for outbound HTTP. Source:
   * `ZITADEL_INTERNAL_ISSUER` falling back to `issuer`. Same split as auth.ts.
   */
  internalIssuer: string;
  /** Dashboard OIDC client id (ZITADEL_CLIENT_ID). */
  clientId: string;
  /** Absolute redirect URI Zitadel will emit on the callbackUrl. */
  redirectUri: string;
  /** AUTH_SECRET — used to encrypt the state/PKCE cookies. */
  authSecret: string;
}

/**
 * Reads the env-var-driven config used by initiateOidcAuthRequest. Mirrors
 * auth.ts so the cookie keys this module mints line up exactly with what
 * the Auth.js callback handler will look for.
 */
export function loadHandoffConfig(): InitiateOidcAuthRequestConfig | null {
  // The four required vars are validated at boot by `validateEnv()` in
  // `src/lib/env-validator.ts` (instrumentation.ts). We read directly from
  // process.env here to preserve the legacy "return null when missing →
  // caller falls back to /login" semantics — a defensive layer for the
  // narrow window between module-load and instrumentation-register, and
  // for unit tests that mutate process.env after the validator ran.
  const issuer = process.env.ZITADEL_ISSUER;
  const internalIssuer = process.env.ZITADEL_INTERNAL_ISSUER || issuer;
  const clientId = process.env.ZITADEL_CLIENT_ID;
  const authSecret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (!issuer || !internalIssuer || !clientId || !authSecret || !baseUrl) {
    return null;
  }
  // The redirect_uri is the standard Auth.js callback for the "zitadel"
  // provider — auth.ts pins this provider id, so the path is invariant.
  const redirectUri = `${baseUrl.replace(/\/$/, '')}/api/auth/callback/zitadel`;
  return { issuer, internalIssuer, clientId, redirectUri, authSecret };
}

/**
 * Initiates a Zitadel OIDC auth_request server-side, sets Auth.js's
 * state/PKCE cookies on the current response, and returns the parked
 * authRequestId.
 *
 * Flow:
 *   1. Generate PKCE code_verifier + S256 code_challenge.
 *   2. Generate Auth.js's encrypted state cookie value (same JWE format).
 *   3. Set both cookies via Next.js `cookies()` so the browser receives
 *      them on the Server Action response.
 *   4. Issue a server-side GET to `${internalIssuer}/oauth/v2/authorize`
 *      with `redirect: manual`. Zitadel responds 302 with a Location like
 *      `${issuer}/ui/v2/login/login?authRequest=<id>` (or `/login?...` on
 *      older deploys). Extract the `authRequest` query param.
 *
 * Returns null on any failure (config missing, fetch error, no
 * authRequestId in the response). Callers MUST fall back to the standard
 * /login redirect in that case.
 *
 * Why state/PKCE must match Auth.js's defaults:
 *   The user agent, after CreateCallback, lands on
 *   `/api/auth/callback/zitadel?code=...&state=...`. Auth.js's callback
 *   handler reads the state cookie under the conventional name (set here),
 *   decrypts it with AUTH_SECRET, checks the `state` query param matches
 *   the cookie value, then exchanges the code using the PKCE
 *   code_verifier cookie we set here. Any mismatch → InvalidCheck →
 *   redirect to /login?error=Callback.
 */
export async function initiateOidcAuthRequest(
  cfg: InitiateOidcAuthRequestConfig = loadHandoffConfig() ?? throwMissingConfig(),
): Promise<OidcAuthRequestHandoff | null> {
  const secure = shouldUseSecureCookies();
  const names = cookieNames(secure);

  // -------------------------------------------------------------------------
  // 1. PKCE
  // -------------------------------------------------------------------------
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = deriveCodeChallenge(codeVerifier);

  // -------------------------------------------------------------------------
  // 2. State — inner value Auth.js's state.decode expects, then outer seal
  //    keyed by the cookie name (matches sealCookie() in @auth/core).
  // -------------------------------------------------------------------------
  const stateInner = await encodeStateInner(cfg.authSecret);
  const stateCookieValue = await sealForCookie(
    cfg.authSecret,
    names.state,
    stateInner,
  );

  // PKCE cookie body is the verifier itself, sealed with the cookie name.
  const pkceCookieValue = await sealForCookie(
    cfg.authSecret,
    names.pkceCodeVerifier,
    codeVerifier,
  );

  // -------------------------------------------------------------------------
  // 3. Set cookies on the current response. The signup Server Action runs
  //    before the redirect/return so the Set-Cookie headers are committed
  //    when the action's response flushes.
  // -------------------------------------------------------------------------
  const jar = await cookies();
  const baseCookieOpts = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure,
    maxAge: COOKIE_TTL_SECONDS,
  };
  jar.set(names.state, stateCookieValue, baseCookieOpts);
  jar.set(names.pkceCodeVerifier, pkceCookieValue, baseCookieOpts);

  // -------------------------------------------------------------------------
  // 4. Hit /oauth/v2/authorize server-side with redirect:manual to extract
  //    the authRequestId from the 302 Location. NOTE: the `state` query
  //    param sent here is the INNER value (what Zitadel echoes back to
  //    the RP on the callback) — Auth.js's callback handler compares
  //    `state` query against the decrypted state cookie's inner value.
  // -------------------------------------------------------------------------
  const authorizeUrl = new URL(`${cfg.internalIssuer.replace(/\/$/, '')}/oauth/v2/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', cfg.clientId);
  authorizeUrl.searchParams.set('redirect_uri', cfg.redirectUri);
  authorizeUrl.searchParams.set('scope', 'openid profile email');
  authorizeUrl.searchParams.set('state', stateInner);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  // `prompt=login` forces a fresh authentication attempt; the V2 build-your-own
  // flow uses the auth_request that comes out of authorize regardless of
  // whether there's an existing IdP session, so this is belt-and-braces.
  authorizeUrl.searchParams.set('prompt', 'login');

  let response: Response;
  try {
    response = await fetch(authorizeUrl.toString(), {
      method: 'GET',
      redirect: 'manual',
      // The internal issuer reaches Zitadel via the in-cluster service; the
      // virtual-host router needs the public Host header to match.
      headers: { Host: new URL(cfg.issuer).host },
    });
  } catch {
    // Network failure — surface as null so caller falls back. Do not log
    // raw err.message (may contain credentials in dev .env strings).
    return null;
  }

  // A successful authorize call returns 302 with the Location header
  // pointing at the login UI. The authRequestId is the `authRequest` (or
  // `authRequestID`) query param of that URL.
  if (response.status < 300 || response.status >= 400) {
    return null;
  }
  const location = response.headers.get('location');
  if (!location) return null;

  let locationUrl: URL;
  try {
    // Location may be absolute or relative; in the relative case use the
    // issuer as the base.
    locationUrl = new URL(location, cfg.issuer);
  } catch {
    return null;
  }

  const authRequestId =
    locationUrl.searchParams.get('authRequest') ??
    locationUrl.searchParams.get('authRequestID');
  if (!authRequestId) return null;

  return {
    authRequestId,
    zitadelLoginUrl: locationUrl.toString(),
  };
}

function throwMissingConfig(): never {
  throw new Error(
    'initiateOidcAuthRequest: missing required env. Need AUTH_SECRET, ZITADEL_CLIENT_ID, and AUTH_URL/NEXTAUTH_URL.',
  );
}
