/**
 * Unit tests for `verifyCaptcha` in src/lib/auth/captcha.ts.
 *
 * Uses vi.stubGlobal('fetch', ...) to intercept outbound HTTP so the tests
 * are fully offline and deterministic. Each test asserts the request the
 * module sent to the provider in addition to the parsed return value, so
 * that regressions in param encoding or URL choice are caught.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest';
import {
  verifyCaptcha,
  __resetDisabledWarningForTests,
} from '../captcha';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function captureFetch(
  impl: (url: string, init: RequestInit) => Promise<Response>,
): { fetch: Mock; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const mock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return impl(url, init);
  });
  vi.stubGlobal('fetch', mock);
  return { fetch: mock, calls };
}

function readFormBody(init: RequestInit): URLSearchParams {
  const body = init.body;
  if (body instanceof URLSearchParams) return body;
  if (typeof body === 'string') return new URLSearchParams(body);
  throw new Error(`unexpected body type: ${typeof body}`);
}

describe('verifyCaptcha', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Start every test from a clean env + fresh warning flag so tests
    // stay independent and order-invariant.
    process.env = { ...originalEnv };
    delete process.env.DASHBOARD_CAPTCHA_PROVIDER;
    delete process.env.DASHBOARD_CAPTCHA_SECRET_KEY;
    __resetDisabledWarningForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  describe('disabled mode', () => {
    it('throws when provider env var is unset (one-code-path/206, explicit choice required)', async () => {
      // Spec one-code-path/206: DASHBOARD_CAPTCHA_PROVIDER is REQUIRED at
      // boot. An unset provider is no longer silently equivalent to
      // "disabled", operators must opt in or out explicitly. The
      // env-validator catches this at instrumentation.register(); this
      // test asserts the per-call defence stays consistent with the
      // boot-time contract.
      delete process.env.DASHBOARD_CAPTCHA_PROVIDER;
      await expect(verifyCaptcha('anything')).rejects.toThrow(
        /DASHBOARD_CAPTCHA_PROVIDER is required/,
      );
    });

    it('returns ok:true and emits the startup warning exactly once', async () => {
      process.env.DASHBOARD_CAPTCHA_PROVIDER = 'disabled';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const r1 = await verifyCaptcha('t1');
      const r2 = await verifyCaptcha('t2');
      const r3 = await verifyCaptcha('t3');

      expect(r1).toEqual({ ok: true });
      expect(r2).toEqual({ ok: true });
      expect(r3).toEqual({ ok: true });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        '[captcha] WARNING: CAPTCHA disabled; set DASHBOARD_CAPTCHA_PROVIDER to enable',
      );
    });

    it('treats an unknown provider value as disabled', async () => {
      process.env.DASHBOARD_CAPTCHA_PROVIDER = 'recaptcha-v3';
      const { fetch } = captureFetch(async () =>
        jsonResponse({ success: false }),
      );

      const result = await verifyCaptcha('token');
      expect(result).toEqual({ ok: true });
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('turnstile', () => {
    beforeEach(() => {
      process.env.DASHBOARD_CAPTCHA_PROVIDER = 'turnstile';
      process.env.DASHBOARD_CAPTCHA_SECRET_KEY = 'turnstile-secret';
    });

    it('posts secret/response/remoteip to Cloudflare and returns ok on success', async () => {
      const { calls } = captureFetch(async () =>
        jsonResponse({ success: true, score: 0.9 }),
      );

      const result = await verifyCaptcha('tok-abc', '203.0.113.5');

      expect(result).toEqual({ ok: true, score: 0.9 });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      );
      expect(calls[0].init.method).toBe('POST');
      const body = readFormBody(calls[0].init);
      expect(body.get('secret')).toBe('turnstile-secret');
      expect(body.get('response')).toBe('tok-abc');
      expect(body.get('remoteip')).toBe('203.0.113.5');
    });

    it('omits remoteip when not provided', async () => {
      const { calls } = captureFetch(async () =>
        jsonResponse({ success: true }),
      );

      const result = await verifyCaptcha('tok-noip');

      expect(result).toEqual({ ok: true });
      const body = readFormBody(calls[0].init);
      expect(body.has('remoteip')).toBe(false);
    });

    it('returns ok:false with joined error-codes when success is false', async () => {
      captureFetch(async () =>
        jsonResponse({
          success: false,
          'error-codes': ['invalid-input-response', 'timeout-or-duplicate'],
        }),
      );

      const result = await verifyCaptcha('bad', '198.51.100.1');

      expect(result).toEqual({
        ok: false,
        reason: 'invalid-input-response,timeout-or-duplicate',
      });
    });

    it('returns ok:false with a fallback reason when provider omits error-codes', async () => {
      captureFetch(async () => jsonResponse({ success: false }));

      const result = await verifyCaptcha('bad');

      expect(result).toEqual({ ok: false, reason: 'verification_failed' });
    });

    it('returns ok:false on non-200 response', async () => {
      captureFetch(async () =>
        jsonResponse({ success: false }, { status: 502 }),
      );

      const result = await verifyCaptcha('tok');

      expect(result).toEqual({ ok: false, reason: 'http_502' });
    });

    it('returns ok:false with reason:missing_secret when secret is unset', async () => {
      delete process.env.DASHBOARD_CAPTCHA_SECRET_KEY;
      const { fetch } = captureFetch(async () =>
        jsonResponse({ success: true }),
      );

      const result = await verifyCaptcha('tok');

      expect(result).toEqual({ ok: false, reason: 'missing_secret' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('returns ok:false with reason:missing_token on empty token', async () => {
      const { fetch } = captureFetch(async () =>
        jsonResponse({ success: true }),
      );

      const result = await verifyCaptcha('');

      expect(result).toEqual({ ok: false, reason: 'missing_token' });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('returns ok:false with reason:bad_json when provider returns invalid JSON', async () => {
      captureFetch(
        async () =>
          new Response('<!doctype html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          }),
      );

      const result = await verifyCaptcha('tok');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('bad_json');
      }
    });
  });

  describe('hcaptcha', () => {
    beforeEach(() => {
      process.env.DASHBOARD_CAPTCHA_PROVIDER = 'hcaptcha';
      process.env.DASHBOARD_CAPTCHA_SECRET_KEY = 'hcaptcha-secret';
    });

    it('posts to hCaptcha siteverify and returns ok with score on success', async () => {
      const { calls } = captureFetch(async () =>
        jsonResponse({ success: true, score: 0.42 }),
      );

      const result = await verifyCaptcha('hc-tok', '198.51.100.10');

      expect(result).toEqual({ ok: true, score: 0.42 });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://api.hcaptcha.com/siteverify');
      const body = readFormBody(calls[0].init);
      expect(body.get('secret')).toBe('hcaptcha-secret');
      expect(body.get('response')).toBe('hc-tok');
      expect(body.get('remoteip')).toBe('198.51.100.10');
    });

    it('returns ok:false with joined error-codes when success is false', async () => {
      captureFetch(async () =>
        jsonResponse({
          success: false,
          'error-codes': ['invalid-input-response'],
        }),
      );

      const result = await verifyCaptcha('hc-bad');

      expect(result).toEqual({
        ok: false,
        reason: 'invalid-input-response',
      });
    });

    it('returns ok:false on non-200 response', async () => {
      captureFetch(async () =>
        jsonResponse({ success: false }, { status: 500 }),
      );

      const result = await verifyCaptcha('hc-tok');

      expect(result).toEqual({ ok: false, reason: 'http_500' });
    });
  });

  describe('network failures', () => {
    beforeEach(() => {
      process.env.DASHBOARD_CAPTCHA_PROVIDER = 'turnstile';
      process.env.DASHBOARD_CAPTCHA_SECRET_KEY = 'turnstile-secret';
    });

    it('returns ok:false with reason:timeout when the request is aborted', async () => {
      captureFetch(async () => {
        // Simulate the fetch call being aborted, the runtime would
        // throw a DOMException with name 'AbortError'; we emulate that
        // contract here without relying on real timer plumbing.
        const err = new Error('The operation was aborted.');
        (err as Error & { name: string }).name = 'AbortError';
        throw err;
      });

      const result = await verifyCaptcha('tok');

      expect(result).toEqual({ ok: false, reason: 'timeout' });
    });

    it('returns ok:false with reason:fetch_error on generic network failure', async () => {
      captureFetch(async () => {
        throw new TypeError('network down');
      });

      const result = await verifyCaptcha('tok');

      expect(result).toEqual({ ok: false, reason: 'fetch_error' });
    });
  });
});
