// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for gibson-client/domain-packs.ts (ADR-0033, gibson#383).
 *
 * Mocks the underlying userClient so the tests run without a live gRPC
 * connection. Verifies that:
 * - Each method calls the correct DomainPackService RPC with correct args.
 * - Proto response messages are mapped to the DTO shape the panel renders.
 * - A daemon-unavailable failure is never swallowed: it is rethrown through
 *   throwMapped, never mapped to an empty list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectError, Code } from '@connectrpc/connect';

vi.mock('server-only', () => ({}));

const mockDomainPackClient = {
  listDomainPackCatalog: vi.fn(),
  listDomainPacks: vi.fn(),
  enableDomainPack: vi.fn(),
  disableDomainPack: vi.fn(),
};

vi.mock('@/src/lib/gibson-client', () => ({
  userClient: vi.fn(() => mockDomainPackClient),
}));

vi.mock('@/src/gen/gibson/tenant/v1/domain_pack_pb', () => ({
  DomainPackService: {},
}));

import {
  daemonListDomainPackCatalog,
  daemonListDomainPacks,
  daemonEnableDomainPack,
  daemonDisableDomainPack,
} from '../domain-packs';

describe('daemonListDomainPackCatalog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls ListDomainPackCatalog and maps entries to DTOs', async () => {
    mockDomainPackClient.listDomainPackCatalog.mockResolvedValue({
      entries: [
        {
          name: 'main',
          version: 1,
          author: 'zeroroot-ai',
          visibility: 'public',
          entitlement: '',
          taxonomyNodeLabels: ['Finding'],
          taxonomyRelationshipTypes: ['DEMONSTRATES'],
          techniques: ['unauthenticated_endpoint_exposed'],
        },
      ],
    });

    const result = await daemonListDomainPackCatalog();

    expect(mockDomainPackClient.listDomainPackCatalog).toHaveBeenCalledWith({});
    expect(result).toEqual([
      {
        name: 'main',
        version: 1,
        author: 'zeroroot-ai',
        visibility: 'public',
        entitlement: '',
        taxonomyNodeLabels: ['Finding'],
        taxonomyRelationshipTypes: ['DEMONSTRATES'],
        techniques: ['unauthenticated_endpoint_exposed'],
      },
    ]);
  });

  it('returns an empty array when the catalog is empty, never throws', async () => {
    mockDomainPackClient.listDomainPackCatalog.mockResolvedValue({ entries: [] });
    await expect(daemonListDomainPackCatalog()).resolves.toEqual([]);
  });

  it('rethrows a daemon-unavailable error instead of returning an empty list', async () => {
    mockDomainPackClient.listDomainPackCatalog.mockRejectedValue(
      new ConnectError('no healthy upstream', Code.Unavailable),
    );

    await expect(daemonListDomainPackCatalog()).rejects.toThrow();
  });
});

describe('daemonListDomainPacks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls ListDomainPacks and maps views to DTOs', async () => {
    mockDomainPackClient.listDomainPacks.mockResolvedValue({
      packs: [{ name: 'main', version: 1, techniques: ['credential_disclosure_detected'] }],
    });

    const result = await daemonListDomainPacks();

    expect(mockDomainPackClient.listDomainPacks).toHaveBeenCalledWith({});
    expect(result).toEqual([
      { name: 'main', version: 1, techniques: ['credential_disclosure_detected'] },
    ]);
  });
});

describe('daemonEnableDomainPack', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls EnableDomainPack with the pack name and returns name/version', async () => {
    mockDomainPackClient.enableDomainPack.mockResolvedValue({ name: 'main', version: 1 });

    const result = await daemonEnableDomainPack('main');

    expect(mockDomainPackClient.enableDomainPack).toHaveBeenCalledWith({ name: 'main' });
    expect(result).toEqual({ name: 'main', version: 1 });
  });

  it('propagates a permission-denied error from the daemon', async () => {
    mockDomainPackClient.enableDomainPack.mockRejectedValue(
      new ConnectError('caller is not a tenant admin', Code.PermissionDenied),
    );

    await expect(daemonEnableDomainPack('main')).rejects.toThrow();
  });
});

describe('daemonDisableDomainPack', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls DisableDomainPack with the pack name', async () => {
    mockDomainPackClient.disableDomainPack.mockResolvedValue({});

    await daemonDisableDomainPack('main');

    expect(mockDomainPackClient.disableDomainPack).toHaveBeenCalledWith({ name: 'main' });
  });
});
