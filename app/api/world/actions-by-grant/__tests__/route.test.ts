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
    nextPageToken: '',
    groups: [
      { grantObject: 'connector:git', grantRelation: 'can_use', grantor: 'u2', refused: false, count: 2, agents: ['a'], tools: ['t'] },
    ],
  });
});

describe('GET /api/world/actions-by-grant', () => {
  it('returns the groups of the daemon with no range, so the daemon default applies', async () => {
    const body = await (await GET()).json();
    expect(listActionsByGrant).toHaveBeenCalledWith(expect.not.objectContaining({ from: expect.anything(), to: expect.anything() }));
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]).toMatchObject({ grantor: 'u2', count: 2 });
  });

  it('reads every page and joins the groups', async () => {
    const g = (grantor: string) => ({ grantObject: 'o', grantRelation: 'r', grantor, refused: false, count: 1, agents: [], tools: [] });
    listActionsByGrant.mockReset();
    listActionsByGrant
      .mockResolvedValueOnce({ groups: [g('u1')], truncated: false, nextPageToken: 'p2' })
      .mockResolvedValueOnce({ groups: [g('u2')], truncated: true, nextPageToken: '' });
    const body = await (await GET()).json();
    expect(listActionsByGrant).toHaveBeenCalledTimes(2);
    expect(listActionsByGrant.mock.calls[1][0]).toMatchObject({ pageToken: 'p2' });
    expect(body.groups.map((x: { grantor: string }) => x.grantor)).toEqual(['u1', 'u2']);
    expect(body.truncated).toBe(true);
  });

  it('answers 401 with no session', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
});
