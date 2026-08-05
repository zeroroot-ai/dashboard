/**
 * Tests for GET /signup/verify — the target of the emailed link.
 *
 * Three properties, in order of how much damage getting them wrong does:
 *
 *  1. A successful redemption puts the completion session in an httpOnly
 *     cookie and redirects, so the raw token leaves the address bar and the
 *     capability never becomes readable by client script.
 *  2. Every failure lands on the SAME destination. The daemon answers unknown,
 *     expired and already-spent links identically so redemption cannot be used
 *     to probe which signups exist; a route that told them apart would hand
 *     that oracle back.
 *  3. Nothing billable happens here. The customer and SetupIntent belong to
 *     the completion screen, strictly after this succeeds.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRedeem } = vi.hoisted(() => ({ mockRedeem: vi.fn() }));
vi.mock('@/src/lib/signup/owner-provisioning', () => ({
  redeemSignupVerification: mockRedeem,
}));
vi.mock('@/src/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { NextRequest } from 'next/server';

import { GET } from '../route';
import { SIGNUP_VERIFIED_COOKIE } from '@/src/lib/signup/verified-session';

function request(url: string): NextRequest {
  return new NextRequest(url, {
    headers: { 'x-forwarded-for': '203.0.113.7' },
  });
}

const REDEEMED = {
  verifiedSessionToken: 'sess-1',
  attemptId: 'aaaaaaaa-0000-0000-0000-000000000001',
  ownerEmail: 'ada@example.com',
  workspaceName: 'ada-security',
  tier: 'team',
};

describe('GET /signup/verify', () => {
  beforeEach(() => {
    mockRedeem.mockReset();
  });

  it('redeems the token, sets an httpOnly session cookie, and redirects off the token URL', async () => {
    mockRedeem.mockResolvedValue(REDEEMED);

    const res = await GET(
      request('https://app.example.test/signup/verify?token=raw-token')
    );

    expect(mockRedeem).toHaveBeenCalledWith({
      token: 'raw-token',
      clientIp: '203.0.113.7',
    });
    expect(res.headers.get('location')).toContain('/signup/complete');

    const cookie = res.cookies.get(SIGNUP_VERIFIED_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(JSON.parse(cookie?.value ?? '{}')).toMatchObject({
      verifiedSessionToken: 'sess-1',
      email: 'ada@example.com',
    });

    // The redirect target must not carry the token onward.
    expect(res.headers.get('location')).not.toContain('raw-token');
  });

  it('sends every failure to the same place and sets no cookie', async () => {
    const destinations: string[] = [];

    // Absent token.
    let res = await GET(
      request('https://app.example.test/signup/verify')
    );
    destinations.push(res.headers.get('location') ?? '');
    expect(res.cookies.get(SIGNUP_VERIFIED_COOKIE)).toBeUndefined();

    // Unknown / expired / already-spent — the daemon does not distinguish
    // them, and neither may this route.
    mockRedeem.mockRejectedValue(new Error('this link is no longer valid'));
    res = await GET(
      request('https://app.example.test/signup/verify?token=nope')
    );
    destinations.push(res.headers.get('location') ?? '');
    expect(res.cookies.get(SIGNUP_VERIFIED_COOKIE)).toBeUndefined();

    expect(new Set(destinations).size).toBe(1);
    expect(destinations[0]).toContain('/signup');
  });
});
