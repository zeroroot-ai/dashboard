import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mutable test state. vi.mock factories are hoisted above top-level
// declarations, so anything they reference must be hoisted too.
const {
  config,
  getTenantLangfuseCredentials,
  FakeConnectError,
  FakeCode,
  constructed,
  listTracesPagedMock,
} = vi.hoisted(() => {
  class FakeConnectError extends Error {
    code: number;
    constructor(message: string, code: number) {
      super(message);
      this.code = code;
    }
  }
  return {
    // Mutable platform config — individual tests null fields to exercise the
    // unconfigured path. The service reads these at call time, not import time.
    config: {
      langfuseHost: 'https://platform.langfuse' as string | null,
      langfuseAdminPublicKey: 'pk-platform',
      langfuseAdminSecretKey: 'sk-platform',
    },
    getTenantLangfuseCredentials: vi.fn(),
    FakeConnectError,
    FakeCode: { NotFound: 5, Internal: 13 },
    constructed: [] as Array<{ host: string; publicKey: string; secretKey: string }>,
    listTracesPagedMock: vi.fn(),
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/src/lib/config', () => ({ serverConfig: config }));
vi.mock('@/src/lib/gibson-client', () => ({
  getTenantLangfuseCredentials,
  ConnectError: FakeConnectError,
  Code: FakeCode,
}));
vi.mock('@/src/lib/langfuse-client', () => ({
  LangfuseClient: class {
    listTracesPaged = listTracesPagedMock;
    constructor(opts: { host: string; publicKey: string; secretKey: string }) {
      constructed.push(opts);
    }
  },
}));

import {
  resolveLangfuseClient,
  listTenantTraces,
} from '../langfuse-tenant-service';

beforeEach(() => {
  vi.clearAllMocks();
  constructed.length = 0;
  config.langfuseHost = 'https://platform.langfuse';
  config.langfuseAdminPublicKey = 'pk-platform';
  config.langfuseAdminSecretKey = 'sk-platform';
});

describe('resolveLangfuseClient', () => {
  it('prefers per-tenant credentials when the daemon returns them', async () => {
    getTenantLangfuseCredentials.mockResolvedValueOnce({
      host: 'https://tenant.langfuse',
      publicKey: 'pk-tenant',
      secretKey: 'sk-tenant',
      projectId: 'proj-1',
    });

    const client = await resolveLangfuseClient('tenant-1', 'user-1');

    expect(client).not.toBeNull();
    expect(getTenantLangfuseCredentials).toHaveBeenCalledWith('tenant-1', 'user-1');
    expect(constructed).toEqual([
      { host: 'https://tenant.langfuse', publicKey: 'pk-tenant', secretKey: 'sk-tenant' },
    ]);
  });

  it('falls back to the platform host when the per-tenant host is blank', async () => {
    getTenantLangfuseCredentials.mockResolvedValueOnce({
      host: '',
      publicKey: 'pk-tenant',
      secretKey: 'sk-tenant',
      projectId: 'proj-1',
    });

    await resolveLangfuseClient('tenant-1', 'user-1');

    expect(constructed[0]).toEqual({
      host: 'https://platform.langfuse',
      publicKey: 'pk-tenant',
      secretKey: 'sk-tenant',
    });
  });

  it('falls back to platform credentials when the tenant is not provisioned (NOT_FOUND)', async () => {
    getTenantLangfuseCredentials.mockRejectedValueOnce(
      new FakeConnectError('not provisioned', FakeCode.NotFound),
    );

    const client = await resolveLangfuseClient('tenant-1', 'user-1');

    expect(client).not.toBeNull();
    expect(constructed[0]).toEqual({
      host: 'https://platform.langfuse',
      publicKey: 'pk-platform',
      secretKey: 'sk-platform',
    });
  });

  it('rethrows daemon errors that are not NOT_FOUND', async () => {
    getTenantLangfuseCredentials.mockRejectedValueOnce(
      new FakeConnectError('boom', FakeCode.Internal),
    );

    await expect(resolveLangfuseClient('tenant-1', 'user-1')).rejects.toThrow('boom');
    expect(constructed).toHaveLength(0);
  });

  it('uses platform credentials when no tenant id is supplied', async () => {
    const client = await resolveLangfuseClient(undefined);

    expect(client).not.toBeNull();
    expect(getTenantLangfuseCredentials).not.toHaveBeenCalled();
    expect(constructed[0]).toEqual({
      host: 'https://platform.langfuse',
      publicKey: 'pk-platform',
      secretKey: 'sk-platform',
    });
  });

  it('returns null when nothing is configured', async () => {
    config.langfuseHost = null;

    const client = await resolveLangfuseClient(undefined);

    expect(client).toBeNull();
    expect(constructed).toHaveLength(0);
  });

  it('returns null when the tenant is unprovisioned and platform creds are missing', async () => {
    getTenantLangfuseCredentials.mockRejectedValueOnce(
      new FakeConnectError('not provisioned', FakeCode.NotFound),
    );
    config.langfuseAdminSecretKey = '';

    const client = await resolveLangfuseClient('tenant-1', 'user-1');

    expect(client).toBeNull();
    expect(constructed).toHaveLength(0);
  });
});

describe('listTenantTraces', () => {
  async function buildClient() {
    getTenantLangfuseCredentials.mockResolvedValueOnce({
      host: 'https://tenant.langfuse',
      publicKey: 'pk-tenant',
      secretKey: 'sk-tenant',
      projectId: 'proj-1',
    });
    const client = await resolveLangfuseClient('tenant-1', 'user-1');
    if (!client) throw new Error('expected a client');
    return client;
  }

  it('applies default pagination when no opts are given', async () => {
    const client = await buildClient();
    listTracesPagedMock.mockResolvedValueOnce({ data: [], meta: { page: 1, limit: 25, totalItems: 0, totalPages: 1 } });

    await listTenantTraces(client);

    expect(listTracesPagedMock).toHaveBeenCalledWith({
      page: 1,
      limit: 25,
      fromTimestamp: undefined,
      toTimestamp: undefined,
      name: undefined,
    });
  });

  it('passes through page, limit, date range, and name filters', async () => {
    const client = await buildClient();
    listTracesPagedMock.mockResolvedValueOnce({ data: [], meta: { page: 3, limit: 10, totalItems: 0, totalPages: 0 } });

    await listTenantTraces(client, {
      page: 3,
      limit: 10,
      fromTimestamp: '2026-01-01T00:00:00.000Z',
      toTimestamp: '2026-02-01T00:00:00.000Z',
      name: 'recon-agent',
    });

    expect(listTracesPagedMock).toHaveBeenCalledWith({
      page: 3,
      limit: 10,
      fromTimestamp: '2026-01-01T00:00:00.000Z',
      toTimestamp: '2026-02-01T00:00:00.000Z',
      name: 'recon-agent',
    });
  });
});
