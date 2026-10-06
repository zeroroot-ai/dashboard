// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * GET /api/findings pages with the daemon's page tokens (dashboard#245,
 * sdk#232). The client sends back the `nextCursor` of the previous page as
 * `cursor`; the route never computes an offset.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetFindings } = vi.hoisted(() => ({ mockGetFindings: vi.fn() }));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })),
}));
vi.mock('@/src/lib/auth/active-tenant', () => ({
  requireActiveTenant: vi.fn(async () => 't1'),
  activeTenantApiResponse: vi.fn(),
}));
vi.mock('@/src/lib/gibson-client', () => ({
  userClient: () => ({ getFindings: mockGetFindings }),
}));

import { GET } from '../route';

function request(query = ''): NextRequest {
  return new NextRequest(`http://test.local/api/findings${query}`);
}

beforeEach(() => {
  mockGetFindings.mockReset();
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
