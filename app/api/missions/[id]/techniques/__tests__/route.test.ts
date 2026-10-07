// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Route contract for /api/missions/:id/techniques (dashboard#192,
 * gibson#619): GET keeps the Hypothesis nodes of this mission that name a
 * technique, one row per technique and scope, and answers 401 with no
 * session.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetTenantGraph = vi.fn();
const { mockGetServerSession } = vi.hoisted(() => ({ mockGetServerSession: vi.fn() }));

vi.mock('@/src/lib/auth', () => ({ getServerSession: mockGetServerSession }));
vi.mock('@/src/lib/gibson-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/gibson-client')>();
  return {
    ...actual,
    userClient: vi.fn().mockReturnValue({
      getTenantGraph: (...args: unknown[]) => mockGetTenantGraph(...args),
    }),
  };
});
vi.mock('server-only', () => ({}));

import { GET } from '../route';

function call(missionId: string) {
  const req = new NextRequest(`http://test.local/api/missions/${missionId}/techniques`, {
    method: 'GET',
  });
  return GET(req, { params: Promise.resolve({ id: missionId }) });
}

function hypothesis(props: Record<string, string>) {
  return { id: '1', labels: ['Hypothesis'], properties: props, severity: '' };
}

beforeEach(() => {
  mockGetTenantGraph.mockReset();
  mockGetServerSession.mockReset().mockResolvedValue({ user: { id: 'u1' } });
});

describe('GET /api/missions/:id/techniques', () => {
  it('returns one row per technique and scope of this mission, sorted', async () => {
    mockGetTenantGraph.mockResolvedValue({
      truncated: false,
      nodes: [
        hypothesis({ mission_id: 'm1', scope: 'scope-b', technique: 'T1190' }),
        hypothesis({ mission_id: 'm1', scope: 'scope-a', technique: 'T1190' }),
        // The same technique in the same scope, proposed twice: one row.
        hypothesis({ mission_id: 'm1', scope: 'scope-a', technique: 'T1190' }),
        // Another mission's hypothesis.
        hypothesis({ mission_id: 'm2', scope: 'scope-a', technique: 'T1059' }),
        // A hypothesis with no technique carries no reputation signal.
        hypothesis({ mission_id: 'm1', scope: 'scope-a', technique: '' }),
        hypothesis({ mission_id: 'm1', scope: 'scope-a', technique: 'T1021' }),
        // A node of another label is never a technique.
        { id: '9', labels: ['Host'], properties: { mission_id: 'm1', technique: 'T1' }, severity: '' },
      ],
    });
    const res = await call('m1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      truncated: false,
      techniques: [
        { technique: 'T1021', scopeId: 'scope-a' },
        { technique: 'T1190', scopeId: 'scope-a' },
        { technique: 'T1190', scopeId: 'scope-b' },
      ],
    });
    expect(mockGetTenantGraph).toHaveBeenCalledWith({
      includeLabels: ['Hypothesis'],
      limit: 5000,
    });
  });

  it('reports a truncated read', async () => {
    mockGetTenantGraph.mockResolvedValue({ truncated: true, nodes: [] });
    const res = await call('m1');
    expect(await res.json()).toEqual({ truncated: true, techniques: [] });
  });

  it('answers 401 with no session', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await call('m1');
    expect(res.status).toBe(401);
    expect(mockGetTenantGraph).not.toHaveBeenCalled();
  });
});
