/**
 * Rate limiter tests.
 *
 * Two properties carry the security weight and are covered here:
 *
 *  1. X-Forwarded-For parsing must read the rightmost-trusted entry. Reading
 *     the leftmost means reading a value the caller writes, which turns the
 *     limiter into both a bypass (rotate the value) and a lockout primitive
 *     (pin it to a victim's IP).
 *
 *  2. Budget is consumed only by requests that are inside it. A limiter that
 *     records refused attempts never drains its own window, so one blocked
 *     source stays blocked forever.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  checkRateLimitByKey,
  clearRateLimitStore,
  initializeRateLimiter,
  resolveClientIp,
} from '../rate-limiter';

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe('resolveClientIp', () => {
  it('reads the only entry when one trusted proxy is in front', () => {
    expect(resolveClientIp(headers({ 'x-forwarded-for': '203.0.113.7' }), 1)).toBe(
      '203.0.113.7',
    );
  });

  it('ignores a spoofed leftmost entry and reads the proxy-written one', () => {
    // The caller sent `X-Forwarded-For: 1.2.3.4`; Envoy appended the address it
    // actually saw. The spoof must not be what we key the limit on.
    const ip = resolveClientIp(
      headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }),
      1,
    );
    expect(ip).toBe('203.0.113.7');
    expect(ip).not.toBe('1.2.3.4');
  });

  it('ignores an arbitrarily long forged prefix', () => {
    const forged = Array.from({ length: 50 }, (_, i) => `10.0.0.${i}`).join(', ');
    expect(
      resolveClientIp(headers({ 'x-forwarded-for': `${forged}, 203.0.113.7` }), 1),
    ).toBe('203.0.113.7');
  });

  it('honours a two-proxy topology (CDN in front of Envoy)', () => {
    expect(
      resolveClientIp(
        headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7, 198.51.100.9' }),
        2,
      ),
    ).toBe('203.0.113.7');
  });

  it('does not trust x-real-ip when a proxy is expected', () => {
    // No XFF means the request did not traverse Envoy, so x-real-ip is just a
    // caller-supplied header and must not become a bucket name.
    expect(resolveClientIp(headers({ 'x-real-ip': '1.2.3.4' }), 1)).toBe('unidentified');
  });

  it('honours x-real-ip only when there is no proxy at all', () => {
    expect(resolveClientIp(headers({ 'x-real-ip': '203.0.113.7' }), 0)).toBe(
      '203.0.113.7',
    );
  });

  it('treats the whole header as untrusted when there is no proxy', () => {
    expect(resolveClientIp(headers({ 'x-forwarded-for': '1.2.3.4' }), 0)).toBe(
      'unidentified',
    );
  });

  it('rejects a non-IP entry rather than keying a limit on it', () => {
    expect(
      resolveClientIp(headers({ 'x-forwarded-for': 'not-an-ip' }), 1),
    ).toBe('unidentified');
    expect(
      resolveClientIp(headers({ 'x-forwarded-for': '999.1.1.1' }), 1),
    ).toBe('unidentified');
  });

  it('strips a port and normalises IPv6', () => {
    expect(resolveClientIp(headers({ 'x-forwarded-for': '203.0.113.7:44321' }), 1)).toBe(
      '203.0.113.7',
    );
    expect(
      resolveClientIp(headers({ 'x-forwarded-for': '[2001:DB8::1]:443' }), 1),
    ).toBe('2001:db8::1');
  });

  it('falls back to the leftmost only when the chain is shorter than configured', () => {
    // Fewer hops than expected: index clamps to 0, which is still the value the
    // single real proxy wrote.
    expect(resolveClientIp(headers({ 'x-forwarded-for': '203.0.113.7' }), 3)).toBe(
      '203.0.113.7',
    );
  });

  it('returns the shared bucket when no source headers are present', () => {
    expect(resolveClientIp(headers({}), 1)).toBe('unidentified');
  });
});

describe('budget consumption ordering', () => {
  beforeEach(() => {
    initializeRateLimiter(null);
    clearRateLimitStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearRateLimitStore();
  });

  const config = { maxRequests: 2, windowSeconds: 60, algorithm: 'sliding_window' as const };

  it('allows exactly the configured budget', async () => {
    expect((await checkRateLimitByKey('k', config)).allowed).toBe(true);
    expect((await checkRateLimitByKey('k', config)).allowed).toBe(true);
    expect((await checkRateLimitByKey('k', config)).allowed).toBe(false);
  });

  it('consumes exactly one unit per call', async () => {
    const first = await checkRateLimitByKey('k', config);
    expect(first.remaining).toBe(1);
    const second = await checkRateLimitByKey('k', config);
    expect(second.remaining).toBe(0);
  });

  it('does NOT consume budget on a refused request, so a blocked key drains', async () => {
    // Exhaust the budget at t0.
    await checkRateLimitByKey('k', config);
    await checkRateLimitByKey('k', config);

    // Keep hammering while genuinely blocked, spread across the window
    // (t0+5s .. t0+25s). This is the real attack shape: sustained pressure
    // from a source that is already being refused.
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(5_000);
      expect((await checkRateLimitByKey('k', config)).allowed).toBe(false);
    }

    // t0 + 65s: both ACCEPTED requests are now outside the 60s window, so the
    // bucket must have drained. If refused attempts had been recorded, the
    // youngest of them (t0+25s) would still be inside the window and this key
    // would stay locked out. Sustained pressure would then keep re-arming the
    // window forever, which combined with a spoofable source identity is a
    // lockout primitive against any chosen victim.
    vi.advanceTimersByTime(40_000);
    expect((await checkRateLimitByKey('k', config)).allowed).toBe(true);
  });

  it('does not let one key drain another key\'s budget', async () => {
    await checkRateLimitByKey('victim', config);
    await checkRateLimitByKey('victim', config);
    expect((await checkRateLimitByKey('victim', config)).allowed).toBe(false);

    // An unrelated source must be entirely unaffected.
    expect((await checkRateLimitByKey('other', config)).allowed).toBe(true);
  });

  it('applies the same ordering to the fixed window', async () => {
    const fixed = { maxRequests: 1, windowSeconds: 60, algorithm: 'fixed_window' as const };
    expect((await checkRateLimitByKey('f', fixed)).allowed).toBe(true);
    for (let i = 0; i < 10; i += 1) {
      expect((await checkRateLimitByKey('f', fixed)).allowed).toBe(false);
    }
    vi.advanceTimersByTime(61_000);
    expect((await checkRateLimitByKey('f', fixed)).allowed).toBe(true);
  });
});

describe('shared store', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  afterEach(() => {
    initializeRateLimiter(null);
    clearRateLimitStore();
  });

  it('uses the injected store when one is present', async () => {
    const consume = vi.fn().mockResolvedValue({
      allowed: false,
      current: 99,
      resetInSeconds: 42,
    });
    initializeRateLimiter({ consume });

    const result = await checkRateLimitByKey('k', { maxRequests: 5, windowSeconds: 60 });

    expect(consume).toHaveBeenCalledWith('k', 5, 60);
    expect(result.allowed).toBe(false);
    expect(result.resetIn).toBe(42);
  });

  it('falls back to the in-process limit when the store errors', async () => {
    initializeRateLimiter({ consume: vi.fn().mockRejectedValue(new Error('down')) });

    const result = await checkRateLimitByKey('k', { maxRequests: 5, windowSeconds: 60 });
    expect(result.allowed).toBe(true);
  });

  it('rethrows for fail-closed callers instead of silently degrading', async () => {
    initializeRateLimiter({ consume: vi.fn().mockRejectedValue(new Error('down')) });

    await expect(
      checkRateLimitByKey('k', { maxRequests: 5, windowSeconds: 60 }, { failClosed: true }),
    ).rejects.toThrow('down');
  });
});
