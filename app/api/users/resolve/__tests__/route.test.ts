// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetServerSession, mockRequireActiveTenant, mockResolveUsers } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockRequireActiveTenant: vi.fn(),
  mockResolveUsers: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({ getServerSession: mockGetServerSession }));
vi.mock('@/src/lib/auth/active-tenant', () => ({
  requireActiveTenant: mockRequireActiveTenant,
  activeTenantApiResponse: () => new Response(null, { status: 412 }),
}));
vi.mock('@/src/lib/gibson-client/transport', () => ({
  userClient: () => ({ resolveUsers: mockResolveUsers }),
}));

import { GET, parseIds } from '../route';
import { UserRefState } from '@/src/gen/gibson/tenant/v1/user_pb';

function req(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/users/resolve${query}`);
}

describe('GET /api/users/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: 'me' } });
    mockRequireActiveTenant.mockResolvedValue('acme');
  });

  it('maps the daemon answer: a member has a name, a person who left is "removed"', async () => {
    mockResolveUsers.mockResolvedValue({
      users: [
        { userId: 'alice', state: UserRefState.MEMBER, displayName: 'Alice Ng', email: 'alice@example.com' },
        { userId: 'gone', state: UserRefState.REMOVED, displayName: '', email: '' },
      ],
    });
    const res = await GET(req('?ids=alice,gone,alice'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { userId: string; state: string; displayName: string }[] };
    expect(mockResolveUsers).toHaveBeenCalledWith({ userIds: ['alice', 'gone'] });
    expect(body.data).toEqual([
      { userId: 'alice', state: 'member', displayName: 'Alice Ng', email: 'alice@example.com' },
      { userId: 'gone', state: 'removed', displayName: '', email: '' },
    ]);
  });

  it('answers an empty list without a daemon call, and refuses more than 100 ids', async () => {
    const empty = await GET(req(''));
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { data: unknown[] }).data).toEqual([]);
    expect(mockResolveUsers).not.toHaveBeenCalled();

    const many = Array.from({ length: 101 }, (_, i) => `u${i}`).join(',');
    const res = await GET(req(`?ids=${many}`));
    expect(res.status).toBe(400);
    expect(mockResolveUsers).not.toHaveBeenCalled();
  });

  it('needs a session and an active tenant', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    expect((await GET(req('?ids=a'))).status).toBe(401);
    mockRequireActiveTenant.mockRejectedValueOnce(new Error('no tenant'));
    expect((await GET(req('?ids=a'))).status).toBe(412);
  });
});

describe('parseIds', () => {
  it('splits, trims, drops empties and repeats', () => {
    expect(parseIds(' a, b ,,a,')).toEqual(['a', 'b']);
    expect(parseIds(null)).toEqual([]);
  });
});
