// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Route contract for /api/world/reputation (dashboard#192, gibson#619): GET
 * reads prior and has_record, refuses a request with no
 * technique, and answers 401 with no session.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetReputation = vi.fn();
const { mockGetServerSession } = vi.hoisted(() => ({ mockGetServerSession: vi.fn() }));

vi.mock('@/src/lib/auth', () => ({ getServerSession: mockGetServerSession }));
vi.mock('@/src/lib/gibson-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/gibson-client')>();
  return {
    ...actual,
    userClient: vi.fn().mockReturnValue({
      getReputation: (...args: unknown[]) => mockGetReputation(...args),
    }),
  };
});
vi.mock('server-only', () => ({}));

import { GET } from '../route';

function getReq(query: string): NextRequest {
  return new NextRequest(`http://test.local/api/world/reputation${query}`, { method: 'GET' });
}

beforeEach(() => {
  mockGetReputation.mockReset();
  mockGetServerSession.mockReset().mockResolvedValue({ user: { id: 'u1' } });
});

describe('GET /api/world/reputation', () => {
  it('returns the prior strength and whether a track record exists', async () => {
    mockGetReputation.mockResolvedValue({ prior: 0.72, hasRecord: true });
    const res = await GET(getReq('?technique=T1190&scope=scope-a'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      technique: 'T1190',
      scopeId: 'scope-a',
      priorStrength: 0.72,
      hasTrackRecord: true,
    });
    expect(mockGetReputation).toHaveBeenCalledWith({ technique: 'T1190', scopeId: 'scope-a' });
  });

  it('refuses a request with no technique', async () => {
    const res = await GET(getReq('?scope=scope-a'));
    expect(res.status).toBe(400);
    expect(mockGetReputation).not.toHaveBeenCalled();
  });

  it('answers 401 with no session', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(getReq('?technique=T1190&scope=scope-a'));
    expect(res.status).toBe(401);
  });
});
