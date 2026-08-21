import 'server-only';

/**
 * Server-side OAuth plumbing against a connector's vendor (ADR-0064).
 *
 * The HUMAN step — login and consent — happens in the operator's browser as a
 * top-level navigation to the vendor's authorize endpoint. Everything here is
 * the machine half around it: RFC 8414 discovery, RFC 7591 dynamic client
 * registration, and the authorization-code exchange. These run in the
 * dashboard server rather than the browser for two hard reasons:
 *
 *  - The dashboard's CSP pins `connect-src 'self'`; a browser fetch() to the
 *    vendor is blocked by our own policy, and widening connect-src to
 *    arbitrary customer GitLab origins is worse than the problem.
 *  - GitLab (verified live) serves its token endpoint with permissive CORS
 *    but its discovery and registration endpoints with none, so a pure
 *    browser flow cannot even complete discovery.
 *
 * Doing the exchange server-side is also the stronger posture: the refresh
 * token never enters browser JavaScript at all — it travels vendor → this
 * server → the platform's secrets broker. And it adds no new reachability
 * requirement: the platform's token refresher must reach the vendor's token
 * endpoint for the life of the grant anyway.
 *
 * SSRF: these functions fetch operator-supplied URLs from inside the cluster.
 * The caller is a tenant admin (gated before any call lands here), the scheme
 * is pinned to https, and loopback/link-local/metadata addresses are refused.
 * Private RFC 1918 ranges are deliberately allowed: a self-managed GitLab on
 * internal addressing is the normal enterprise topology this feature exists
 * for, and the platform refresher will be calling the same host for the life
 * of the grant regardless.
 */

import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/** What discovery yields; the subset the authorization flow needs. */
interface VendorAuthServer {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  registrationEndpoint?: string;
  /** True when the server advertises S256 PKCE support. */
  supportsS256: boolean;
}

/** What the code exchange yields. Field names mirror RFC 6749 §5.1. */
interface VendorTokens {
  accessToken: string;
  refreshToken: string;
  scope: string;
}

const FETCH_TIMEOUT_MS = 15_000;

/**
 * A vendor-flow failure whose message is written for the operator: what went
 * wrong with THEIR instance and what to do about it. Never carries vendor
 * response bodies or credential material, so surfacing message verbatim in
 * the UI is safe and is the point.
 */
export class VendorError extends Error {}

function vendorFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'error',
  });
}

/**
 * Refuses URLs no vendor instance can legitimately live at. Blocks loopback,
 * link-local (incl. the cloud metadata endpoint), and unspecified addresses;
 * requires https.
 */
export async function assertVendorUrlSafe(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new VendorError('The instance URL is not a valid URL.');
  }
  if (url.protocol !== 'https:') {
    throw new VendorError('The instance URL must use https.');
  }
  // URL.hostname keeps the brackets on an IPv6 literal ("[::1]"); strip them
  // so isIP classifies it as an address rather than a hostname to resolve.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses: string[] = [];
  if (isIP(host)) {
    addresses.push(host);
  } else {
    try {
      const results = await lookup(host, { all: true });
      for (const r of results) addresses.push(r.address);
    } catch {
      throw new VendorError('The instance hostname does not resolve.');
    }
  }
  for (const addr of addresses) {
    if (isForbiddenAddress(addr)) {
      throw new VendorError('The instance URL resolves to a forbidden address.');
    }
  }
  return url;
}

function isForbiddenAddress(addr: string): boolean {
  const a = addr.toLowerCase();
  // IPv6 loopback / unspecified / v4-mapped forms.
  if (a === '::1' || a === '::') return true;
  const v4 = a.startsWith('::ffff:') ? a.slice(7) : a;
  if (isIP(v4) === 4) {
    const octets = v4.split('.').map(Number);
    if (octets[0] === 127 || octets[0] === 0) return true; // loopback, "this net"
    if (octets[0] === 169 && octets[1] === 254) return true; // link-local + cloud metadata
    return false;
  }
  // IPv6 link-local fe80::/10.
  return a.startsWith('fe8') || a.startsWith('fe9') || a.startsWith('fea') || a.startsWith('feb');
}

/**
 * RFC 8414 discovery against the vendor instance root. GitLab publishes
 * /.well-known/oauth-authorization-server on both gitlab.com and self-managed.
 */
export async function discoverAuthServer(instanceUrl: string): Promise<VendorAuthServer> {
  const base = await assertVendorUrlSafe(instanceUrl);
  const wellKnown = new URL('/.well-known/oauth-authorization-server', base.origin);

  let resp: Response;
  try {
    resp = await vendorFetch(wellKnown.toString(), {
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new VendorError('The instance did not answer OAuth discovery.');
  }
  if (!resp.ok) {
    throw new VendorError(
      `The instance does not publish OAuth server metadata (HTTP ${resp.status}).`,
    );
  }
  const meta = (await resp.json()) as Record<string, unknown>;
  const authorizationEndpoint = str(meta.authorization_endpoint);
  const tokenEndpoint = str(meta.token_endpoint);
  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new VendorError('The instance OAuth metadata is missing required endpoints.');
  }
  // Endpoints must stay on the instance the operator named: metadata that
  // points elsewhere would send the browser (and later the refresher) to a
  // host the operator never vetted.
  for (const ep of [authorizationEndpoint, tokenEndpoint]) {
    if (new URL(ep).origin !== base.origin) {
      throw new VendorError('The instance OAuth metadata points off the instance.');
    }
  }
  const methods = Array.isArray(meta.code_challenge_methods_supported)
    ? (meta.code_challenge_methods_supported as unknown[]).map(String)
    : [];
  return {
    authorizationEndpoint,
    tokenEndpoint,
    revocationEndpoint: sameOriginOrUndefined(str(meta.revocation_endpoint), base.origin),
    registrationEndpoint: sameOriginOrUndefined(str(meta.registration_endpoint), base.origin),
    supportsS256: methods.includes('S256'),
  };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function sameOriginOrUndefined(url: string | undefined, origin: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin === origin ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * RFC 7591 dynamic client registration: a public client (PKCE, no secret)
 * with exactly our callback as its redirect URI. GitLab supports this on
 * /oauth/register (verified live), which is what spares the operator from
 * hand-creating an OAuth application. Returns the client id.
 */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  clientName: string,
  scope: string,
): Promise<string> {
  let resp: Response;
  try {
    resp = await vendorFetch(registrationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'none',
        scope,
      }),
    });
  } catch {
    throw new VendorError('The instance did not answer client registration.');
  }
  if (resp.status !== 201 && resp.status !== 200) {
    throw new VendorError(
      `The instance refused dynamic client registration (HTTP ${resp.status}). ` +
        'Create an OAuth application on the instance and supply its application ID instead.',
    );
  }
  const body = (await resp.json()) as Record<string, unknown>;
  const clientId = str(body.client_id);
  if (!clientId) {
    throw new VendorError('The instance registration response carried no client id.');
  }
  return clientId;
}

/**
 * The authorization-code → token exchange (RFC 6749 §4.1.3 + PKCE verifier).
 * Returns the refresh token that becomes the connector grant. The response
 * body is never logged: it is credential material.
 */
export async function exchangeCode(args: {
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
}): Promise<VendorTokens> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    code_verifier: args.codeVerifier,
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
  });
  let resp: Response;
  try {
    resp = await vendorFetch(args.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
    });
  } catch {
    throw new VendorError('The vendor token endpoint did not answer.');
  }
  if (!resp.ok) {
    // An OAuth error body is an error code, not a credential, and it is the
    // only thing distinguishing an expired code from a misconfigured client.
    let code = '';
    try {
      const body = (await resp.json()) as Record<string, unknown>;
      code = str(body.error) ?? '';
    } catch {
      // Non-JSON error body: report the status alone.
    }
    throw new VendorError(
      `The vendor refused the code exchange (HTTP ${resp.status}${code ? `, ${code}` : ''}).`,
    );
  }
  const body = (await resp.json()) as Record<string, unknown>;
  const accessToken = str(body.access_token);
  const refreshToken = str(body.refresh_token);
  if (!accessToken) {
    throw new VendorError('The vendor token response carried no access token.');
  }
  if (!refreshToken) {
    // Without a refresh token there is no grant to store: the platform's
    // refresher would have nothing to work with and the connector would die
    // when this one access token expires.
    throw new VendorError(
      'The vendor issued no refresh token, so the platform cannot keep the connector authenticated. ' +
        'Check the OAuth application allows the refresh_token grant.',
    );
  }
  return { accessToken, refreshToken, scope: str(body.scope) ?? '' };
}
