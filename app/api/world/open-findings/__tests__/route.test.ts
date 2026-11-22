// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { listOpenFindings, getServerSession } = vi.hoisted(() => ({
  listOpenFindings: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({ getServerSession }));
vi.mock('@/src/lib/gibson-client', () => ({ userClient: () => ({ listOpenFindings }) }));

import { GET } from '../route';

const req = (q = '') => new NextRequest(`http://test.local/api/world/open-findings${q}`);

const view = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `title ${id}`,
  severity: 'high',
  status: 'fixing',
  priority: 'P1',
  priorityRule: 'rule',
  confidence: 0.5,
  mergeRequestUrl: 'https://git.example/mr/1',
  mergeRequest: 'mr-1',
  places: [{ label: 'web', key: 'k1' }],
  address: '10.0.0.1',
  ...over,
});

beforeEach(() => {
  getServerSession.mockResolvedValue({ user: { id: 'u1' } });
  listOpenFindings.mockReset();
  listOpenFindings.mockResolvedValue({ findings: [view('f1'), view('f2')], nextPageToken: 'next' });
});

describe('GET /api/world/open-findings', () => {
  it('returns the findings in the order of the daemon and the next cursor', async () => {
    const body = await (await GET(req())).json();
    expect(body.findings.map((f: { id: string }) => f.id)).toEqual(['f1', 'f2']);
    expect(body.findings[0]).toMatchObject({ status: 'fixing', priority: 'P1', places: [{ label: 'web', key: 'k1' }] });
    expect(body.nextCursor).toBe('next');
  });

  it('sends the limit and the cursor to the daemon and bounds the limit', async () => {
    await GET(req('?limit=25&cursor=tok'));
    expect(listOpenFindings).toHaveBeenLastCalledWith({ pageSize: 25, pageToken: 'tok' });
    await GET(req('?limit=99999'));
    expect(listOpenFindings).toHaveBeenLastCalledWith({ pageSize: 1000, pageToken: '' });
  });

  it('drops an unsafe merge request URL and leaves no cursor on the last page', async () => {
    listOpenFindings.mockResolvedValue({
      findings: [view('f1', { mergeRequestUrl: 'javascript:alert(1)' })],
      nextPageToken: '',
    });
    const body = await (await GET(req())).json();
    expect(body.findings[0].mergeRequestUrl).toBe('');
    expect(body.nextCursor).toBeUndefined();
  });

  it('answers 401 with no session', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    expect(listOpenFindings).not.toHaveBeenCalled();
  });
});
