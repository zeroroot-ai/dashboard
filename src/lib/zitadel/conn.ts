// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The one way the dashboard's server side reaches Zitadel (ADR-0092,
 * dashboard#88). It mirrors gibson's `internal/platform/zitadelconn`.
 *
 * The pod connects to the Zitadel Service by Kubernetes DNS and states the
 * public host in the `x-zitadel-instance-host` header. Zitadel selects its
 * instance from that header. So the pod does not resolve the public name, and
 * no server-side request passes through the public edge.
 *
 * Two facts configure it, and they are the only two names for them:
 *
 *   ZITADEL_URL              where to connect: the in-cluster Service base URL
 *   ZITADEL_EXTERNAL_DOMAIN  what to claim: the public app host, never a port
 *
 * Endpoints are built from the connect base and Zitadel's fixed paths. An
 * absolute URL from a discovery document is never followed, because it names
 * the public host.
 *
 * The issuer (`ZITADEL_ISSUER`) is not derived here. It is a string that the
 * dashboard compares and that the BROWSER follows. No server code dials it.
 *
 * `zitadelFetch` refuses a URL that is not on the connect base. A server-side
 * call to a public name therefore fails loudly in place of working by
 * accident through a hostAlias.
 */

/** Carries the claimed public host on every server-side request. */
export const INSTANCE_HOST_HEADER = 'x-zitadel-instance-host';

/** Zitadel's fixed paths. */
const TOKEN_PATH = '/oauth/v2/token';
const JWKS_PATH = '/oauth/v2/keys';
const USERINFO_PATH = '/oidc/v1/userinfo';

/** Thrown for a missing or malformed fact, and for a refused dial. */
export class ZitadelConnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZitadelConnError';
  }
}

export interface ZitadelEndpoint {
  /** The in-cluster connect base, with no trailing slash. */
  readonly baseUrl: string;
  /** The claimed public host. */
  readonly host: string;
  readonly tokenUrl: string;
  readonly jwksUrl: string;
  readonly userinfoUrl: string;
}

/**
 * Validate the two facts. The connect URL must be an absolute http or https
 * URL with a host and no path, query or fragment. The claimed host must be a
 * bare DNS name. A port is refused because Zitadel stamps the issuer from the
 * host it resolves, so a ported host gives a ported issuer that every
 * portless check then rejects.
 */
export function newZitadelEndpoint(connectUrl: string, externalDomain: string): ZitadelEndpoint {
  let base: URL;
  try {
    base = new URL(connectUrl.trim());
  } catch {
    throw new ZitadelConnError(`ZITADEL_URL is not an absolute URL: ${JSON.stringify(connectUrl)}`);
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new ZitadelConnError(`ZITADEL_URL must be http or https, got ${base.protocol}`);
  }
  if ((base.pathname !== '/' && base.pathname !== '') || base.search !== '' || base.hash !== '') {
    throw new ZitadelConnError('ZITADEL_URL must have no path, query or fragment');
  }
  const host = externalDomain.trim();
  if (!/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(host)) {
    throw new ZitadelConnError(
      `ZITADEL_EXTERNAL_DOMAIN must be a bare host name with no scheme, port or path, got ${JSON.stringify(externalDomain)}`,
    );
  }
  const baseUrl = base.origin;
  return {
    baseUrl,
    host,
    tokenUrl: baseUrl + TOKEN_PATH,
    jwksUrl: baseUrl + JWKS_PATH,
    userinfoUrl: baseUrl + USERINFO_PATH,
  };
}

/**
 * The endpoint from the environment. It reads at call time, so a unit test
 * can set the two names per case.
 */
export function zitadelEndpoint(): ZitadelEndpoint {
  const missing = ['ZITADEL_URL', 'ZITADEL_EXTERNAL_DOMAIN'].filter((name) => {
    const v = process.env[name];
    return typeof v !== 'string' || v.trim().length === 0;
  });
  if (missing.length > 0) {
    throw new ZitadelConnError(`required env vars not set: ${missing.join(', ')}`);
  }
  return newZitadelEndpoint(process.env.ZITADEL_URL!, process.env.ZITADEL_EXTERNAL_DOMAIN!);
}

/**
 * `fetch` for server-side identity calls. It adds the instance header and
 * refuses any URL whose origin is not the connect base. It has the `fetch`
 * signature, so Auth.js takes it as its `customFetch`.
 */
export async function zitadelFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const endpoint = zitadelEndpoint();
  const target = new URL(input instanceof Request ? input.url : input.toString());
  if (target.origin !== endpoint.baseUrl) {
    throw new ZitadelConnError(
      `refusing a server-side identity call to ${target.origin}: only ZITADEL_URL (${endpoint.baseUrl}) is dialed (ADR-0092)`,
    );
  }
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  headers.set(INSTANCE_HOST_HEADER, endpoint.host);
  return fetch(input, { ...init, headers });
}
