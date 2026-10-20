// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Contract test for GET /api/world. The daemon pages every list with
 * page_size and page_token, so the route must follow next_page_token. A
 * route that reads only the first response returns 100 rows at most.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Code, ConnectError } from '@connectrpc/connect';

const world = {
  listMissions: vi.fn(),
  listHosts: vi.fn(),
  listFindings: vi.fn(),
  listLlmCalls: vi.fn(),
  getTimeline: vi.fn(),
};

const { mockGetServerSession } = vi.hoisted(() => ({ mockGetServerSession: vi.fn() }));

vi.mock('@/src/lib/auth', () => ({ getServerSession: mockGetServerSession }));
vi.mock('@/src/lib/gibson-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/gibson-client')>();
  return { ...actual, userClient: vi.fn(() => world) };
});
vi.mock('server-only', () => ({}));

import { GET } from '../route';

const empty = (key: string) => ({ [key]: [], nextPageToken: '' });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
  world.listMissions.mockResolvedValue(empty('missions'));
  world.listHosts.mockResolvedValue(empty('hosts'));
  world.listFindings.mockResolvedValue(empty('findings'));
  world.listLlmCalls.mockResolvedValue(empty('llmCalls'));
  world.getTimeline.mockResolvedValue(empty('events'));
});

const req = (q = '') => new NextRequest(`http://test.local/api/world${q}`);

describe('GET /api/world paging', () => {
  it('returns the hosts of every page', async () => {
    world.listHosts
      .mockResolvedValueOnce({ hosts: [{ scopeId: 's1', address: 'a' }], nextPageToken: 'p2' })
      .mockResolvedValueOnce({ hosts: [{ scopeId: 's2', address: 'b' }], nextPageToken: '' });

    const body = await (await GET(req())).json();

    expect(body.hosts.map((h: { scopeId: string }) => h.scopeId)).toEqual(['s1', 's2']);
    expect(world.listHosts.mock.calls[1][0]).toMatchObject({ pageToken: 'p2' });
  });

  it('returns the timeline events of every page, in order', async () => {
    world.getTimeline
      .mockResolvedValueOnce({ events: [{ seq: BigInt(1), kind: 'k', summary: 'a' }], nextPageToken: 't2' })
      .mockResolvedValueOnce({ events: [{ seq: BigInt(2), kind: 'k', summary: 'b' }], nextPageToken: '' });

    const body = await (await GET(req('?mission=m1'))).json();

    expect(body.timeline.map((e: { seq: number }) => e.seq)).toEqual([1, 2]);
    expect(world.getTimeline.mock.calls[0][0]).toMatchObject({ missionId: 'm1', pageToken: '' });
    expect(world.getTimeline.mock.calls[1][0]).toMatchObject({ missionId: 'm1', pageToken: 't2' });
  });

  it('restarts the timeline once when the daemon refuses its page token', async () => {
    world.getTimeline
      .mockResolvedValueOnce({ events: [{ seq: BigInt(1), kind: 'k', summary: 'a' }], nextPageToken: 't2' })
      .mockRejectedValueOnce(new ConnectError('token is for another run', Code.InvalidArgument))
      .mockResolvedValueOnce({ events: [{ seq: BigInt(5), kind: 'k', summary: 'e' }], nextPageToken: '' });

    const res = await GET(req('?mission=m1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.timeline.map((e: { seq: number }) => e.seq)).toEqual([5]);
    expect(world.getTimeline.mock.calls[2][0]).toMatchObject({ pageToken: '' });
  });
});
