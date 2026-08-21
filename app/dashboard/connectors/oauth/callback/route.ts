/**
 * The connector-authorization callback (ADR-0064, dashboard#1093).
 *
 * The vendor redirects the operator's browser here after login + consent:
 * `GET …/callback?code=…&state=…`. This is a Route Handler rather than a page
 * for the same reasons as the signup verify redemption: the work is
 * cookie-bound and server-side (a page's Server Component cannot clear the
 * flow cookie), and the final redirect strips the one-time code from the
 * address bar, history, and Referer.
 *
 * What happens here, in order:
 *  1. The signed flow cookie is opened; a cookie that does not verify is
 *     treated as absent and the flow is refused. The `state` echoed by the
 *     vendor must match the cookie's — that binding is what stops a forged
 *     callback from attaching an attacker's grant to our connector.
 *  2. The code is exchanged at the vendor's token endpoint, server-side,
 *     with the PKCE verifier. The refresh token never enters browser
 *     JavaScript at any point in the flow.
 *  3. The grant is delivered to the daemon (CompleteConnectorAuthorization),
 *     which records the calling human, stores it platform-only, and PROVES
 *     it by minting the first access token before answering.
 *  4. The cookie is cleared — the flow is single-use — and the operator
 *     lands back on the plugin detail page with only a status flag in the
 *     URL.
 *
 * Mutating on GET is the OAuth-redirect exception to the usual rule: the
 * request is authenticated by the session (middleware) AND by possession of
 * the signed single-use flow cookie, which no cross-site attacker can mint.
 *
 * Route path: /dashboard/connectors/oauth/callback — inside the middleware's
 * authenticated surface, so an unauthenticated hit never reaches this code.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

import {
  CONNECTOR_OAUTH_COOKIE,
  connectorOAuthCookieOptions,
  openConnectorOAuthSession,
} from '@/src/lib/connector-oauth/state-cookie';
import { exchangeCode, VendorError } from '@/src/lib/connector-oauth/vendor';
import { completeConnectorAuthorization } from '@/src/lib/gibson-client/connector-auth';

export const dynamic = 'force-dynamic';

/** Where the operator lands afterwards, success or failure. */
function detailUrl(req: NextRequest, installId: string): URL {
  return new URL(`/dashboard/pages/settings/plugins/${installId}`, req.nextUrl.origin);
}

function redirectWith(
  req: NextRequest,
  installId: string,
  params: Record<string, string>,
): NextResponse {
  const url = detailUrl(req, installId);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = NextResponse.redirect(url);
  // The flow is single-use: clear the cookie on every exit path.
  resp.cookies.set(CONNECTOR_OAUTH_COOKIE, '', {
    ...connectorOAuthCookieOptions(),
    maxAge: 0,
  });
  return resp;
}

function stateMatches(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = openConnectorOAuthSession(
    req.cookies.get(CONNECTOR_OAUTH_COOKIE)?.value,
  );
  if (!session) {
    // No (or unverifiable) flow cookie: nothing to complete. Without it we
    // do not even know which install to land on, so fall back to the
    // plugins list.
    return NextResponse.redirect(
      new URL('/dashboard/plugins?connector_auth=expired', req.nextUrl.origin),
    );
  }

  // The vendor reports a declined/failed authorization in ?error=.
  const vendorError = req.nextUrl.searchParams.get('error');
  if (vendorError) {
    return redirectWith(req, session.installId, {
      connector_auth: 'error',
      connector_auth_detail: `The instance refused the authorization (${vendorError}).`,
    });
  }

  const code = req.nextUrl.searchParams.get('code') ?? '';
  const state = req.nextUrl.searchParams.get('state') ?? '';
  if (!code || !state || !stateMatches(state, session.state)) {
    return redirectWith(req, session.installId, {
      connector_auth: 'error',
      connector_auth_detail: 'The authorization response did not match this browser session.',
    });
  }

  let refreshToken: string;
  let grantedScope: string;
  try {
    const tokens = await exchangeCode({
      tokenEndpoint: session.tokenEndpoint,
      code,
      codeVerifier: session.codeVerifier,
      clientId: session.clientId,
      redirectUri: session.redirectUri,
    });
    refreshToken = tokens.refreshToken;
    grantedScope = tokens.scope || session.scope;
  } catch (err) {
    const detail =
      err instanceof VendorError ? err.message : 'The vendor code exchange failed.';
    return redirectWith(req, session.installId, {
      connector_auth: 'error',
      connector_auth_detail: detail,
    });
  }

  try {
    await completeConnectorAuthorization({
      connector: session.connector,
      refreshToken,
      tokenEndpoint: session.tokenEndpoint,
      clientId: session.clientId,
      scope: grantedScope,
      revocationEndpoint: session.revocationEndpoint,
    });
  } catch (err) {
    // The daemon proves the grant before keeping it, so a failure here means
    // the grant did not survive — the message carries the vendor's error
    // code (the daemon's contract), never credential material.
    const detail = err instanceof Error ? err.message : 'Storing the grant failed.';
    return redirectWith(req, session.installId, {
      connector_auth: 'error',
      connector_auth_detail: detail,
    });
  }

  return redirectWith(req, session.installId, { connector_auth: 'ok' });
}
