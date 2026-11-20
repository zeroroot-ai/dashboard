// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getExposureTrend, getRevertRate, getServerSession } = vi.hoisted(() => ({
  getExposureTrend: vi.fn(),
  getRevertRate: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({ getServerSession }));
vi.mock('@/src/lib/gibson-client', () => ({
  userClient: () => ({ getExposureTrend, getRevertRate }),
}));

import { GET } from '../route';

beforeEach(() => {
  getServerSession.mockResolvedValue({ user: { id: 'u1' } });
  getExposureTrend.mockResolvedValue({
    periodSeconds: BigInt(604800),
    count: 3,
    medianSeconds: BigInt(600),
    medianAgentSeconds: BigInt(400),
    medianWaitSeconds: BigInt(200),
    previousCount: 0,
    previousMedianSeconds: BigInt(0),
  });
  getRevertRate.mockResolvedValue({
    periodSeconds: BigInt(604800),
    current: { merged: 4, reverted: 1, rate: 0.25 },
    previous: { merged: 0, reverted: 0, rate: 0 },
  });
});

describe('GET /api/world/exposure', () => {
  it('asks for one week and returns the numbers of the daemon', async () => {
    const body = await (await GET()).json();
    expect(getExposureTrend).toHaveBeenCalledWith({ periodSeconds: BigInt(604800) });
    expect(getRevertRate).toHaveBeenCalledWith({ periodSeconds: BigInt(604800) });
    expect(body.exposure).toMatchObject({ count: 3, medianSeconds: 600, medianAgentSeconds: 400, medianWaitSeconds: 200 });
    expect(body.revert.current).toEqual({ merged: 4, reverted: 1, rate: 0.25 });
  });

  it('answers 401 with no session', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
});
