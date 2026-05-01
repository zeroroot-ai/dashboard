/**
 * Zitadel JWT bearer-token verifier for inbound service-acting routes.
 *
 * Validates Bearer tokens presented by platform components (tenant-operator,
 * tool-runner, future SAs) against Zitadel's published JWKS. This is the
 * single verifier used by every dashboard route that accepts machine-to-machine
 * (service-acting) calls — no SPIFFE JWT-SVID code exists in this module.
 *
 * Checks performed (in order):
 *   1. Authorization header present and "Bearer …" shaped.
 *   2. JWT signature verified against Zitadel JWKS (cached 10 min).
 *   3. `iss` matches ZITADEL_ISSUER.
 *   4. `aud` includes ZITADEL_AUDIENCE (default "gibson-platform").
 *   5. `sub` (Zitadel-issued NUMERIC user ID) is in ALLOWED_SERVICE_SUBJECTS.
 *
 * Per spec canonical-service-identity, the canonical service-account
 * identifier is the Zitadel-issued numeric `sub`. Readable SA names appear
 * only at bootstrap input (Helm values, post-install Job) and at log
 * enrichment (via the identity-resolver helper). This verifier does a single
 * equality check against the numeric sub. The earlier multi-claim fallback
 * (preferred_username / username / client_id / sub) was a defensive
 * workaround for a shape mismatch the canonical-service-identity spec
 * eliminated.
 *
 * Throws a {@link ZitadelBearerError} with a machine-readable `code` on every
 * failure. The bearer token bytes are NEVER included in the error message.
 *
 * Env vars:
 *   ZITADEL_ISSUER             — Zitadel issuer URL (required).
 *   ZITADEL_AUDIENCE           — Expected audience claim (default "gibson-platform").
 *   ALLOWED_SERVICE_SUBJECTS   — Comma-separated NUMERIC Zitadel subs allowed
 *                                to call service-acting routes. Populated at
 *                                pod start by the resolve-sa-identity-map
 *                                init container reading the chart-managed
 *                                gibson-sa-identity-map ConfigMap.
 *
 * Spec: canonical-service-identity R5; service-acting-auth R5.3.
 *
 * @module auth/zitadel-bearer-verifier
 */

import 'server-only';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';

// ---------------------------------------------------------------------------
// Structured error
// ---------------------------------------------------------------------------

/** Machine-readable failure codes — surfaced in 401 response bodies. */
export type ZitadelBearerErrorCode =
  | 'missing-authorization'
  | 'invalid-format'
  | 'signature-failed'
  | 'issuer-mismatch'
  | 'audience-mismatch'
  | 'subject-not-allowed';

/**
 * Thrown by {@link verifyZitadelBearer} on every verification failure.
 * The `code` field identifies which check failed; the message is human-readable
 * but NEVER contains the bearer token bytes.
 */
export class ZitadelBearerError extends Error {
  readonly code: ZitadelBearerErrorCode;
  constructor(code: ZitadelBearerErrorCode, detail: string) {
    super(`zitadel-bearer: ${code}: ${detail}`);
    this.name = 'ZitadelBearerError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Configuration — read lazily at call time so tests can override env vars
// before the first invocation.
// ---------------------------------------------------------------------------

function getIssuer(): string {
  return process.env.ZITADEL_ISSUER ?? '';
}

function getAudience(): string {
  return process.env.ZITADEL_AUDIENCE ?? 'gibson-platform';
}

function getAllowedSubjects(): ReadonlySet<string> {
  return new Set(
    (process.env.ALLOWED_SERVICE_SUBJECTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Startup self-check for `ALLOWED_SERVICE_SUBJECTS`.
 *
 * Spec: zero-trust-hardening Req 11.3.
 *
 * The dashboard's `verifyZitadelBearer` checks every inbound service-acting
 * JWT's `sub` claim against `ALLOWED_SERVICE_SUBJECTS`. If that env var is
 * empty at runtime the verifier silently 401s every machine-to-machine
 * call — a CrashLoopBackOff-or-quiet-failure trade-off where "quiet"
 * always wins and the failure mode is "components silently can't reach
 * the dashboard."
 *
 * This function is called from `instrumentation.register()` so the
 * Next.js Node server fail-fasts at startup if the chart's
 * `resolve-sa-identity-map` init container has not populated the env var.
 *
 * The check is intentionally NOT performed at module-load time: tests and
 * `pnpm build` static-analysis passes import this module without booting
 * a Next.js server, and they should not all need the env var present.
 * Production fail-fast lives at the instrumentation hook only.
 *
 * @throws Error if ALLOWED_SERVICE_SUBJECTS parses to an empty Set.
 */
export function assertAllowedServiceSubjectsConfigured(): void {
  const subjects = getAllowedSubjects();
  if (subjects.size === 0) {
    throw new Error(
      'ALLOWED_SERVICE_SUBJECTS missing or empty — fail-fast per zero-trust-hardening Req 11.3. ' +
        'The chart\'s resolve-sa-identity-map init container should write a comma-joined list of ' +
        'numeric Zitadel subs into this env var; if the var is empty, no service-acting JWT can ' +
        'reach the dashboard, which silently breaks every machine-to-machine call. Refusing to start.',
    );
  }
}

// ---------------------------------------------------------------------------
// JWKS — lazily initialised; cached until __resetJWKSForTests is called.
// The cache key is the issuer URL — if ZITADEL_ISSUER changes between calls
// (test-only scenario), __resetJWKSForTests must be called first.
// ---------------------------------------------------------------------------

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let _jwksIssuer = '';

function getJWKS(): ReturnType<typeof createRemoteJWKSet> {
  const issuer = getIssuer();
  if (!issuer) {
    throw new ZitadelBearerError(
      'signature-failed',
      'ZITADEL_ISSUER is not configured',
    );
  }
  if (_jwks && _jwksIssuer === issuer) return _jwks;
  _jwks = createRemoteJWKSet(new URL(`${issuer}/oauth/v2/keys`), {
    cacheMaxAge: 600_000,
  });
  _jwksIssuer = issuer;
  return _jwks;
}

/** Exposed for unit tests only — resets the cached JWKS singleton. */
export function __resetJWKSForTests(): void {
  _jwks = null;
  _jwksIssuer = '';
}

// ---------------------------------------------------------------------------
// Verified identity shape
// ---------------------------------------------------------------------------

export interface VerifiedServiceIdentity {
  /** Human-readable SA username, e.g. "gibson-tenant-operator". */
  subject: string;
  /** Numeric Zitadel `sub` claim (the machine-user's internal ID). */
  clientId: string;
  // Tenant intentionally omitted — service-acting JWTs do not carry a tenant
  // claim (per spec tenant-membership-not-in-jwt). The route handler must
  // resolve the tenant from request context.
}

// ---------------------------------------------------------------------------
// Public verifier
// ---------------------------------------------------------------------------

/**
 * Verify a Zitadel JWT from an Authorization header value.
 *
 * @param authHeader - The raw value of the `Authorization` request header
 *   (or `null` / `undefined` if absent).
 * @returns The verified service identity on success.
 * @throws {ZitadelBearerError} on any verification failure.
 */
export async function verifyZitadelBearer(
  authHeader: string | null | undefined,
): Promise<VerifiedServiceIdentity> {
  // Check 1: header present
  if (!authHeader) {
    throw new ZitadelBearerError(
      'missing-authorization',
      'Authorization header is absent',
    );
  }

  // Check 2: Bearer shape
  if (!/^Bearer\s+\S/i.test(authHeader)) {
    throw new ZitadelBearerError(
      'invalid-format',
      'Authorization header must be "Bearer <token>"',
    );
  }
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  // Minimal structural check: three dot-separated segments (header.payload.sig)
  if (token.split('.').length !== 3) {
    throw new ZitadelBearerError(
      'invalid-format',
      'token does not have JWT structure (expected 3 segments)',
    );
  }

  const issuer = getIssuer();
  const audience = getAudience();
  const allowedSubjects = getAllowedSubjects();

  // Checks 3+4: signature, issuer, audience via jose
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, getJWKS(), {
      issuer,
      audience,
    });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      throw new ZitadelBearerError('signature-failed', 'JWT signature verification failed');
    }
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      // jose surfaces both issuer and audience failures through this error class;
      // distinguish by the claim name it reports.
      const claim = (err as joseErrors.JWTClaimValidationFailed).claim;
      if (claim === 'iss') {
        throw new ZitadelBearerError('issuer-mismatch', `issuer claim does not match ${issuer}`);
      }
      if (claim === 'aud') {
        throw new ZitadelBearerError('audience-mismatch', `audience claim does not include ${audience}`);
      }
    }
    if (err instanceof joseErrors.JWTExpired) {
      throw new ZitadelBearerError('signature-failed', 'JWT has expired');
    }
    if (err instanceof ZitadelBearerError) {
      throw err;
    }
    // Catch-all for JWKS fetch failures, malformed JWTs, etc.
    throw new ZitadelBearerError(
      'signature-failed',
      err instanceof Error ? err.message : 'JWT verification failed',
    );
  }

  // Check 5: subject allow-list
  // Spec canonical-service-identity Req 5.3 — single-claim numeric check.
  // The JWT's `sub` claim is the Zitadel-issued numeric user_id. The chart's
  // resolve-sa-identity-map init container populates ALLOWED_SERVICE_SUBJECTS
  // with comma-joined numeric subs (resolved from the readable SA names in
  // serviceAccounts.required against the gibson-sa-identity-map ConfigMap).
  // Equality compare. No multi-claim fallback.
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub || !allowedSubjects.has(sub)) {
    throw new ZitadelBearerError(
      'subject-not-allowed',
      `subject "${sub || '(missing)'}" is not in ALLOWED_SERVICE_SUBJECTS`,
    );
  }

  // Tenant is NOT carried in the JWT for service-acting calls (per spec
  // tenant-membership-not-in-jwt); the route handler resolves the tenant
  // from request context (path param, body field, or operator's CR ref).
  return { subject: sub, clientId: sub };
}
