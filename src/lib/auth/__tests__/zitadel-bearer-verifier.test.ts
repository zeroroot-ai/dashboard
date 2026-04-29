/**
 * Unit tests for `verifyZitadelBearer` in
 * `src/lib/auth/zitadel-bearer-verifier.ts`.
 *
 * Strategy: mock `jose` at the module boundary so we can inject controlled
 * error types and payloads without standing up a real Zitadel instance.
 * The JWKS singleton is reset before each test via `__resetJWKSForTests`.
 *
 * One test per error code:
 *   - missing-authorization
 *   - invalid-format (no Bearer prefix)
 *   - invalid-format (non-JWT structure)
 *   - signature-failed (JWSSignatureVerificationFailed)
 *   - signature-failed (JWTExpired)
 *   - issuer-mismatch
 *   - audience-mismatch
 *   - subject-not-allowed
 *   - happy-path (preferred_username match)
 *   - happy-path (numeric sub match)
 *   - happy-path (gibson:tenant claim forwarded)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock jose BEFORE importing the module under test so module-level JWKS
// initialisation picks up the mocked createRemoteJWKSet.
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(() => vi.fn()), // returns a stub key-set function
    jwtVerify: vi.fn(),
  };
});

import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';
import {
  verifyZitadelBearer,
  ZitadelBearerError,
  __resetJWKSForTests,
} from '../zitadel-bearer-verifier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Partial<Record<string, string | undefined>>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// A minimal valid-looking JWT structure (three segments) — content does not
// matter because jwtVerify is mocked.
const FAKE_JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.signature';
const BEARER = `Bearer ${FAKE_JWT}`;

// A payload that passes all checks.
function okPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: '123456789',
    preferred_username: 'gibson-tenant-operator',
    iss: 'https://zitadel.test',
    aud: ['gibson-platform'],
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

const mockedJwtVerify = vi.mocked(jwtVerify);

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetJWKSForTests();
  vi.mocked(createRemoteJWKSet).mockReturnValue(vi.fn() as unknown as ReturnType<typeof createRemoteJWKSet>);
  process.env = { ...ORIGINAL_ENV };
  setEnv({
    ZITADEL_ISSUER: 'https://zitadel.test',
    ZITADEL_AUDIENCE: 'gibson-platform',
    ALLOWED_SERVICE_SUBJECTS: 'gibson-tenant-operator,gibson-tool-runner-sa',
  });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Error class: missing-authorization
// ---------------------------------------------------------------------------

describe('missing-authorization', () => {
  it('throws when Authorization header is null', async () => {
    const err = await verifyZitadelBearer(null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZitadelBearerError);
    expect((err as ZitadelBearerError).code).toBe('missing-authorization');
  });

  it('throws when Authorization header is undefined', async () => {
    const err = await verifyZitadelBearer(undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZitadelBearerError);
    expect((err as ZitadelBearerError).code).toBe('missing-authorization');
  });

  it('throws when Authorization header is empty string', async () => {
    const err = await verifyZitadelBearer('').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZitadelBearerError);
    expect((err as ZitadelBearerError).code).toBe('missing-authorization');
  });
});

// ---------------------------------------------------------------------------
// Error class: invalid-format
// ---------------------------------------------------------------------------

describe('invalid-format', () => {
  it('throws when header is not Bearer-prefixed', async () => {
    const err = await verifyZitadelBearer('Basic dXNlcjpwYXNz').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZitadelBearerError);
    expect((err as ZitadelBearerError).code).toBe('invalid-format');
    // Token must NOT appear in the error message.
    expect((err as Error).message).not.toContain('dXNlcjpwYXNz');
  });

  it('throws when token does not have three dot-separated segments', async () => {
    const err = await verifyZitadelBearer('Bearer not-a-jwt').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZitadelBearerError);
    expect((err as ZitadelBearerError).code).toBe('invalid-format');
    expect((err as Error).message).not.toContain('not-a-jwt');
  });
});

// ---------------------------------------------------------------------------
// Error class: signature-failed
// ---------------------------------------------------------------------------

describe('signature-failed', () => {
  it('throws on JWSSignatureVerificationFailed', async () => {
    mockedJwtVerify.mockRejectedValueOnce(
      new joseErrors.JWSSignatureVerificationFailed(),
    );
    const err = await verifyZitadelBearer(BEARER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZitadelBearerError);
    expect((err as ZitadelBearerError).code).toBe('signature-failed');
    // Token bytes must not leak.
    expect((err as Error).message).not.toContain(FAKE_JWT);
  });

  it('throws on JWTExpired', async () => {
    mockedJwtVerify.mockRejectedValueOnce(
      new joseErrors.JWTExpired('JWT has expired', { payload: {}, protectedHeader: { alg: 'RS256' } }),
    );
    const err = await verifyZitadelBearer(BEARER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZitadelBearerError);
    expect((err as ZitadelBearerError).code).toBe('signature-failed');
  });

  it('wraps generic jose errors as signature-failed', async () => {
    mockedJwtVerify.mockRejectedValueOnce(new Error('JWKS endpoint unreachable'));
    const err = await verifyZitadelBearer(BEARER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZitadelBearerError);
    expect((err as ZitadelBearerError).code).toBe('signature-failed');
  });
});

// ---------------------------------------------------------------------------
// Error class: issuer-mismatch
// ---------------------------------------------------------------------------

describe('issuer-mismatch', () => {
  it('throws when iss claim does not match', async () => {
    const claimError = new joseErrors.JWTClaimValidationFailed(
      'unexpected "iss" claim value',
      {},
      'iss',
      'check_failed',
    );
    mockedJwtVerify.mockRejectedValueOnce(claimError);
    const err = await verifyZitadelBearer(BEARER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZitadelBearerError);
    expect((err as ZitadelBearerError).code).toBe('issuer-mismatch');
  });
});

// ---------------------------------------------------------------------------
// Error class: audience-mismatch
// ---------------------------------------------------------------------------

describe('audience-mismatch', () => {
  it('throws when aud claim does not include the expected audience', async () => {
    const claimError = new joseErrors.JWTClaimValidationFailed(
      'unexpected "aud" claim value',
      {},
      'aud',
      'check_failed',
    );
    mockedJwtVerify.mockRejectedValueOnce(claimError);
    const err = await verifyZitadelBearer(BEARER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZitadelBearerError);
    expect((err as ZitadelBearerError).code).toBe('audience-mismatch');
  });
});

// ---------------------------------------------------------------------------
// Error class: subject-not-allowed
// ---------------------------------------------------------------------------

describe('subject-not-allowed', () => {
  it('throws when preferred_username is not in the allow-list', async () => {
    mockedJwtVerify.mockResolvedValueOnce({
      payload: okPayload({ preferred_username: 'gibson-unknown-sa' }),
      protectedHeader: { alg: 'RS256' },
    } as Awaited<ReturnType<typeof jwtVerify>>);
    const err = await verifyZitadelBearer(BEARER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZitadelBearerError);
    expect((err as ZitadelBearerError).code).toBe('subject-not-allowed');
    // Should reveal the subject in the message (to aid diagnostics) but not the token.
    expect((err as Error).message).toContain('gibson-unknown-sa');
    expect((err as Error).message).not.toContain(FAKE_JWT);
  });

  it('throws when neither preferred_username nor sub is in the allow-list', async () => {
    mockedJwtVerify.mockResolvedValueOnce({
      payload: okPayload({ preferred_username: undefined, sub: '999999' }),
      protectedHeader: { alg: 'RS256' },
    } as Awaited<ReturnType<typeof jwtVerify>>);
    const err = await verifyZitadelBearer(BEARER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZitadelBearerError);
    expect((err as ZitadelBearerError).code).toBe('subject-not-allowed');
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('happy-path', () => {
  it('returns identity when preferred_username matches the allow-list', async () => {
    mockedJwtVerify.mockResolvedValueOnce({
      payload: okPayload(),
      protectedHeader: { alg: 'RS256' },
    } as Awaited<ReturnType<typeof jwtVerify>>);

    const identity = await verifyZitadelBearer(BEARER);
    expect(identity.subject).toBe('gibson-tenant-operator');
    expect(identity.clientId).toBe('123456789');
    expect(identity.tenant).toBeUndefined();
  });

  it('returns identity when numeric sub matches the allow-list (no preferred_username)', async () => {
    setEnv({ ALLOWED_SERVICE_SUBJECTS: '123456789' });
    __resetJWKSForTests();
    vi.mocked(createRemoteJWKSet).mockReturnValue(vi.fn() as unknown as ReturnType<typeof createRemoteJWKSet>);

    mockedJwtVerify.mockResolvedValueOnce({
      payload: okPayload({ preferred_username: undefined }),
      protectedHeader: { alg: 'RS256' },
    } as Awaited<ReturnType<typeof jwtVerify>>);

    const identity = await verifyZitadelBearer(BEARER);
    expect(identity.subject).toBe('123456789');
    expect(identity.clientId).toBe('123456789');
  });

  it('forwards the gibson:tenant custom claim when present', async () => {
    mockedJwtVerify.mockResolvedValueOnce({
      payload: okPayload({ 'gibson:tenant': 'tenant-abc' }),
      protectedHeader: { alg: 'RS256' },
    } as Awaited<ReturnType<typeof jwtVerify>>);

    const identity = await verifyZitadelBearer(BEARER);
    expect(identity.tenant).toBe('tenant-abc');
  });

  it('accepts case-insensitive "Bearer" prefix', async () => {
    mockedJwtVerify.mockResolvedValueOnce({
      payload: okPayload(),
      protectedHeader: { alg: 'RS256' },
    } as Awaited<ReturnType<typeof jwtVerify>>);

    const identity = await verifyZitadelBearer(`bearer ${FAKE_JWT}`);
    expect(identity.subject).toBe('gibson-tenant-operator');
  });
});
