/**
 * @vitest-environment node
 *
 * Unit tests for `src/lib/spiffe/jwt-svid.ts`.
 *
 * Covered acceptance criteria (from Req 1 in requirements.md):
 *   1. Happy path: cold fetch → validate → cache → reuse without a second fetch.
 *   2. Stale-while-revalidate: when cached token is within 30 min of expiry,
 *      the cached token is returned and a background refresh fires.
 *   3. SpireUnreachableError on gRPC timeout (DEADLINE_EXCEEDED).
 *   4. SpireNotConfiguredError when the socket path does not exist.
 *   5. Token with exp − iat > 3600 s is rejected at mint time.
 *   6. Token with wrong audience is rejected at mint time.
 *   7. Token with malformed sub (non-SPIFFE URI) is rejected at mint time.
 *
 * DI strategy:
 *   - `workload-api-proto` is mocked via vi.mock so we control what
 *     `fetchJWTSVID` returns without opening any real sockets.
 *   - `fs.statSync` is stubbed so tests never touch the real filesystem.
 *   - vitest fake timers advance `Date.now()` for TTL / refresh scenarios.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockedFunction,
} from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the module under test is imported.
// ---------------------------------------------------------------------------

// Mock the proto client module so no real gRPC connections are made.
vi.mock('../workload-api-proto', () => ({
  fetchJWTSVID: vi.fn(),
}));

// Mock fs so statSync never touches the real filesystem.
vi.mock('fs', () => ({
  statSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock declarations)
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import { fetchJWTSVID } from '../workload-api-proto';
import {
  getSpiffeJwt,
  SpireNotConfiguredError,
  SpireUnreachableError,
  __clearCacheForTests,
} from '../jwt-svid';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOCKET_PATH = 'unix:///run/spire/sockets/agent.sock';
const AUDIENCE = 'spiffe://gibson.io/platform/daemon';
const SPIFFE_SUB = 'spiffe://gibson.io/platform/dashboard';

/**
 * Build a fake compact JWT with the given payload. The signature component
 * is left as a static placeholder — `decodeJwt` (jose) only base64-decodes
 * the payload; it does not verify signatures.
 */
function makeFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

/** Shorthand for a valid JWT payload anchored at `nowS`. */
function validPayload(nowS: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    iss: 'spiffe://gibson.io',
    sub: SPIFFE_SUB,
    aud: [AUDIENCE],
    iat: nowS,
    exp: nowS + 3_600,
    ...overrides,
  };
}

const mockFetchJWTSVID = fetchJWTSVID as MockedFunction<typeof fetchJWTSVID>;
const mockStatSync = fs.statSync as unknown as MockedFunction<() => fs.Stats>;

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  __clearCacheForTests();

  // Default: socket exists (statSync succeeds).
  mockStatSync.mockReturnValue({} as fs.Stats);

  // Default socket path via env.
  process.env['SPIFFE_ENDPOINT_SOCKET'] = SOCKET_PATH;
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  delete process.env['SPIFFE_ENDPOINT_SOCKET'];
});

// ---------------------------------------------------------------------------
// 1. Happy path — cold fetch, validate, cache, reuse
// ---------------------------------------------------------------------------

describe('happy path', () => {
  it('fetches a token on cold cache and returns it', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    const jwt = makeFakeJwt(validPayload(nowS));
    mockFetchJWTSVID.mockResolvedValueOnce(jwt);

    const result = await getSpiffeJwt({ audience: AUDIENCE });

    expect(result).toBe(jwt);
    expect(mockFetchJWTSVID).toHaveBeenCalledOnce();
    expect(mockFetchJWTSVID).toHaveBeenCalledWith(
      [AUDIENCE],
      SOCKET_PATH,
      5_000,
    );
  });

  it('returns the cached token on a second call without re-fetching', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    const jwt = makeFakeJwt(validPayload(nowS));
    mockFetchJWTSVID.mockResolvedValueOnce(jwt);

    const first = await getSpiffeJwt({ audience: AUDIENCE });
    const second = await getSpiffeJwt({ audience: AUDIENCE });

    expect(first).toBe(jwt);
    expect(second).toBe(jwt);
    // fetchJWTSVID must have been called exactly once — second call is cached.
    expect(mockFetchJWTSVID).toHaveBeenCalledOnce();
  });

  it('maintains separate cache entries per audience', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    const jwtA = makeFakeJwt(validPayload(nowS, { aud: [AUDIENCE] }));
    const audienceB = 'spiffe://gibson.io/platform/other';
    const jwtB = makeFakeJwt(validPayload(nowS, { aud: [audienceB] }));

    mockFetchJWTSVID
      .mockResolvedValueOnce(jwtA)
      .mockResolvedValueOnce(jwtB);

    const resA = await getSpiffeJwt({ audience: AUDIENCE });
    const resB = await getSpiffeJwt({ audience: audienceB });

    expect(resA).toBe(jwtA);
    expect(resB).toBe(jwtB);
    expect(mockFetchJWTSVID).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Stale-while-revalidate: refresh triggered when < 30 min before expiry
// ---------------------------------------------------------------------------

describe('stale-while-revalidate TTL refresh', () => {
  it('returns stale token and kicks off background refresh when within 30 min of expiry', async () => {
    // Mint a token at t=0.
    const startMs = Date.now();
    const startS = Math.floor(startMs / 1000);
    const jwt = makeFakeJwt(validPayload(startS));
    mockFetchJWTSVID.mockResolvedValueOnce(jwt);

    await getSpiffeJwt({ audience: AUDIENCE });
    expect(mockFetchJWTSVID).toHaveBeenCalledOnce();

    // Prepare the refreshed token for the background fetch.
    const laterS = startS + 3600; // new token minted at expiry-time
    const freshJwt = makeFakeJwt(validPayload(laterS));
    mockFetchJWTSVID.mockResolvedValueOnce(freshJwt);

    // Advance clock to 31 min before the original token expires (29 min into
    // the token's life — triggers the 30-min-lead refresh window).
    // Token expires at startMs + 3600*1000. We want to be at expiry - 29*60*1000.
    const advanceMs = (3_600 - 29 * 60) * 1_000; // 31 min into token life
    vi.advanceTimersByTime(advanceMs);

    // Second call — should return stale token immediately and start refresh.
    const staleResult = await getSpiffeJwt({ audience: AUDIENCE });
    expect(staleResult).toBe(jwt); // stale token returned immediately

    // Allow the background Promise microtasks to run.
    await vi.runAllTimersAsync();

    // Now a third call should receive the fresh token.
    const freshResult = await getSpiffeJwt({ audience: AUDIENCE });
    expect(freshResult).toBe(freshJwt);
    expect(mockFetchJWTSVID).toHaveBeenCalledTimes(2);
  });

  it('does not fire a second background refresh while one is already in flight', async () => {
    const startS = Math.floor(Date.now() / 1000);
    const jwt = makeFakeJwt(validPayload(startS));

    // The background refresh takes a while to resolve.
    let resolveRefresh!: (v: string) => void;
    const pendingRefresh = new Promise<string>((res) => { resolveRefresh = res; });

    mockFetchJWTSVID
      .mockResolvedValueOnce(jwt)       // initial mint
      .mockReturnValueOnce(pendingRefresh); // slow background refresh

    await getSpiffeJwt({ audience: AUDIENCE });

    // Advance into the refresh window.
    vi.advanceTimersByTime((3_600 - 29 * 60) * 1_000);

    // First call into the refresh window — kicks off background refresh.
    const r1 = await getSpiffeJwt({ audience: AUDIENCE });
    expect(r1).toBe(jwt);

    // Second call into the refresh window while refresh is still in flight.
    const r2 = await getSpiffeJwt({ audience: AUDIENCE });
    expect(r2).toBe(jwt);

    // fetchJWTSVID should have been called exactly twice total (initial + one background).
    expect(mockFetchJWTSVID).toHaveBeenCalledTimes(2);

    // Let the background refresh finish.
    const laterS = startS + 3_600;
    const freshJwt = makeFakeJwt(validPayload(laterS));
    resolveRefresh(freshJwt);
    await vi.runAllTimersAsync();
  });

  it('blocks on an expired cached token (past exp) and fetches a new one', async () => {
    const startS = Math.floor(Date.now() / 1000);
    const jwt = makeFakeJwt(validPayload(startS));
    mockFetchJWTSVID.mockResolvedValueOnce(jwt);

    await getSpiffeJwt({ audience: AUDIENCE });

    // Advance past expiry.
    vi.advanceTimersByTime(3_600 * 1_000 + 1);

    const newS = Math.floor(Date.now() / 1000);
    const freshJwt = makeFakeJwt(validPayload(newS));
    mockFetchJWTSVID.mockResolvedValueOnce(freshJwt);

    const result = await getSpiffeJwt({ audience: AUDIENCE });
    expect(result).toBe(freshJwt);
    expect(mockFetchJWTSVID).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 3. SpireUnreachableError on gRPC timeout
// ---------------------------------------------------------------------------

describe('SpireUnreachableError', () => {
  it('throws SpireUnreachableError when fetchJWTSVID rejects with DEADLINE_EXCEEDED', async () => {
    const grpcDeadlineError = Object.assign(new Error('Deadline exceeded'), { code: 4 });
    mockFetchJWTSVID.mockRejectedValueOnce(grpcDeadlineError);

    await expect(getSpiffeJwt({ audience: AUDIENCE })).rejects.toThrow(SpireUnreachableError);
  });

  it('throws SpireUnreachableError when fetchJWTSVID rejects with UNAVAILABLE', async () => {
    const grpcUnavailableError = Object.assign(new Error('Connection refused'), { code: 14 });
    mockFetchJWTSVID.mockRejectedValueOnce(grpcUnavailableError);

    await expect(getSpiffeJwt({ audience: AUDIENCE })).rejects.toThrow(SpireUnreachableError);
  });

  it('includes the socket path in the error message', async () => {
    const grpcError = Object.assign(new Error('timeout'), { code: 4 });
    mockFetchJWTSVID.mockRejectedValueOnce(grpcError);

    const err = await getSpiffeJwt({ audience: AUDIENCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpireUnreachableError);
    expect((err as Error).message).toContain(SOCKET_PATH);
  });
});

// ---------------------------------------------------------------------------
// 4. SpireNotConfiguredError on missing socket
// ---------------------------------------------------------------------------

describe('SpireNotConfiguredError', () => {
  it('throws SpireNotConfiguredError synchronously when the socket path does not exist', async () => {
    mockStatSync.mockImplementationOnce(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    await expect(getSpiffeJwt({ audience: AUDIENCE })).rejects.toThrow(SpireNotConfiguredError);
    // fetchJWTSVID must NOT have been called — error is pre-flight.
    expect(mockFetchJWTSVID).not.toHaveBeenCalled();
  });

  it('includes the socket path in the error message', async () => {
    mockStatSync.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });

    const err = await getSpiffeJwt({ audience: AUDIENCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpireNotConfiguredError);
    expect((err as Error).message).toContain(SOCKET_PATH);
  });

  it('uses the SPIFFE_ENDPOINT_SOCKET env var for the path check', async () => {
    process.env['SPIFFE_ENDPOINT_SOCKET'] = 'unix:///custom/spire.sock';

    mockStatSync.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });

    const err = await getSpiffeJwt({ audience: AUDIENCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpireNotConfiguredError);
    expect((err as Error).message).toContain('unix:///custom/spire.sock');
  });
});

// ---------------------------------------------------------------------------
// 5. Token rejected: exp − iat > 3600 s
// ---------------------------------------------------------------------------

describe('token TTL validation', () => {
  it('throws when exp − iat exceeds 3600 seconds', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    const badJwt = makeFakeJwt({
      iss: 'spiffe://gibson.io',
      sub: SPIFFE_SUB,
      aud: [AUDIENCE],
      iat: nowS,
      exp: nowS + 3_601, // one second over the limit
    });
    mockFetchJWTSVID.mockResolvedValueOnce(badJwt);

    await expect(getSpiffeJwt({ audience: AUDIENCE })).rejects.toThrow(
      /TTL 3601s exceeds the maximum/,
    );
  });

  it('accepts a token with exp − iat exactly 3600 s', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    const jwt = makeFakeJwt(validPayload(nowS)); // exp = nowS + 3600
    mockFetchJWTSVID.mockResolvedValueOnce(jwt);

    await expect(getSpiffeJwt({ audience: AUDIENCE })).resolves.toBe(jwt);
  });
});

// ---------------------------------------------------------------------------
// 6. Token rejected: wrong audience
// ---------------------------------------------------------------------------

describe('audience validation', () => {
  it('throws when aud does not contain the requested audience', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    const badJwt = makeFakeJwt({
      iss: 'spiffe://gibson.io',
      sub: SPIFFE_SUB,
      aud: ['spiffe://gibson.io/platform/other'],
      iat: nowS,
      exp: nowS + 3_600,
    });
    mockFetchJWTSVID.mockResolvedValueOnce(badJwt);

    await expect(getSpiffeJwt({ audience: AUDIENCE })).rejects.toThrow(
      /audience does not contain expected audience/,
    );
  });

  it('accepts a token whose aud array contains the expected audience among others', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    // SPIFFE allows multiple audiences; the check is "contains", not "equals".
    const jwt = makeFakeJwt({
      ...validPayload(nowS),
      aud: [AUDIENCE, 'spiffe://gibson.io/platform/other'],
    });
    mockFetchJWTSVID.mockResolvedValueOnce(jwt);

    await expect(getSpiffeJwt({ audience: AUDIENCE })).resolves.toBe(jwt);
  });
});

// ---------------------------------------------------------------------------
// 7. Token rejected: malformed sub
// ---------------------------------------------------------------------------

describe('subject validation', () => {
  it('throws when sub is not a SPIFFE URI', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    const badJwt = makeFakeJwt({
      ...validPayload(nowS),
      sub: 'notaspiffeuri',
    });
    mockFetchJWTSVID.mockResolvedValueOnce(badJwt);

    await expect(getSpiffeJwt({ audience: AUDIENCE })).rejects.toThrow(
      /does not match the expected pattern spiffe:\/\//,
    );
  });

  it('throws when sub has no workload path after the trust domain', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    // Missing trailing slash + workload path → pattern requires spiffe://<domain>/
    const badJwt = makeFakeJwt({
      ...validPayload(nowS),
      sub: 'spiffe://gibson.io', // no trailing slash + path
    });
    mockFetchJWTSVID.mockResolvedValueOnce(badJwt);

    await expect(getSpiffeJwt({ audience: AUDIENCE })).rejects.toThrow(
      /does not match the expected pattern spiffe:\/\//,
    );
  });

  it('throws when sub is missing entirely', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    const { sub: _omit, ...rest } = validPayload(nowS);
    const badJwt = makeFakeJwt(rest);
    mockFetchJWTSVID.mockResolvedValueOnce(badJwt);

    await expect(getSpiffeJwt({ audience: AUDIENCE })).rejects.toThrow(
      /does not match the expected pattern spiffe:\/\//,
    );
  });

  it('accepts a valid SPIFFE URI with a deep workload path', async () => {
    const nowS = Math.floor(Date.now() / 1000);
    const jwt = makeFakeJwt({
      ...validPayload(nowS),
      sub: 'spiffe://gibson.io/platform/dashboard/v2',
    });
    mockFetchJWTSVID.mockResolvedValueOnce(jwt);

    await expect(getSpiffeJwt({ audience: AUDIENCE })).resolves.toBe(jwt);
  });
});
