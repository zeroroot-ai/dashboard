// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Per-route contract test for /api/world/calibration — the ADR-0122
 * reliability/calibration report (dashboard#98). WorldService is mocked via
 * userClient so this is a pure route contract: GET maps the report, clamps the
 * bin count, and 401s when unauthenticated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetCalibration = vi.fn();

const { mockGetServerSession } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/src/lib/gibson-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/gibson-client')>();
  return {
    ...actual,
    userClient: vi.fn().mockReturnValue({
      getCalibration: (...args: unknown[]) => mockGetCalibration(...args),
    }),
  };
});

vi.mock('server-only', () => ({}));

import { GET } from '../route';

const SESSION = { user: { id: 'u1', tenantId: 't1' } };

function getReq(url = 'http://test.local/api/world/calibration'): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

const PROTO_RESPONSE = {
  tenant: 't1',
  overall: {
    technique: '',
    n: 42,
    meanPredicted: 0.61,
    observedFrequency: 0.57,
    brierScore: 0.18,
    bins: [
      { low: 0, high: 0.5, n: 20, meanPredicted: 0.3, observedFrequency: 0.25 },
      { low: 0.5, high: 1, n: 22, meanPredicted: 0.88, observedFrequency: 0.86 },
    ],
  },
  byTechnique: [
    {
      technique: 'http-probe',
      n: 10,
      meanPredicted: 0.7,
      observedFrequency: 0.6,
      brierScore: 0.22,
      bins: [{ low: 0.5, high: 1, n: 10, meanPredicted: 0.7, observedFrequency: 0.6 }],
    },
  ],
  unscored: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue(SESSION);
});

describe('GET /api/world/calibration', () => {
  it('maps the tenant report, overall + per-technique + unscored', async () => {
    mockGetCalibration.mockResolvedValue(PROTO_RESPONSE);

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.tenant).toBe('t1');
    expect(body.overall.n).toBe(42);
    expect(body.overall.brierScore).toBe(0.18);
    expect(body.overall.bins).toHaveLength(2);
    expect(body.byTechnique).toHaveLength(1);
    expect(body.byTechnique[0].technique).toBe('http-probe');
    expect(body.unscored).toBe(3);
  });

  it('defaults bins to 0 (server default) when absent and forwards it', async () => {
    mockGetCalibration.mockResolvedValue(PROTO_RESPONSE);
    await GET(getReq());
    expect(mockGetCalibration).toHaveBeenCalledWith({ bins: 0 });
  });

  it('forwards a valid requested bin count', async () => {
    mockGetCalibration.mockResolvedValue(PROTO_RESPONSE);
    await GET(getReq('http://test.local/api/world/calibration?bins=20'));
    expect(mockGetCalibration).toHaveBeenCalledWith({ bins: 20 });
  });

  it('clamps an over-large bin count to the maximum', async () => {
    mockGetCalibration.mockResolvedValue(PROTO_RESPONSE);
    await GET(getReq('http://test.local/api/world/calibration?bins=9999'));
    expect(mockGetCalibration).toHaveBeenCalledWith({ bins: 50 });
  });

  it('returns a null overall when no bet has settled', async () => {
    mockGetCalibration.mockResolvedValue({ tenant: 't1', overall: undefined, byTechnique: [], unscored: 0 });
    const res = await GET(getReq());
    const body = await res.json();
    expect(body.overall).toBeNull();
    expect(body.byTechnique).toEqual([]);
  });

  it('401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(getReq());
    expect(res.status).toBe(401);
    expect(mockGetCalibration).not.toHaveBeenCalled();
  });
});
