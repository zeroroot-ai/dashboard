/**
 * Zitadel service-account access-token resolver for service-acting daemon
 * RPCs.
 *
 * The dashboard pod runs internal jobs (admin provisioning callbacks invoked
 * by the in-cluster tenant-operator, entitlement-driven team/quota CRD
 * writes, etc.) that have no end-user attached. Those calls need a bearer
 * token that identifies the dashboard workload itself, not any user. We
 * mint that token via Zitadel's OAuth2 `client_credentials` grant against
 * the dashboard's own service-account application: the K8s Secret
 * `gibson-dashboard-zitadel-sa` mounts `client_id` + `client_secret` into
 * the pod and we exchange them for a short-lived JWT.
 *
 * Mirrors the user-side helper {@link requireUserToken} in
 * `src/lib/auth/user-token.ts` for the user-acting transport. The two
 * helpers are deliberately kept separate, service-token code never touches
 * `auth()` or session cookies, and user-token code never reads the SA
 * client secret.
 *
 * Caching:
 *   - Tokens are cached in a module-scoped variable shared across requests
 *     (the dashboard runs as a long-lived Node process under Next.js
 *     standalone), keyed on nothing, there is exactly one SA per pod.
 *   - The cache is refreshed 60s before `expires_in` elapses so a hot
 *     request never hits Zitadel synchronously.
 *   - Concurrent callers during a refresh share a single in-flight
 *     `Promise<string>` to avoid stampeding Zitadel with N parallel
 *     `client_credentials` grants.
 *   - {@link invalidateServiceToken} forces the next call to refetch, the
 *     gRPC interceptor invokes it on a 401 from Envoy so a clock-skew or
 *     mid-flight key-rotation incident self-heals on retry.
 *
 * Failure modes:
 *   - Required env vars missing → throws {@link MissingServiceTokenConfigError}
 *     synchronously on the first call.
 *   - Zitadel returns non-2xx → throws {@link ServiceTokenFetchError} with
 *     the HTTP status; the bearer is NEVER logged.
 *
 * Spec: unified-identity-and-authorization Phase 4, replaces the SPIFFE
 * JWT-SVID outbound minter (`spiffe/jwt-svid.ts`) which is being deleted.
 *
 * @module auth/service-token
 */

import 'server-only';

// ---------------------------------------------------------------------------
// Public errors
// ---------------------------------------------------------------------------

/**
 * Thrown when one or more of {@link REQUIRED_ENV_VARS} are unset. Caller
 * should treat this as a permanent configuration error, there is no
 * retry that can fix a missing client_id / client_secret.
 */
export class MissingServiceTokenConfigError extends Error {
  readonly missing: readonly string[];
  constructor(missing: readonly string[]) {
    super(
      `service-token: required environment variable(s) not set: ${missing.join(', ')}. ` +
        `Mount the gibson-dashboard-zitadel-sa Secret on the dashboard Deployment.`,
    );
    this.name = 'MissingServiceTokenConfigError';
    this.missing = missing;
  }
}

/**
 * Thrown when Zitadel rejects the `client_credentials` grant with a
 * non-2xx response. The HTTP status and a (cleaned) snippet of the
 * response body are surfaced; the request body and bearer are NEVER
 * included in the error message.
 */
export class ServiceTokenFetchError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    // Zitadel may echo the request `client_id` back in error responses but
    // never the secret, still, we cap the body to a short snippet to
    // avoid leaking verbose JWKS / dev-mode debug data into operator
    // dashboards.
    const snippet = body.length > 200 ? `${body.slice(0, 200)}…` : body;
    super(`service-token: Zitadel client_credentials grant returned ${status}: ${snippet}`);
    this.name = 'ServiceTokenFetchError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Env vars validated on every cold mint; missing any throws synchronously. */
const REQUIRED_ENV_VARS = [
  'ZITADEL_DASHBOARD_CLIENT_ID',
  'ZITADEL_DASHBOARD_CLIENT_SECRET',
] as const;

/**
 * OAuth2 scopes requested. `openid` is required so Zitadel issues a JWT
 * (vs an opaque token); the project-audience scope tells Zitadel to set
 * `aud` to the gibson-platform project so Envoy's `jwt_authn` provider
 * accepts it.
 */
const SERVICE_TOKEN_SCOPE =
  'openid urn:zitadel:iam:org:project:id:gibson-platform:aud';

/** Refresh this many seconds before the token's reported `expires_in`. */
const REFRESH_LEAD_S = 60;

/**
 * Resolve the OAuth2 token endpoint. Explicit `ZITADEL_TOKEN_URL` wins;
 * otherwise we derive it from `ZITADEL_INTERNAL_ISSUER` (the same env var
 * the Auth.js OIDC discovery uses). The `/oauth/v2/token` suffix is
 * Zitadel's standard path.
 */
function resolveTokenUrl(): string {
  const explicit = process.env.ZITADEL_TOKEN_URL;
  if (explicit && explicit.length > 0) return explicit;
  const issuer = process.env.ZITADEL_INTERNAL_ISSUER;
  if (!issuer) {
    throw new MissingServiceTokenConfigError([
      'ZITADEL_TOKEN_URL or ZITADEL_INTERNAL_ISSUER',
    ]);
  }
  // Trim trailing slash so we don't emit `…//oauth/…`.
  const trimmed = issuer.replace(/\/+$/, '');
  return `${trimmed}/oauth/v2/token`;
}

// ---------------------------------------------------------------------------
// Module-scoped cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  /** Compact JWT, never logged. */
  token: string;
  /** Epoch milliseconds at which this token is considered "needs refresh". */
  refreshAtMs: number;
}

let cached: CacheEntry | null = null;

/**
 * In-flight refresh promise. When a refresh is in progress, every caller
 * awaits the same Promise so we never issue two parallel `client_credentials`
 * grants for the same pod.
 */
let inFlight: Promise<string> | null = null;

// ---------------------------------------------------------------------------
// Core mint
// ---------------------------------------------------------------------------

/**
 * Read + validate the env config. Throws {@link MissingServiceTokenConfigError}
 * if anything required is absent. Returns the trio in canonical form.
 */
function readConfig(): {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
} {
  const missing: string[] = [];
  for (const name of REQUIRED_ENV_VARS) {
    if (!process.env[name]) missing.push(name);
  }
  if (missing.length > 0) {
    throw new MissingServiceTokenConfigError(missing);
  }
  return {
    clientId: process.env.ZITADEL_DASHBOARD_CLIENT_ID!,
    clientSecret: process.env.ZITADEL_DASHBOARD_CLIENT_SECRET!,
    tokenUrl: resolveTokenUrl(),
  };
}

/**
 * Single round-trip to Zitadel's token endpoint. Returns the raw response
 * body parsed into the OAuth2 standard shape. Never logs the secret or
 * the resulting bearer.
 */
async function fetchToken(): Promise<{ access_token: string; expires_in: number }> {
  const { clientId, clientSecret, tokenUrl } = readConfig();

  // RFC 6749 §4.4: client_credentials grant. We use HTTP Basic for client
  // auth since Zitadel accepts both Basic and request-body auth and Basic
  // keeps the client_id out of any access logs that record only request
  // bodies (still no secret in the URL line either way).
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: SERVICE_TOKEN_SCOPE,
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    // Don't follow auth-bearing redirects, Zitadel never legitimately
    // 30x's the token endpoint and we'd risk replaying the secret to a
    // different host.
    redirect: 'manual',
    // Next.js fetch() default-caches; tokens are explicitly NOT cacheable.
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ServiceTokenFetchError(res.status, text);
  }

  const json = (await res.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof json.access_token !== 'string' || json.access_token.length === 0) {
    throw new ServiceTokenFetchError(
      res.status,
      'response missing access_token',
    );
  }
  if (typeof json.expires_in !== 'number' || json.expires_in <= 0) {
    throw new ServiceTokenFetchError(
      res.status,
      'response missing or invalid expires_in',
    );
  }
  return { access_token: json.access_token, expires_in: json.expires_in };
}

/**
 * Refresh the cached token. Concurrent callers share one in-flight
 * Promise; the cache is updated on success and cleared on failure so
 * the next caller retries (rather than serving a stale-or-broken value).
 */
function refresh(): Promise<string> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { access_token, expires_in } = await fetchToken();
      cached = {
        token: access_token,
        refreshAtMs: Date.now() + Math.max(0, (expires_in - REFRESH_LEAD_S) * 1000),
      };
      return access_token;
    } finally {
      // Always clear the in-flight slot so the NEXT call (after this one
      // resolves OR rejects) can re-attempt; on failure `cached` stays at
      // its previous value (possibly null) so we don't serve a stale token.
      inFlight = null;
    }
  })();
  return inFlight;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a Zitadel access token for the dashboard's service account.
 *
 * Cold cache → blocking `fetch` to Zitadel's token endpoint.
 * Hot cache (token still fresh) → synchronous return of the cached value.
 * Hot-but-near-expiry cache → blocking refresh; subsequent callers within
 *   the same refresh window share the in-flight Promise.
 *
 * @throws {MissingServiceTokenConfigError} when required env vars are missing.
 * @throws {ServiceTokenFetchError} when Zitadel returns a non-2xx response.
 */
export async function getServiceToken(): Promise<string> {
  if (cached && Date.now() < cached.refreshAtMs) {
    return cached.token;
  }
  return refresh();
}

/**
 * Drop the cached token so the next {@link getServiceToken} call refetches.
 *
 * Called by the gRPC client interceptor when Envoy returns 401, covers
 * the rare case where we cached a token Envoy decides to reject (clock
 * skew across the cluster, mid-flight Zitadel signing-key rotation, etc.).
 * One unconditional re-mint is cheap insurance against operator pain.
 */
export function invalidateServiceToken(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// Test-only helpers
// ---------------------------------------------------------------------------

/**
 * Exposed for unit tests only, flushes both the cache and any in-flight
 * refresh promise so each test starts from a known state. Production code
 * MUST NOT call this; use {@link invalidateServiceToken} for the
 * legitimate 401-handling case.
 */
export function __resetForTests(): void {
  cached = null;
  inFlight = null;
}
