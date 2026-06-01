/**
 * Unit tests for src/lib/auth/use-authorize.ts
 *
 * Covers all decision paths per design Component 2:
 *   1. Unknown method → allowed: false, reason: 'unknown_method'  [FAIL-CLOSED]
 *   1b. (regression sentinel) Unknown method +
 *       NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV=1 in any NODE_ENV →
 *       STILL denied. The flag was deleted in spec
 *       eliminate-permissive-authz Req 2; this test catches a future
 *       re-introduction by asserting the env var has no effect.
 *   2. unauthenticated entry → allowed: true, loading: false
 *   3. SERVICE-only entry → allowed: false, loading: false (no query)
 *   4. Loading state → allowed: false, loading: true
 *   5. admin role for admin requirement → allowed: true
 *   6. admin role for member requirement → allowed: true (hierarchy)
 *   7. member role for admin requirement → allowed: false
 *   8. No active tenant → allowed: false, loading: false
 *   9. No role for active tenant → allowed: false, loading: false
 *
 * Spec: dashboard-authz-ui-gating Requirement 2, 9.1.
 * Sister-spec: cross-repo-cohesion-fixes Requirement 1.
 * Sister-spec: eliminate-permissive-authz Requirement 2 — the
 *   `(b)` permissive-allow test was deleted; the `(c)` production-gate
 *   test is now the canonical regression sentinel.
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
const ADMIN_METHOD = '/gibson.tenant.v1.SecretsService/SetSecret';

/** A known member-tier method. */
const MEMBER_METHOD = '/gibson.tenant.v1.SecretsService/ListSecrets';

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
    '/gibson.tenant.v1.SecretsService/SetSecret': {
      method: '/gibson.tenant.v1.SecretsService/SetSecret',
      service: 'gibson.tenant.v1.SecretsService',
      relation: 'admin',
      objectType: 'tenant',
      objectDeriver: 'tenant_from_identity',
      allowedIdentities: 1,
      unauthenticated: false,
    },
    '/gibson.tenant.v1.SecretsService/ListSecrets': {
      method: '/gibson.tenant.v1.SecretsService/ListSecrets',
      service: 'gibson.tenant.v1.SecretsService',
      relation: 'member',
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

describe('useAuthorize — unknown method always denies regardless of NODE_ENV+flag', () => {
  // Regression sentinel for spec eliminate-permissive-authz Req 2: the
  // `NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV` flag was deleted. Setting
  // it (in any NODE_ENV) MUST have no effect. If a future change
  // re-introduces an env-conditioned allow path, these assertions fail.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('NODE_ENV=development + NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV=1 STILL returns denied', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV', '1');
    const { result } = renderHook(() => useAuthorize('/unknown/EscapeHatch/DevDeny'), {
      wrapper: createWrapper(),
    });
    expect(result.current).toMatchObject({ allowed: false, reason: 'unknown_method' });
  });

  it('NODE_ENV=production + NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV=1 STILL returns denied', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV', '1');
    const { result } = renderHook(() => useAuthorize('/unknown/EscapeHatch/ProductionDeny'), {
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
        return HttpResponse.json({ activeTenantId: 'tenant-a', byTenant: { 'tenant-a': { role: 'admin' } } });
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

describe('useAuthorize — admin role', () => {
  beforeEach(() => {
    mockMemberships('tenant-a', { 'tenant-a': { role: 'admin' } });
  });

  it('satisfies admin requirement → allowed', async () => {
    const { result } = renderHook(() => useAuthorize(ADMIN_METHOD), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ allowed: true, loading: false });
  });

  it('satisfies member requirement via hierarchy → allowed', async () => {
    const { result } = renderHook(() => useAuthorize(MEMBER_METHOD), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ allowed: true, loading: false });
  });
});

describe('useAuthorize — member role', () => {
  beforeEach(() => {
    mockMemberships('tenant-a', { 'tenant-a': { role: 'member' } });
  });

  it('satisfies member requirement → allowed', async () => {
    const { result } = renderHook(() => useAuthorize(MEMBER_METHOD), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ allowed: true, loading: false });
  });

  it('does NOT satisfy admin requirement → denied', async () => {
    const { result } = renderHook(() => useAuthorize(ADMIN_METHOD), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ allowed: false, loading: false });
  });
});

describe('useAuthorize — no active tenant', () => {
  beforeEach(() => {
    mockMemberships(null, { 'tenant-a': { role: 'admin' } });
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
    mockMemberships('tenant-b', { 'tenant-a': { role: 'admin' } });
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
