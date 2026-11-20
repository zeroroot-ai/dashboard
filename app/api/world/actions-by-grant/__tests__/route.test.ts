// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listActionsByGrant, getServerSession } = vi.hoisted(() => ({
  listActionsByGrant: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({ getServerSession }));
vi.mock('@/src/lib/gibson-client', () => ({ userClient: () => ({ listActionsByGrant }) }));

import { GET } from '../route';

beforeEach(() => {
  getServerSession.mockResolvedValue({ user: { id: 'u1' } });
  listActionsByGrant.mockResolvedValue({
    truncated: false,
    groups: [
      { grantObject: 'connector:git', grantRelation: 'can_use', grantor: 'u2', refused: false, count: 2, agents: ['a'], tools: ['t'] },
    ],
  });
});

describe('GET /api/world/actions-by-grant', () => {
  it('returns the groups of the daemon with no range, so the daemon default applies', async () => {
    const body = await (await GET()).json();
    expect(listActionsByGrant).toHaveBeenCalledWith({});
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]).toMatchObject({ grantor: 'u2', count: 2 });
  });

  it('answers 401 with no session', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
});
