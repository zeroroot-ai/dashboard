/**
 * SPIFFE JWT-SVID minter with in-process stale-while-revalidate cache.
 *
 * Single entry point for any server-side code that needs a JWT-SVID proving
 * the dashboard's workload identity. Used by `gibson-admin-client.ts` to
 * attach an `Authorization: Bearer` header before each admin RPC.
 *
 * Cache semantics:
 *   - Tokens are cached per audience string.
 *   - When `Date.now() > exp - REFRESH_LEAD_MS` (30 min before expiry),
 *     the current cached token is returned immediately AND a background
 *     refetch is kicked off. The next caller sees the fresh token.
 *   - On a cold cache, the call blocks until the SPIRE Workload API responds.
 *
 * Failure modes:
 *   - Socket path absent → throws `SpireNotConfiguredError` synchronously.
 *   - gRPC call times out at 5 s → throws `SpireUnreachableError`.
 *   - Token fails validation (ttl > 3600, wrong aud, bad sub) → throws `Error`.
 *
 * Rules:
 *   - No module-level socket open, env read, or fs stat. Everything is lazy.
 *   - The raw JWT string is NEVER logged.
 *
 * @module spiffe/jwt-svid
 */

import 'server-only';

import { statSync } from 'fs';
import { decodeJwt } from 'jose';
import { fetchJWTSVID } from './workload-api-proto';
import { adminJwtRefreshTotal } from '@/src/lib/metrics/gibson-admin';

// ---------------------------------------------------------------------------
// Public error types
// ---------------------------------------------------------------------------

/**
 * Thrown when the SPIFFE Workload API socket path does not exist on the
 * filesystem. Indicates that SPIRE is not configured for this pod.
 *
 * Action: enable `spire: true` in the helm overlay and redeploy.
 */
export class SpireNotConfiguredError extends Error {
  constructor(socketPath: string) {
    super(
      `SPIRE Workload API socket not found at "${socketPath}". ` +
        'Enable spire: true in the helm overlay to configure SPIRE for this pod.',
    );
    this.name = 'SpireNotConfiguredError';
  }
}

/**
 * Thrown when the SPIFFE Workload API call times out or returns a connection
 * error. The SPIRE agent may be starting up or the socket is temporarily
 * unavailable.
 *
 * Action: the caller should surface a 503 + `Retry-After: 30`.
 */
export class SpireUnreachableError extends Error {
  constructor(socketPath: string, cause: unknown) {
    super(
      `SPIRE Workload API at "${socketPath}" is unreachable or timed out.`,
      { cause },
    );
    this.name = 'SpireUnreachableError';
  }
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface SpiffeJwtOptions {
  /**
   * SPIFFE-URI audience for the requested token, e.g.
   * `"spiffe://gibson.io/platform/daemon"`.
   */
  audience: string;
}

// ---------------------------------------------------------------------------
// Internal cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  /** Raw JWT compact string — never logged. */
  token: string;
  /**
   * Expiry epoch in **milliseconds** (iat + (exp − iat) * 1000).
   * Derived from the `exp` JWT claim.
   */
  expiresAtMs: number;
  /**
   * True while an async background refresh is in flight for this entry.
   * Guards against parallel background fetches for the same audience.
   */
  refreshing: boolean;
}

/** 30 minutes before expiry — trigger a background refresh. */
const REFRESH_LEAD_MS = 30 * 60 * 1_000;

/** gRPC call timeout per the spec. */
const GRPC_TIMEOUT_MS = 5_000;

/** Maximum allowed `exp − iat` for a minted token, in seconds. */
const MAX_TTL_S = 3_600;

/** Pattern that a valid SPIFFE subject must match. */
const SPIFFE_SUB_RE = /^spiffe:\/\/[a-z0-9.-]+\//;

const cache = new Map<string, CacheEntry>();

// ---------------------------------------------------------------------------
// Socket path (lazy — read inside function, not at module level)
// ---------------------------------------------------------------------------

function resolveSocketPath(): string {
  return (
    process.env['SPIFFE_ENDPOINT_SOCKET'] ??
    'unix:///run/spire/sockets/agent.sock'
  );
}

/**
 * Convert a `unix:///path` socket address to a plain filesystem path for
 * `statSync`. gRPC uses the `unix:///` scheme; `statSync` wants a bare path.
 */
function socketAddressToFsPath(socketAddress: string): string {
  if (socketAddress.startsWith('unix://')) {
    // unix:///run/... → /run/...
    return socketAddress.slice('unix://'.length);
  }
  return socketAddress;
}

// ---------------------------------------------------------------------------
// Token validation
// ---------------------------------------------------------------------------

/**
 * Validate a freshly-minted JWT-SVID. Throws with a specific message for
 * each invariant that fails. Never returns undefined — either returns the
 * decoded payload or throws.
 */
function validateToken(
  token: string,
  expectedAudience: string,
): { exp: number; iat: number; aud: string | string[]; sub: string } {
  // decodeJwt does NOT verify the signature — SPIRE's gRPC call guarantees
  // the token is from the agent. Signature verification happens at Envoy.
  const claims = decodeJwt(token);

  const { exp, iat, aud, sub } = claims;

  if (typeof exp !== 'number') {
    throw new Error('SPIFFE JWT-SVID is missing the "exp" claim.');
  }
  if (typeof iat !== 'number') {
    throw new Error('SPIFFE JWT-SVID is missing the "iat" claim.');
  }

  const ttlSeconds = exp - iat;
  if (ttlSeconds > MAX_TTL_S) {
    throw new Error(
      `SPIFFE JWT-SVID TTL ${ttlSeconds}s exceeds the maximum allowed ${MAX_TTL_S}s. ` +
        'The SPIRE server may be misconfigured.',
    );
  }

  // Audience check — aud can be a single string or an array.
  const audList = Array.isArray(aud) ? aud : typeof aud === 'string' ? [aud] : [];
  if (!audList.includes(expectedAudience)) {
    throw new Error(
      `SPIFFE JWT-SVID audience does not contain expected audience "${expectedAudience}". ` +
        `Got: ${JSON.stringify(audList)}.`,
    );
  }

  if (typeof sub !== 'string' || !SPIFFE_SUB_RE.test(sub)) {
    throw new Error(
      `SPIFFE JWT-SVID "sub" claim "${String(sub)}" does not match the ` +
        'expected pattern spiffe://<trust-domain>/<workload>.',
    );
  }

  return { exp, iat, aud: audList, sub };
}

// ---------------------------------------------------------------------------
// Core fetch + validate
// ---------------------------------------------------------------------------

/** Fetch a fresh JWT-SVID from SPIRE and validate it. */
async function mintToken(
  audience: string,
  socketPath: string,
): Promise<{ token: string; expiresAtMs: number }> {
  let rawJwt: string;

  try {
    rawJwt = await fetchJWTSVID([audience], socketPath, GRPC_TIMEOUT_MS);
  } catch (err) {
    // Diagnostic: log the underlying error so we can distinguish a real
    // gRPC timeout from a synchronous client-construction failure (e.g. URI
    // parse error in grpc-js). The catch otherwise hides the root cause.
    console.error('[spiffe/jwt-svid] mintToken raw error:', {
      socketPath,
      audience,
      name: (err as Error)?.name,
      message: (err as Error)?.message,
      code: (err as { code?: number })?.code,
      details: (err as { details?: string })?.details,
      stack: (err as Error)?.stack?.split('\n').slice(0, 4).join('\n'),
    });
    // Distinguish between DEADLINE_EXCEEDED / UNAVAILABLE (unreachable) and
    // other errors. grpc-js sets `err.code` to a numeric status code.
    const code = (err as { code?: number }).code;
    // grpc status codes: 4 = DEADLINE_EXCEEDED, 14 = UNAVAILABLE
    if (code === 4 || code === 14) {
      throw new SpireUnreachableError(socketPath, err);
    }
    throw new SpireUnreachableError(socketPath, err);
  }

  const { exp } = validateToken(rawJwt, audience);
  const expiresAtMs = exp * 1_000;

  return { token: rawJwt, expiresAtMs };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a valid JWT-SVID for the given audience, fetching and caching as
 * needed.
 *
 * Implements stale-while-revalidate: when the cached token is within 30
 * minutes of expiry, it is returned immediately while a background refresh
 * runs. Callers that arrive after the refresh completes receive the fresh
 * token.
 *
 * @throws {SpireNotConfiguredError} if the Workload API socket is not present.
 * @throws {SpireUnreachableError} if the gRPC call times out (5 s deadline).
 * @throws {Error} if the minted token fails any validation invariant.
 */
export async function getSpiffeJwt(opts: SpiffeJwtOptions): Promise<string> {
  const { audience } = opts;
  const socketPath = resolveSocketPath();

  // Stat the socket synchronously before opening a gRPC channel. This gives
  // an immediately-actionable error instead of a connection timeout.
  const fsPath = socketAddressToFsPath(socketPath);
  try {
    statSync(fsPath);
  } catch {
    adminJwtRefreshTotal.inc({ outcome: 'not_configured' });
    throw new SpireNotConfiguredError(socketPath);
  }

  const now = Date.now();
  const entry = cache.get(audience);

  if (entry && now < entry.expiresAtMs) {
    // Token is still valid. Check whether it's approaching expiry.
    const needsRefresh = now > entry.expiresAtMs - REFRESH_LEAD_MS;
    if (needsRefresh && !entry.refreshing) {
      adminJwtRefreshTotal.inc({ outcome: 'stale_while_revalidate' });
      // Mark as refreshing to prevent parallel background fetches.
      entry.refreshing = true;
      // Fire-and-forget background refresh. Errors are logged but not thrown —
      // the cached token is still valid for up to 30 more minutes.
      mintToken(audience, socketPath)
        .then(({ token, expiresAtMs }) => {
          cache.set(audience, { token, expiresAtMs, refreshing: false });
          adminJwtRefreshTotal.inc({ outcome: 'ok' });
          // Log claim metadata only — never the token.
          const claims = decodeJwt(token);
          console.info(
            `[spiffe/jwt-svid] Background refresh complete: ` +
              `sub=${String(claims.sub)} exp=${String(claims.exp)} aud=${JSON.stringify(claims.aud)}`,
          );
        })
        .catch((err) => {
          // Clear the refreshing flag so the next caller can retry.
          const current = cache.get(audience);
          if (current) current.refreshing = false;
          const outcome =
            err instanceof SpireUnreachableError
              ? 'unreachable'
              : err instanceof SpireNotConfiguredError
                ? 'not_configured'
                : 'rejected';
          adminJwtRefreshTotal.inc({ outcome });
          console.error(
            '[spiffe/jwt-svid] Background token refresh failed:',
            err instanceof Error ? err.message : String(err),
          );
        });
    } else {
      adminJwtRefreshTotal.inc({ outcome: 'cached' });
    }
    return entry.token;
  }

  // Cold cache or expired token — blocking fetch.
  let minted: { token: string; expiresAtMs: number };
  try {
    minted = await mintToken(audience, socketPath);
  } catch (err) {
    const outcome = err instanceof SpireUnreachableError ? 'unreachable' : 'rejected';
    adminJwtRefreshTotal.inc({ outcome });
    throw err;
  }
  const { token, expiresAtMs } = minted;
  cache.set(audience, { token, expiresAtMs, refreshing: false });
  adminJwtRefreshTotal.inc({ outcome: 'ok' });

  const claims = decodeJwt(token);
  console.info(
    `[spiffe/jwt-svid] Token minted: ` +
      `sub=${String(claims.sub)} exp=${String(claims.exp)} aud=${JSON.stringify(claims.aud)}`,
  );

  return token;
}

// ---------------------------------------------------------------------------
// Test helper — exported only for unit tests (package-private convention)
// ---------------------------------------------------------------------------

/** Clear the in-process token cache. Called by tests between cases. */
export function __clearCacheForTests(): void {
  cache.clear();
}
