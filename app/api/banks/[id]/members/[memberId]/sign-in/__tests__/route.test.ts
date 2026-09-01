import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';

const m = vi.hoisted(() => ({ getServerSession: vi.fn(), requireActiveTenant: vi.fn(), requireCsrf: vi.fn(), startSignIn: vi.fn(), submitSignInCode: vi.fn() }));
vi.mock('@/src/lib/auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('@/src/lib/auth/active-tenant', () => ({ requireActiveTenant: m.requireActiveTenant, activeTenantApiResponse: () => new Response('{}', { status: 412 }) }));
vi.mock('@/src/lib/auth/csrf', () => ({ requireCsrf: m.requireCsrf, CsrfError: class CsrfError extends Error {}, csrfErrorResponse: () => new Response('{}', { status: 403 }) }));
vi.mock('@/src/lib/gibson-client/banks', () => ({ startSignIn: m.startSignIn, submitSignInCode: m.submitSignInCode, streamSignIn: vi.fn() }));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/src/lib/logger', () => ({ logger: loggerMock }));

import { POST as START } from '../route';
import { POST as CODE } from '../code/route';

const params = { params: Promise.resolve({ id: 'b1', memberId: 'm1' }) };
const post = (url: string, body?: unknown) =>
  new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  m.getServerSession.mockResolvedValue({ user: { id: 'u1' } });
  m.requireActiveTenant.mockResolvedValue('t1');
  m.requireCsrf.mockResolvedValue(undefined);
});

describe('sign-in relay routes', () => {
  it('start asks the daemon and maps the owner refusal to 403', async () => {
    m.startSignIn.mockResolvedValue({ id: 'm1', state: 'needs_sign_in' });
    expect((await START(post('http://x'), params)).status).toBe(200);
    expect(m.startSignIn).toHaveBeenCalledWith('b1', 'm1');
    m.startSignIn.mockRejectedValue(new ConnectError('not the owner', Code.PermissionDenied));
    expect((await START(post('http://x'), params)).status).toBe(403);
  });

  it('code passes the code on and never logs it', async () => {
    m.submitSignInCode.mockResolvedValue({ id: 'm1' });
    const res = await CODE(post('http://x', { code: 'ABCD-1234' }), params);
    expect(res.status).toBe(200);
    expect(m.submitSignInCode).toHaveBeenCalledWith('b1', 'm1', 'ABCD-1234');
    const logged = JSON.stringify([loggerMock.info.mock.calls, loggerMock.warn.mock.calls, loggerMock.error.mock.calls]);
    expect(logged).not.toContain('ABCD-1234');
  });

  it('code refuses an empty code and maps Unimplemented (C9 not landed) to 501', async () => {
    expect((await CODE(post('http://x', { code: '  ' }), params)).status).toBe(400);
    m.submitSignInCode.mockRejectedValue(new ConnectError('later', Code.Unimplemented));
    expect((await CODE(post('http://x', { code: 'x' }), params)).status).toBe(501);
  });

  it('both refuse without the CSRF token and without a session', async () => {
    const { CsrfError } = await import('@/src/lib/auth/csrf');
    const Ctor = CsrfError as unknown as new (message: string) => Error;
    m.requireCsrf.mockRejectedValueOnce(new Ctor('missing'));
    expect((await START(post('http://x'), params)).status).toBe(403);
    m.getServerSession.mockResolvedValue(null);
    expect((await CODE(post('http://x', { code: 'x' }), params)).status).toBe(401);
    expect(m.submitSignInCode).not.toHaveBeenCalled();
  });
});
