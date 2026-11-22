// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * GET /api/findings pages with the daemon's page tokens (dashboard#245,
 * sdk#232). The client sends back the `nextCursor` of the previous page as
 * `cursor`; the route never computes an offset.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetFindings, mockListOpen } = vi.hoisted(() => ({
  mockGetFindings: vi.fn(),
  mockListOpen: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })),
}));
vi.mock('@/src/lib/auth/active-tenant', () => ({
  requireActiveTenant: vi.fn(async () => 't1'),
  activeTenantApiResponse: vi.fn(),
}));
vi.mock('@/src/lib/gibson-client', () => ({
  userClient: () => ({ getFindings: mockGetFindings, listOpenFindings: mockListOpen }),
}));

import { GET } from '../route';

function request(query = ''): NextRequest {
  return new NextRequest(`http://test.local/api/findings${query}`);
}

beforeEach(() => {
  mockGetFindings.mockReset();
  mockListOpen.mockReset();
  mockListOpen.mockResolvedValue({ findings: [], nextPageToken: '' });
});

describe('GET /api/findings page tokens', () => {
  it('asks for the first page with an empty token and returns the next cursor', async () => {
    mockGetFindings.mockResolvedValue({ findings: [], total: BigInt(120), nextPageToken: 'tok-2' });

    const res = await GET(request('?limit=50'));
    const body = await res.json();

    expect(mockGetFindings).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 50, pageToken: '' }),
    );
    expect(body).toMatchObject({ total: 120, limit: 50, nextCursor: 'tok-2', hasMore: true });
  });

  it('passes the cursor back as the page token, and the last page has no cursor', async () => {
    mockGetFindings.mockResolvedValue({ findings: [], total: BigInt(120), nextPageToken: '' });

    const res = await GET(request('?limit=50&cursor=tok-2'));
    const body = await res.json();

    expect(mockGetFindings).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 50, pageToken: 'tok-2' }),
    );
    expect(body.nextCursor).toBeUndefined();
    expect(body.hasMore).toBe(false);
  });
});

describe('GET /api/findings when ListOpenFindings fails', () => {
  it('still returns the findings, with no place and no merge request', async () => {
    mockGetFindings.mockResolvedValue({
      findings: [{ id: 'f1', name: 'A', severity: 'high', labels: [], properties: { status: 'open' } }],
      total: BigInt(1),
      nextPageToken: '',
    });
    mockListOpen.mockRejectedValue(new Error('world unavailable'));

    const res = await GET(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: 'f1', status: 'open' });
    expect(body.data[0].affectedAssets).toBeUndefined();
    expect(body.data[0].mergeRequestUrl).toBeUndefined();
  });
});

describe('GET /api/findings lifecycle fields', () => {
  it('reads the status, the priority and the confidence from properties and the place from the open findings', async () => {
    mockGetFindings.mockResolvedValue({
      findings: [
        {
          id: 'f1',
          name: 'A',
          severity: 'high',
          labels: [],
          properties: { status: 'fixing', priority: 'P1', priority_rule: 'rule-1', confidence: '0.7' },
        },
        { id: 'f2', name: 'B', severity: 'low', labels: [], properties: {} },
      ],
      total: BigInt(2),
      nextPageToken: '',
    });
    mockListOpen.mockResolvedValue({
      findings: [
        {
          id: 'f1',
          places: [{ label: 'billing-api', key: 'app:1' }],
          mergeRequestUrl: 'https://git.example/mr/1',
        },
      ],
      nextPageToken: '',
    });

    const body = await (await GET(request())).json();
    const [a, b] = body.data;

    expect(a).toMatchObject({
      status: 'fixing',
      priority: 'P1',
      priorityRule: 'rule-1',
      confidence: 0.7,
      affectedAssets: ['billing-api'],
      mergeRequestUrl: 'https://git.example/mr/1',
    });
    // No constant: a finding with no data has no status, no place and no link.
    expect(b.status).toBeUndefined();
    expect(b.affectedAssets).toBeUndefined();
    expect(b.mergeRequestUrl).toBeUndefined();
    expect(b.confidence).toBeUndefined();
  });
});
