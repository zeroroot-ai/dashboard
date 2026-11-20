// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listWaitingOnPerson, getServerSession } = vi.hoisted(() => ({
  listWaitingOnPerson: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({ getServerSession }));
vi.mock('@/src/lib/gibson-client', () => ({ userClient: () => ({ listWaitingOnPerson }) }));

import { GET } from '../route';

beforeEach(() => {
  getServerSession.mockResolvedValue({ user: { id: 'u1' } });
  listWaitingOnPerson.mockResolvedValue({
    items: [
      { kind: 'merge_refused', id: 'f1', since: { seconds: BigInt(1_700_000_000), nanos: 0 }, waitedSeconds: BigInt(90) },
      { kind: 'next_scan', id: 'f2', waitedSeconds: BigInt(5) },
    ],
  });
});

describe('GET /api/world/waiting', () => {
  it('returns each item with its time and wait, and an empty time when the daemon sends none', async () => {
    const body = await (await GET()).json();
    expect(body.items).toEqual([
      { kind: 'merge_refused', id: 'f1', since: '2023-11-14T22:13:20.000Z', waitedSeconds: 90 },
      { kind: 'next_scan', id: 'f2', since: '', waitedSeconds: 5 },
    ]);
  });

  it('answers 401 with no session', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
});
