// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { getIncidentReport, getServerSession } = vi.hoisted(() => ({
  getIncidentReport: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({ getServerSession }));
vi.mock('@/src/lib/gibson-client', () => ({ userClient: () => ({ getIncidentReport }) }));

import { GET } from '../route';

const call = (key: string) =>
  GET(new NextRequest('http://test.local/api/incidents/x/report'), { params: Promise.resolve({ key }) });

beforeEach(() => {
  getServerSession.mockResolvedValue({ user: { id: 'u1' } });
  getIncidentReport.mockReset();
  getIncidentReport.mockResolvedValue({
    incidentKey: 'inc/1',
    timelineTotal: BigInt(9),
    alerts: [],
    reached: [],
    actions: [],
    causes: [],
    fixes: [],
    controlIds: [],
  });
});

describe('GET /api/incidents/[key]/report', () => {
  it('reads the report of the decoded key and returns it', async () => {
    const body = await (await call('inc%2F1')).json();
    expect(getIncidentReport).toHaveBeenCalledWith({ incidentKey: 'inc/1' });
    expect(body).toMatchObject({ incidentKey: 'inc/1', timelineTotal: 9 });
  });

  it('answers 401 with no session', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await call('x')).status).toBe(401);
  });
});
