/**
 * Tests for the HIBP breach check. All HTTP traffic is mocked via `vi.fn` on
 * `globalThis.fetch` — no real network calls are made. The tests assert both
 * the k-anonymity contract (only the 5-char prefix is sent) and the
 * fail-open behaviour on timeout / non-200 / disabled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isPasswordBreached } from '../hibp';

// Distinctive sentinel so we can assert the password string itself never
// appears anywhere in the outgoing request URL. A plain word like "password"
// would give a false positive because "pwnedpasswords.com" contains it.
//
// SHA-1("hunter2-super-secret-sentinel") = D862825C8C05184D32BF1020A1E3EFEBD535A36D
// prefix5 = "D8628", suffix35 = "25C8C05184D32BF1020A1E3EFEBD535A36D"
const PASSWORD = 'hunter2-super-secret-sentinel';
const PASSWORD_PREFIX = 'D8628';
const PASSWORD_SUFFIX = '25C8C05184D32BF1020A1E3EFEBD535A36D';

// Helper: mocked Response
function textResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

describe('isPasswordBreached', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.DASHBOARD_HIBP_ENABLED;

  beforeEach(() => {
    delete process.env.DASHBOARD_HIBP_ENABLED;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env.DASHBOARD_HIBP_ENABLED;
    } else {
      process.env.DASHBOARD_HIBP_ENABLED = originalEnv;
    }
    vi.restoreAllMocks();
  });

  it('sends only the first 5 hex chars of the SHA-1 hash to the network', async () => {
    const fetchMock = vi.fn(async () =>
      textResponse(200, `${PASSWORD_SUFFIX}:42\r\n0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n`),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await isPasswordBreached(PASSWORD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(`https://api.pwnedpasswords.com/range/${PASSWORD_PREFIX}`);
    // The URL must NOT include the suffix or the full hash.
    expect(calledUrl).not.toContain(PASSWORD_SUFFIX);
    expect(calledUrl).not.toContain(`${PASSWORD_PREFIX}${PASSWORD_SUFFIX}`);
    // The password itself must never appear in any part of the request.
    expect(calledUrl).not.toContain(PASSWORD);
    // Headers must include Add-Padding and a User-Agent.
    const headers = init.headers as Record<string, string>;
    expect(headers['Add-Padding']).toBe('true');
    expect(headers['User-Agent']).toBe('gibson-dashboard');
    // An AbortSignal must be wired for the timeout.
    expect(init.signal).toBeDefined();
  });

  it('returns breached:true with the correct count on a positive match', async () => {
    const body = [
      '0018A45C4D1DEF81644B54AB7F969B88D65:1',
      `${PASSWORD_SUFFIX}:12345`,
      '00C6CB5F1B737126B70D0E785EC52A381B5:0', // padding row, unrelated suffix
    ].join('\r\n');
    globalThis.fetch = vi.fn(async () => textResponse(200, body)) as unknown as typeof fetch;

    const result = await isPasswordBreached(PASSWORD);

    expect(result).toEqual({ breached: true, count: 12345 });
  });

  it('returns breached:false when no line in the range matches the suffix', async () => {
    const body = [
      '0018A45C4D1DEF81644B54AB7F969B88D65:1',
      '00C6CB5F1B737126B70D0E785EC52A381B5:2',
    ].join('\r\n');
    globalThis.fetch = vi.fn(async () => textResponse(200, body)) as unknown as typeof fetch;

    const result = await isPasswordBreached(PASSWORD);

    expect(result).toEqual({ breached: false, count: 0 });
  });

  it('returns breached:false when the matching row is a padding row (count 0)', async () => {
    // HIBP's Add-Padding mode returns synthetic rows with count 0. A matching
    // suffix with count 0 must be treated as NOT breached.
    const body = `${PASSWORD_SUFFIX}:0\r\n0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n`;
    globalThis.fetch = vi.fn(async () => textResponse(200, body)) as unknown as typeof fetch;

    const result = await isPasswordBreached(PASSWORD);

    expect(result).toEqual({ breached: false, count: 0 });
  });

  it('returns breached:unknown with reason containing "timeout" on AbortError', async () => {
    const abortErr = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    });
    globalThis.fetch = vi.fn(async () => {
      throw abortErr;
    }) as unknown as typeof fetch;

    const result = await isPasswordBreached(PASSWORD);

    expect(result.breached).toBe('unknown');
    if (result.breached === 'unknown') {
      expect(result.reason).toContain('timeout');
    }
  });

  it('returns breached:unknown on a non-200 response', async () => {
    globalThis.fetch = vi.fn(async () =>
      textResponse(503, 'Service Unavailable'),
    ) as unknown as typeof fetch;

    const result = await isPasswordBreached(PASSWORD);

    expect(result.breached).toBe('unknown');
    if (result.breached === 'unknown') {
      expect(result.reason).toBe('http_503');
    }
  });

  it('returns breached:unknown on a generic fetch error (network down)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const result = await isPasswordBreached(PASSWORD);

    expect(result.breached).toBe('unknown');
    if (result.breached === 'unknown') {
      expect(result.reason).toBe('fetch_error');
    }
  });

  it('short-circuits to unknown/disabled and does NOT call fetch when DASHBOARD_HIBP_ENABLED=false', async () => {
    process.env.DASHBOARD_HIBP_ENABLED = 'false';
    const fetchMock = vi.fn(async () => textResponse(200, ''));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await isPasswordBreached(PASSWORD);

    expect(result).toEqual({ breached: 'unknown', reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats unset env as enabled (default-on)', async () => {
    delete process.env.DASHBOARD_HIBP_ENABLED;
    const fetchMock = vi.fn(async () =>
      textResponse(200, `${PASSWORD_SUFFIX}:7\r\n`),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await isPasswordBreached(PASSWORD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ breached: true, count: 7 });
  });

  it('treats any non-"false" env value as enabled', async () => {
    process.env.DASHBOARD_HIBP_ENABLED = 'true';
    const fetchMock = vi.fn(async () =>
      textResponse(200, `${PASSWORD_SUFFIX}:3\r\n`),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await isPasswordBreached(PASSWORD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ breached: true, count: 3 });
  });

  it('matches a suffix returned in lowercase (case-insensitive comparison)', async () => {
    const body = `${PASSWORD_SUFFIX.toLowerCase()}:99\r\n`;
    globalThis.fetch = vi.fn(async () => textResponse(200, body)) as unknown as typeof fetch;

    const result = await isPasswordBreached(PASSWORD);

    expect(result).toEqual({ breached: true, count: 99 });
  });
});
