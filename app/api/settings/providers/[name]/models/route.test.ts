// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectError, Code } from '@/src/lib/gibson-client';

vi.mock('@/src/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/src/lib/auth/active-tenant', () => ({
  requireActiveTenant: vi.fn(),
  unsafeTenantId: (v: string) => v,
  activeTenantApiResponse: vi.fn(() =>
    Response.json({ error: 'no_active_tenant' }, { status: 412 }),
  ),
  NoActiveTenantError: class extends Error {},
  StaleActiveTenantError: class extends Error {},
}));
vi.mock('@/src/lib/gibson-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/gibson-client')>();
  return { ...actual, daemonListProviderModels: vi.fn() };
});

import { GET } from './route';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, unsafeTenantId } from '@/src/lib/auth/active-tenant';
import { daemonListProviderModels } from '@/src/lib/gibson-client';

const session = { user: { id: 'user-1' }, expires: '2099-01-01T00:00:00Z' };
const ctx = (name: string) => ({ params: Promise.resolve({ name }) });
const req = () => new Request('http://localhost/api/settings/providers/p/models') as Parameters<typeof GET>[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireActiveTenant).mockResolvedValue(unsafeTenantId('tenant-1'));
});

describe('GET /api/settings/providers/[name]/models', () => {
  it('returns 401 without a session', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    expect((await GET(req(), ctx('p'))).status).toBe(401);
  });

  it('returns the list of a saved provider', async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never);
    vi.mocked(daemonListProviderModels).mockResolvedValue({
      ok: true,
      errorClass: '',
      errorMessage: '',
      latencyMs: 12,
      models: [{ name: 'm1', family: '', contextWindow: 1000 }],
    });
    const res = await GET(req(), ctx('p'));
    expect(res.status).toBe(200);
    expect((await res.json()).result.models[0].name).toBe('m1');
    expect(daemonListProviderModels).toHaveBeenCalledWith('p', 'user-1', 'tenant-1');
  });

  it('returns a failed call as a 200 with the error class', async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never);
    vi.mocked(daemonListProviderModels).mockResolvedValue({
      ok: false,
      errorClass: 'route_not_ready',
      errorMessage: 'the route of the provider is not ready yet',
      latencyMs: 3,
      models: [],
    });
    const res = await GET(req(), ctx('p'));
    expect(res.status).toBe(200);
    expect((await res.json()).result.errorClass).toBe('route_not_ready');
  });

  it('returns 404 for a name that is not saved', async () => {
    vi.mocked(getServerSession).mockResolvedValue(session as never);
    vi.mocked(daemonListProviderModels).mockRejectedValue(new ConnectError('x', Code.NotFound));
    expect((await GET(req(), ctx('nope'))).status).toBe(404);
  });
});
