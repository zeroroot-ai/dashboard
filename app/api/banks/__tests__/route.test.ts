/**
 * /api/banks route tests (gibson#1706 lane E1): the session and tenant
 * floor, CSRF on the write, body validation that mirrors the daemon store,
 * and the mapping of the client wrapper's result.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';

// vi.mock factories are hoisted above every import, so the mocks they close
// over must be hoisted too.
const {
  mockGetServerSession,
  mockRequireActiveTenant,
  mockListBanks,
  mockCreateBank,
  mockGetBank,
  mockDeleteBank,
  mockUpdateBank,
  mockRequireCsrf,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockRequireActiveTenant: vi.fn(),
  mockListBanks: vi.fn(),
  mockCreateBank: vi.fn(),
  mockGetBank: vi.fn(),
  mockDeleteBank: vi.fn(),
  mockUpdateBank: vi.fn(),
  mockRequireCsrf: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({ getServerSession: mockGetServerSession }));
vi.mock('@/src/lib/auth/active-tenant', () => ({
  requireActiveTenant: mockRequireActiveTenant,
  activeTenantApiResponse: () => new Response(JSON.stringify({ error: 'no-active-tenant' }), { status: 412 }),
}));
vi.mock('@/src/lib/auth/csrf', () => ({
  requireCsrf: mockRequireCsrf,
  CsrfError: class CsrfError extends Error {},
  csrfErrorResponse: () => new Response(JSON.stringify({ error: 'csrf-token-required' }), { status: 403 }),
}));
vi.mock('@/src/lib/gibson-client/banks', () => ({
  listBanks: mockListBanks,
  createBank: mockCreateBank,
  getBank: mockGetBank,
  deleteBank: mockDeleteBank,
  updateBank: mockUpdateBank,
  listMembers: vi.fn(),
}));

import { GET, POST } from '../route';
import { DELETE, PATCH } from '../[id]/route';

const bank = {
  id: 'b1', tenantId: 't1', owner: { kind: 'user', id: 'u1' }, name: 'crew', desiredCount: 1,
  loginShape: 'subscription', providerConfigName: '', agentName: 'claude', model: '', maxJobsInFlight: 1,
  staleLimitSeconds: null, spillPolicy: 'queue', createdAt: null, updatedAt: null,
};

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/banks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: 'crew', tenantOwned: false, desiredCount: 2, loginShape: 'subscription', providerConfigName: '',
  agentName: 'claude', model: '', maxJobsInFlight: 1, staleLimitMinutes: 45, spillPolicy: 'queue',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { id: 'u1' } });
  mockRequireActiveTenant.mockResolvedValue('t1');
  mockRequireCsrf.mockResolvedValue(undefined);
});

describe('GET /api/banks', () => {
  it('401 without a session', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/api/banks'));
    expect(res.status).toBe(401);
    expect(mockListBanks).not.toHaveBeenCalled();
  });

  it('412 without an active tenant', async () => {
    mockRequireActiveTenant.mockRejectedValue(new Error('no tenant'));
    const res = await GET(new NextRequest('http://localhost/api/banks'));
    expect(res.status).toBe(412);
  });

  it('returns the page the wrapper mapped', async () => {
    mockListBanks.mockResolvedValue({ banks: [bank], nextPageToken: 'n' });
    const res = await GET(new NextRequest('http://localhost/api/banks?pageToken=p'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [bank], nextPageToken: 'n' });
    expect(mockListBanks).toHaveBeenCalledWith('p');
  });

  it('maps a daemon PERMISSION_DENIED to 403', async () => {
    mockListBanks.mockRejectedValue(new ConnectError('no', Code.PermissionDenied));
    const res = await GET(new NextRequest('http://localhost/api/banks'));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/banks', () => {
  it('403 without the CSRF token', async () => {
    const { CsrfError } = await import('@/src/lib/auth/csrf');
    // The mocked class takes one argument; the real one takes two.
    const Ctor = CsrfError as unknown as new (message: string) => Error;
    mockRequireCsrf.mockRejectedValue(new Ctor('missing'));
    const res = await POST(post(validBody));
    expect(res.status).toBe(403);
    expect(mockCreateBank).not.toHaveBeenCalled();
  });

  it('400 for a tenant-owned subscription bank, the daemon store refuses it too', async () => {
    const res = await POST(post({ ...validBody, tenantOwned: true }));
    expect(res.status).toBe(400);
    expect(mockCreateBank).not.toHaveBeenCalled();
  });

  it('400 for a third-party shape without a provider configuration', async () => {
    const res = await POST(post({ ...validBody, loginShape: 'foundry' }));
    expect(res.status).toBe(400);
  });

  it('201 and passes the shape names and the stale limit in seconds', async () => {
    mockCreateBank.mockResolvedValue(bank);
    const res = await POST(post({ ...validBody, loginShape: 'bedrock', providerConfigName: 'aws-prod', tenantOwned: true }));
    expect(res.status).toBe(201);
    expect(mockCreateBank).toHaveBeenCalledWith(
      expect.objectContaining({ loginShape: 'bedrock', providerConfigName: 'aws-prod', tenantOwned: true, staleLimitSeconds: 2700, spillPolicy: 'queue' }),
    );
    expect(await res.json()).toEqual({ data: bank });
  });
});

describe('PATCH and DELETE /api/banks/:id', () => {
  const params = { params: Promise.resolve({ id: 'b1' }) };

  it('PATCH sends the partial in seconds and returns the bank', async () => {
    mockUpdateBank.mockResolvedValue(bank);
    const req = new NextRequest('http://localhost/api/banks/b1', { method: 'PATCH', body: JSON.stringify({ desiredCount: 3, staleLimitMinutes: 10 }) });
    const res = await PATCH(req, params);
    expect(res.status).toBe(200);
    expect(mockUpdateBank).toHaveBeenCalledWith('b1', { desiredCount: 3, maxJobsInFlight: undefined, staleLimitSeconds: 600, spillPolicy: undefined });
  });

  it('DELETE returns 204 and 404 when the daemon says NOT_FOUND', async () => {
    mockDeleteBank.mockResolvedValue(undefined);
    const req = new NextRequest('http://localhost/api/banks/b1', { method: 'DELETE' });
    expect((await DELETE(req, params)).status).toBe(204);
    mockDeleteBank.mockRejectedValue(new ConnectError('gone', Code.NotFound));
    expect((await DELETE(req, params)).status).toBe(404);
  });
});
