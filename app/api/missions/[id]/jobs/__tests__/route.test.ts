// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

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

  // dashboard#107: hosted's demo exit test signed a fresh Owner into a fresh
  // tenant, the pod died ~60-90s after the FIRST authenticated /dashboard
  // render with "JavaScript heap out of memory". A stuck ListJobs cursor
  // (same token forever) through the pre-fix `do { ... } while (pageToken
  // !== '')` loop here would never terminate, and would accumulate one copy
  // of every job on the stuck page in memory on every iteration. This proves
  // the fix stops instead of looping forever.
  it('stops instead of looping forever when the daemon repeats the same page token', async () => {
    m.listJobs
      .mockResolvedValueOnce({ jobs: [job('a', { mission_run_id: 'run-1' })], nextPageToken: 'stuck' })
      // A real daemon bug: the "next" page token is identical to the one just
      // consumed. Answered with the SAME job again, forever, if nothing stops it.
      .mockResolvedValue({ jobs: [job('a', { mission_run_id: 'run-1' })], nextPageToken: 'stuck' });

    const res = await GET(new NextRequest('http://x'), params);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    // Two pages' worth of results (the repeat is only detectable after
    // fetching the page that reveals it), not an ever-growing duplicate
    // list: bounded at one extra page, never unbounded.
    expect(body.data.map((j) => j.id)).toEqual(['a', 'a']);
    // Exactly two calls: the first page, then the one that reveals the token
    // repeated. A pre-fix build never reaches this assertion at all, it
    // calls listJobs forever.
    expect(m.listJobs).toHaveBeenCalledTimes(2);
  });

  it('stops instead of looping forever when a page comes back empty but still carries a token', async () => {
    m.listJobs
      .mockResolvedValueOnce({ jobs: [job('a', { mission_run_id: 'run-1' })], nextPageToken: 'p2' })
      // Nothing left to read, but the daemon still claims there is more.
      .mockResolvedValue({ jobs: [], nextPageToken: 'p3' });

    const res = await GET(new NextRequest('http://x'), params);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((j) => j.id)).toEqual(['a']);
    expect(m.listJobs).toHaveBeenCalledTimes(2);
  });
});
