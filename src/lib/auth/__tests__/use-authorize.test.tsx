/**
 * Unit tests for src/lib/auth/use-authorize.ts
 *
 * Covers all decision paths per design Component 2:
 *   1. Unknown method → allowed: false, reason: 'unknown_method'  [FAIL-CLOSED]
 *   1b. Unknown method + NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV=1 (dev) → allowed: true
 *   1c. Unknown method + NODE_ENV=production + permissive var set → STILL denied (production gate)
 *   2. unauthenticated entry → allowed: true, loading: false
 *   3. SERVICE-only entry → allowed: false, loading: false (no query)
 *   4. Loading state → allowed: false, loading: true
 *   5. tenant_admin role for tenant_admin requirement → allowed: true
 *   6. tenant_admin role for tenant_member requirement → allowed: true (hierarchy)
 *   7. tenant_member role for tenant_admin requirement → allowed: false
 *   8. No active tenant → allowed: false, loading: false
 *   9. No role for active tenant → allowed: false, loading: false
 *
 * Spec: dashboard-authz-ui-gating Requirement 2, 9.1.
 * Sister-spec: cross-repo-cohesion-fixes Requirement 1.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/mocks/server';
import { useAuthorize } from '../use-authorize';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** A known admin-only method from the generated registry. */
const ADMIN_METHOD = '/gibson.admin.v1.SecretsAdminService/SetSecret';

/** A known member-tier method. */
const MEMBER_METHOD = '/gibson.admin.v1.SecretsAdminService/ListSecrets';

/** A method with unauthenticated: true (Ping or equivalent). */
// We test the unauthenticated path by mocking the registry instead.

/** A SERVICE-only method — allowed_identities excludes USER. */
const SERVICE_METHOD_SENTINEL = '__test_service_only__';

// ---------------------------------------------------------------------------
// Mock: registry
// vi.mock factory is hoisted — use inline string literals, not constants.
// ---------------------------------------------------------------------------

vi.mock('@/src/gen/authz/registry', () => ({
  IdentityClass: { USER: 1, SERVICE: 2, COMPONENT: 4, PLATFORM_OPERATOR: 8 } as const,
  AuthRegistry: {
    '/gibson.admin.v1.SecretsAdminService/SetSecret': {
      method: '/gibson.admin.v1.SecretsAdminService/SetSecret',
      service: 'gibson.admin.v1.SecretsAdminService',
      relation: 'tenant_admin',
      objectType: 'tenant',
      objectDeriver: 'tenant_from_identity',
      allowedIdentities: 1,
      unauthenticated: false,
    },
    '/gibson.admin.v1.SecretsAdminService/ListSecrets': {
      method: '/gibson.admin.v1.SecretsAdminService/ListSecrets',
      service: 'gibson.admin.v1.SecretsAdminService',
      relation: 'tenant_member',
      objectType: 'tenant',
      objectDeriver: 'tenant_from_identity',
      allowedIdentities: 1,
      unauthenticated: false,
    },
    '__test_unauthenticated__': {
      method: '__test_unauthenticated__',
      service: 'test.v1.TestService',
      relation: '',
      objectType: '',
      objectDeriver: '',
      allowedIdentities: 1,
      unauthenticated: true,
    },
    '__test_service_only__': {
      method: '__test_service_only__',
      service: 'test.v1.TestService',
      relation: 'platform_operator',
      objectType: 'system_tenant',
      objectDeriver: 'system_tenant',
      allowedIdentities: 2, // SERVICE only — no USER bit
      unauthenticated: false,
    },
  } as Record<string, import('@/src/gen/authz/registry').AuthEntry>,
}));

// ---------------------------------------------------------------------------
// Wrapper for React Query
// ---------------------------------------------------------------------------

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'QueryClientWrapper';
  return Wrapper;
}

// ---------------------------------------------------------------------------
// Membership API helpers
// ---------------------------------------------------------------------------

function mockMemberships(activeTenantId: string | null, byTenant: Record<string, { role: string }>) {
  server.use(
    http.get('/api/auth/my-memberships', () =>
      HttpResponse.json({ activeTenantId, byTenant }),
    ),
  );
}

function mockMembershipsError() {
  server.use(
    http.get('/api/auth/my-memberships', () =>
      HttpResponse.error(),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fail-closed: unknown method tests (cross-repo-cohesion-fixes Requirement 1)
// ---------------------------------------------------------------------------

describe('useAuthorize — unknown method (fail-closed)', () => {
  it('(a) returns allowed: false, reason: unknown_method without fetching memberships', () => {
    const { result } = renderHook(() => useAuthorize('/unknown/Method'), {
      wrapper: createWrapper(),
    });
    expect(result.current).toEqual({ allowed: false, loading: false, reason: 'unknown_method' });
  });
});

describe('useAuthorize — unknown method dev escape hatch', () => {
  afterEach(() => {
    // vi.unstubAllEnvs restores all env stubs set via vi.stubEnv — prevents leakage.
    vi.unstubAllEnvs();
  });

  it('(b) NODE_ENV=development + NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV=1 allows the call through', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV', '1');
    const { result } = renderHook(() => useAuthorize('/unknown/EscapeHatch'), {
      wrapper: createWrapper(),
    });
    expect(result.current).toEqual({ allowed: true, loading: false });
  });

  it('(c) NODE_ENV=production + NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV=1 STILL returns denied (production gate)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV', '1');
    const { result } = renderHook(() => useAuthorize('/unknown/ProductionDeny'), {
      wrapper: createWrapper(),
    });
    expect(result.current).toMatchObject({ allowed: false, reason: 'unknown_method' });
  });
});

describe('useAuthorize — unauthenticated entry', () => {
  it('returns allowed: true, loading: false', () => {
    const { result } = renderHook(() => useAuthorize('__test_unauthenticated__'), {
      wrapper: createWrapper(),
    });
    expect(result.current).toEqual({ allowed: true, loading: false });
  });
});

describe('useAuthorize — service-only RPC', () => {
  it('returns allowed: false, loading: false without querying memberships', () => {
    const { result } = renderHook(() => useAuthorize(SERVICE_METHOD_SENTINEL), {
      wrapper: createWrapper(),
    });
    expect(result.current).toEqual({ allowed: false, loading: false });
  });
});

describe('useAuthorize — loading state', () => {
  beforeEach(() => {
    // Slow the response so the hook stays in loading state.
    server.use(
      http.get('/api/auth/my-memberships', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({ activeTenantId: 'tenant-a', byTenant: { 'tenant-a': { role: 'tenant_admin' } } });
      }),
    );
  });

  it('returns allowed: false, loading: true while query is in flight', () => {
    const { result } = renderHook(() => useAuthorize(ADMIN_METHOD), {
      wrapper: createWrapper(),
    });
    // Immediately after mount the query is loading.
    expect(result.current).toEqual({ allowed: false, loading: true });
  });
});

describe('useAuthorize — tenant_admin role', () => {
  beforeEach(() => {
    mockMemberships('tenant-a', { 'tenant-a': { role: 'tenant_admin' } });
  });

  it('satisfies tenant_admin requirement → allowed', async () => {
    const { result } = renderHook(() => useAuthorize(ADMIN_METHOD), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ allowed: true, loading: false });
  });

  it('satisfies tenant_member requirement via hierarchy → allowed', async () => {
    const { result } = renderHook(() => useAuthorize(MEMBER_METHOD), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ allowed: true, loading: false });
  });
});

describe('useAuthorize — tenant_member role', () => {
  beforeEach(() => {
    mockMemberships('tenant-a', { 'tenant-a': { role: 'tenant_member' } });
  });

  it('satisfies tenant_member requirement → allowed', async () => {
    const { result } = renderHook(() => useAuthorize(MEMBER_METHOD), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ allowed: true, loading: false });
  });

  it('does NOT satisfy tenant_admin requirement → denied', async () => {
    const { result } = renderHook(() => useAuthorize(ADMIN_METHOD), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ allowed: false, loading: false });
  });
});

describe('useAuthorize — no active tenant', () => {
  beforeEach(() => {
    mockMemberships(null, { 'tenant-a': { role: 'tenant_admin' } });
  });

  it('returns denied when activeTenantId is null', async () => {
    const { result } = renderHook(() => useAuthorize(ADMIN_METHOD), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ allowed: false, loading: false });
  });
});

describe('useAuthorize — no membership for active tenant', () => {
  beforeEach(() => {
    // Active tenant set, but no matching entry in byTenant.
    mockMemberships('tenant-b', { 'tenant-a': { role: 'tenant_admin' } });
  });

  it('returns denied when user is not a member of the active tenant', async () => {
    const { result } = renderHook(() => useAuthorize(ADMIN_METHOD), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ allowed: false, loading: false });
  });
});

describe('useAuthorize — query error', () => {
  beforeEach(() => {
    mockMembershipsError();
  });

  it('returns denied when membership fetch fails', async () => {
    const { result } = renderHook(() => useAuthorize(ADMIN_METHOD), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 3000 });
    expect(result.current.allowed).toBe(false);
  });
});
