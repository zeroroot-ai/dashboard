// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for src/lib/auth/session-tenant.ts (ADR-0093 decision 4).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListMyMemberships = vi.fn();
const mockTokenClient = vi.fn((..._args: unknown[]) => ({
  listMyMemberships: mockListMyMemberships,
}));
vi.mock('@/src/lib/gibson-client/transport', () => ({
  tokenClient: (service: unknown, accessToken: unknown) =>
    mockTokenClient(service, accessToken),
}));

vi.mock('@/src/gen/gibson/daemon/v1/daemon_pb', () => ({
  DaemonService: { name: 'DaemonService' },
}));

vi.mock('@/src/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  resolveTenantForToken,
  stampSessionTenant,
  TenantInvariantError,
} from '../session-tenant';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveTenantForToken', () => {
  it('returns null when the caller has no membership', async () => {
    mockListMyMemberships.mockResolvedValue({ memberships: [] });
    await expect(resolveTenantForToken('tok')).resolves.toBeNull();
  });

  it('returns the tenant id for exactly one membership', async () => {
    mockListMyMemberships.mockResolvedValue({
      memberships: [{ tenantId: 'acme', tenantName: 'Acme', role: 'admin' }],
    });
    await expect(resolveTenantForToken('tok')).resolves.toBe('acme');
  });

  it('throws TenantInvariantError for more than one membership', async () => {
    mockListMyMemberships.mockResolvedValue({
      memberships: [
        { tenantId: 'acme', tenantName: 'Acme', role: 'admin' },
        { tenantId: 'other', tenantName: 'Other', role: 'member' },
      ],
    });
    await expect(resolveTenantForToken('tok')).rejects.toBeInstanceOf(
      TenantInvariantError,
    );
  });

  it('propagates a transport error rather than guessing a tenant', async () => {
    mockListMyMemberships.mockRejectedValue(new Error('daemon unreachable'));
    await expect(resolveTenantForToken('tok')).rejects.toThrow(
      'daemon unreachable',
    );
  });

  it('calls the transport with the access token, no tenant header', async () => {
    mockListMyMemberships.mockResolvedValue({ memberships: [] });
    await resolveTenantForToken('the-token');
    expect(mockTokenClient).toHaveBeenCalledWith(
      expect.anything(),
      'the-token',
    );
  });
});

describe('stampSessionTenant', () => {
  it('stamps tenantId and tenantResolvedAt on the token', async () => {
    mockListMyMemberships.mockResolvedValue({
      memberships: [{ tenantId: 'acme', tenantName: 'Acme', role: 'admin' }],
    });
    const token: { tenantId?: string | null; tenantResolvedAt?: number } = {};
    await stampSessionTenant(token as never, 'tok');
    expect(token.tenantId).toBe('acme');
    expect(typeof token.tenantResolvedAt).toBe('number');
  });

  it('stamps a null tenantId when the caller has no membership', async () => {
    mockListMyMemberships.mockResolvedValue({ memberships: [] });
    const token: { tenantId?: string | null; tenantResolvedAt?: number } = {};
    await stampSessionTenant(token as never, 'tok');
    expect(token.tenantId).toBeNull();
    expect(typeof token.tenantResolvedAt).toBe('number');
  });

  it('propagates the error and leaves the token unstamped on failure', async () => {
    mockListMyMemberships.mockRejectedValue(new Error('daemon unreachable'));
    const token: { tenantId?: string | null; tenantResolvedAt?: number } = {};
    await expect(stampSessionTenant(token as never, 'tok')).rejects.toThrow(
      'daemon unreachable',
    );
    expect(token.tenantId).toBeUndefined();
    expect(token.tenantResolvedAt).toBeUndefined();
  });
});
