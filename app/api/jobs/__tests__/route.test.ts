import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';

const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  requireActiveTenant: vi.fn(),
  requireCsrf: vi.fn(),
  listJobs: vi.fn(),
  openJob: vi.fn(),
  sendInput: vi.fn(),
  closeJob: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('@/src/lib/auth/active-tenant', () => ({
  requireActiveTenant: m.requireActiveTenant,
  activeTenantApiResponse: () => new Response('{}', { status: 412 }),
}));
vi.mock('@/src/lib/auth/csrf', () => ({
  requireCsrf: m.requireCsrf,
  CsrfError: class CsrfError extends Error {},
  csrfErrorResponse: () => new Response('{}', { status: 403 }),
}));
vi.mock('@/src/lib/gibson-client/jobs', () => ({
  listJobs: m.listJobs,
  openJob: m.openJob,
  sendInput: m.sendInput,
  closeJob: m.closeJob,
  getJob: m.getJob,
  streamJobEvents: vi.fn(),
  toJobEventView: vi.fn(),
}));

import { GET, POST } from '../route';
import { POST as INPUT } from '../[id]/input/route';
import { POST as CLOSE } from '../[id]/close/route';

const params = { params: Promise.resolve({ id: 'j1' }) };
function post(url: string, body: unknown): NextRequest {
  return new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getServerSession.mockResolvedValue({ user: { id: 'u1' } });
  m.requireActiveTenant.mockResolvedValue('t1');
  m.requireCsrf.mockResolvedValue(undefined);
});

describe('GET /api/jobs', () => {
  it('401 without a session', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await GET(new NextRequest('http://x/api/jobs'))).status).toBe(401);
  });
  it('passes the filters and drops an unknown state', async () => {
    m.listJobs.mockResolvedValue({ jobs: [], nextPageToken: '' });
    await GET(new NextRequest('http://x/api/jobs?bankId=b&memberId=m&state=waiting'));
    expect(m.listJobs).toHaveBeenCalledWith({ bankId: 'b', memberId: 'm', state: 'waiting', pageToken: '' });
    await GET(new NextRequest('http://x/api/jobs?state=sideways'));
    expect(m.listJobs).toHaveBeenLastCalledWith(expect.objectContaining({ state: undefined }));
  });
});

describe('POST /api/jobs', () => {
  it('opens a goal-only job and returns 201', async () => {
    m.openJob.mockResolvedValue({ id: 'j1' });
    const res = await POST(post('http://x/api/jobs', { bankId: 'b', memberId: 'mem', goal: 'fix it' }));
    expect(res.status).toBe(201);
    expect(m.openJob).toHaveBeenCalledWith('b', 'mem', 'fix it');
  });
  it('400 on an empty goal', async () => {
    expect((await POST(post('http://x/api/jobs', { bankId: 'b', memberId: '', goal: '' }))).status).toBe(400);
    expect(m.openJob).not.toHaveBeenCalled();
  });
  it('maps the daemon PERMISSION_DENIED (no can_send) to 403', async () => {
    m.openJob.mockRejectedValue(new ConnectError('no', Code.PermissionDenied));
    expect((await POST(post('http://x/api/jobs', { bankId: 'b', memberId: '', goal: 'g' }))).status).toBe(403);
  });
});

describe('POST /api/jobs/:id/input and /close', () => {
  it('sends a turn and an answer, never a wrap-up', async () => {
    m.sendInput.mockResolvedValue({ id: 'i1' });
    expect((await INPUT(post('http://x/api/jobs/j1/input', { message: 'go', kind: 'turn' }), params)).status).toBe(201);
    expect(m.sendInput).toHaveBeenCalledWith('j1', 'go', 'turn');
    expect((await INPUT(post('http://x/api/jobs/j1/input', { message: 'yes', kind: 'answer' }), params)).status).toBe(201);
    expect((await INPUT(post('http://x/api/jobs/j1/input', { message: 'x', kind: 'wrap_up' }), params)).status).toBe(400);
  });
  it('closes with a verdict and a score, and refuses an out-of-range score', async () => {
    m.closeJob.mockResolvedValue({ id: 'j1' });
    expect((await CLOSE(post('http://x/api/jobs/j1/close', { verdict: 'failed', score: 0.2 }), params)).status).toBe(200);
    expect(m.closeJob).toHaveBeenCalledWith('j1', 'failed', 0.2);
    expect((await CLOSE(post('http://x/api/jobs/j1/close', { verdict: 'accomplished', score: 2 }), params)).status).toBe(400);
  });
  it('403 without the CSRF token', async () => {
    const { CsrfError } = await import('@/src/lib/auth/csrf');
    const Ctor = CsrfError as unknown as new (message: string) => Error;
    m.requireCsrf.mockRejectedValue(new Ctor('missing'));
    expect((await CLOSE(post('http://x/api/jobs/j1/close', { verdict: 'failed', score: 0 }), params)).status).toBe(403);
    expect(m.closeJob).not.toHaveBeenCalled();
  });
});
