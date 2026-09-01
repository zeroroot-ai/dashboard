import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({ getServerSession: vi.fn(), requireActiveTenant: vi.fn(), listJobs: vi.fn() }));
vi.mock('@/src/lib/auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('@/src/lib/auth/active-tenant', () => ({ requireActiveTenant: m.requireActiveTenant, activeTenantApiResponse: () => new Response('{}', { status: 412 }) }));
vi.mock('@/src/lib/gibson-client/jobs', () => ({ listJobs: m.listJobs }));

import { GET } from '../route';

const params = { params: Promise.resolve({ id: 'run-1' }) };
const job = (id: string, ctx: Record<string, string>) => ({ id, spec: { context: ctx } });

beforeEach(() => {
  vi.clearAllMocks();
  m.getServerSession.mockResolvedValue({ user: { id: 'u1' } });
  m.requireActiveTenant.mockResolvedValue('t1');
});

describe('GET /api/missions/:id/jobs', () => {
  it('401 without a session', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await GET(new NextRequest('http://x'), params)).status).toBe(401);
  });
  it('keeps only the jobs whose context names this run, across pages', async () => {
    m.listJobs
      .mockResolvedValueOnce({ jobs: [job('a', { mission_run_id: 'run-1' }), job('b', { mission_run_id: 'run-2' })], nextPageToken: 'p2' })
      .mockResolvedValueOnce({ jobs: [job('c', { mission_run_id: 'run-1', node_id: 'fix' }), job('d', {})], nextPageToken: '' });
    const res = await GET(new NextRequest('http://x'), params);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((j) => j.id)).toEqual(['a', 'c']);
    expect(m.listJobs).toHaveBeenCalledTimes(2);
    expect(m.listJobs).toHaveBeenLastCalledWith({ pageToken: 'p2' });
  });
});
