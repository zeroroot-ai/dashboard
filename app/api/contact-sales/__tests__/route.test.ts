/**
 * Per-route contract test for POST /api/contact-sales.
 *
 * The route was restored (dashboard#911 deleted it with the marketing pages)
 * so the marketing site's contact form has an endpoint again. That form is
 * served from a different origin than this app, which is new: the original
 * route was only ever called same-origin.
 *
 * The CORS allowlist is therefore the part worth pinning down. It must grant
 * exactly one origin, WWW_URL, and it must never reflect back whatever the
 * caller put in its Origin header — that would turn the allowlist into a
 * rubber stamp. These tests cover that, plus the surrounding behaviour the
 * form depends on: validation, rate limiting, and dispatch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockCheckRateLimit, mockSend } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock('@/src/lib/rate-limiter', () => ({
  checkRateLimit: mockCheckRateLimit,
  createRateLimitResponse: () =>
    new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 }),
}));

vi.mock('@/src/lib/email/provider', () => ({
  getEmailProvider: () => ({ send: mockSend }),
}));

vi.mock('@/src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const WWW = 'https://www.zeroroot.ai';
const APP = 'https://app.zeroroot.ai';

const VALID_LEAD = {
  name: 'Jane Smith',
  email: 'jane@company.com',
  company: 'Acme Corp',
  companySize: '51-200',
  deployment: 'self-hosted',
  useCase: 'Continuous red teaming',
  timeline: '1-3-months',
};

function post(body: unknown, origin?: string): NextRequest {
  return new NextRequest('https://app.zeroroot.ai/api/contact-sales', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

function options(origin?: string): NextRequest {
  return new NextRequest('https://app.zeroroot.ai/api/contact-sales', {
    method: 'OPTIONS',
    headers: origin ? { origin } : {},
  });
}

describe('POST /api/contact-sales', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockSend.mockResolvedValue(undefined);
    process.env.NEXTAUTH_URL = APP;
    process.env.WWW_URL = WWW;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('accepts a valid lead and dispatches it to the sales inbox', async () => {
    const { POST } = await import('../route');
    const res = await POST(post(VALID_LEAD, WWW));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(mockSend).toHaveBeenCalledTimes(1);

    const message = mockSend.mock.calls[0][0];
    expect(message.to).toBe('sales@zeroroot.ai');
    expect(message.subject).toContain('Acme Corp');
    expect(message.headers['Reply-To']).toBe('jane@company.com');
  });

  it('grants CORS to the configured www origin', async () => {
    const { POST } = await import('../route');
    const res = await POST(post(VALID_LEAD, WWW));

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(WWW);
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('does NOT reflect an unknown origin back', async () => {
    const { POST } = await import('../route');
    const res = await POST(post(VALID_LEAD, 'https://evil.example.com'));

    // No grant at all, rather than a grant naming the attacker's origin.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('emits no CORS headers when WWW_URL is unset (self-hosted)', async () => {
    delete process.env.WWW_URL;
    const { POST } = await import('../route');
    const res = await POST(post(VALID_LEAD, WWW));

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('rejects a malformed lead without sending mail', async () => {
    const { POST } = await import('../route');
    const res = await POST(post({ ...VALID_LEAD, email: 'not-an-email' }, WWW));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rejects an unknown companySize enum value', async () => {
    const { POST } = await import('../route');
    const res = await POST(post({ ...VALID_LEAD, companySize: '9000+' }, WWW));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('honours the rate limiter before doing any work', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false });
    const { POST } = await import('../route');
    const res = await POST(post(VALID_LEAD, WWW));

    expect(res.status).toBe(429);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('OPTIONS /api/contact-sales', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_URL = APP;
    process.env.WWW_URL = WWW;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('answers the preflight for the allowlisted origin', async () => {
    const { OPTIONS } = await import('../route');
    const res = await OPTIONS(options(WWW));

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(WWW);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('refuses the preflight for any other origin', async () => {
    const { OPTIONS } = await import('../route');
    const res = await OPTIONS(options('https://evil.example.com'));

    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
