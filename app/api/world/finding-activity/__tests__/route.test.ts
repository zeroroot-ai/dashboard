// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { getTimeline, getExposure, getServerSession } = vi.hoisted(() => ({
  getTimeline: vi.fn(),
  getExposure: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({ getServerSession }));
vi.mock('@/src/lib/gibson-client', () => ({ userClient: () => ({ getTimeline, getExposure }) }));

import { GET } from '../route';

const req = (q: string) => new NextRequest(`http://test.local/api/world/finding-activity${q}`);

beforeEach(() => {
  getServerSession.mockResolvedValue({ user: { id: 'u1' } });
  getTimeline.mockReset();
  getTimeline.mockResolvedValue({
    events: [
      { seq: BigInt(0), kind: 'finding.raised', summary: '{ID:f1 At:2026-11-20 10:00:00 +0000 UTC}' },
      { seq: BigInt(1), kind: 'finding.raised', summary: '{ID:f2 At:2026-11-20 10:00:00 +0000 UTC}' },
    ],
    nextPageToken: '',
  });
  getExposure.mockResolvedValue({
    found: true,
    verified: false,
    totalSeconds: BigInt(100),
    waitSeconds: BigInt(40),
    agentSeconds: BigInt(60),
  });
});

describe('GET /api/world/finding-activity', () => {
  it('reads the tenant Timeline, keeps the events of the finding and returns its exposure', async () => {
    const body = await (await GET(req('?finding=f1'))).json();
    expect(getTimeline).toHaveBeenCalledWith(expect.objectContaining({ missionId: '' }));
    expect(getExposure).toHaveBeenCalledWith({ findingId: 'f1' });
    expect(body.events).toEqual([
      { seq: 0, kind: 'finding.raised', time: '2026-11-20T10:00:00.000Z', label: 'Raised' },
    ]);
    expect(body.exposure).toEqual({ found: true, verified: false, totalSeconds: 100, waitSeconds: 40, agentSeconds: 60 });
    expect(body.truncated).toBe(false);
  });

  it('answers 400 with no finding and 401 with no session', async () => {
    expect((await GET(req(''))).status).toBe(400);
    getServerSession.mockResolvedValue(null);
    expect((await GET(req('?finding=f1'))).status).toBe(401);
  });
});
