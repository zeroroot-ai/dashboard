/**
 * Per-route contract test for GET /api/missions.
 *
 * Spec: deploy#207 (epic one-code-path M11, "kill safeErrorResponse").
 *
 * Verifies that the route emits the canonical 9-class error shape when
 * the daemon throws a ConnectError, including:
 *   - correct HTTP status (per the slice's mapping table),
 *   - canonical body shape (error.class / error.message / error.affordance),
 *   - correlation ID in BOTH the response header and the body,
 *   - 200 + empty array on the empty-state happy path (distinct from
 *     non-200 error-state).
 *
 * This is the canonical pattern every other migrated route can follow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';

const { mockGetServerSession, mockRequireActiveTenant } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockRequireActiveTenant: vi.fn(),
}));

const mockListMissions = vi.fn();
const mockSerializeMission = vi.fn();

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/src/lib/auth/active-tenant', () => ({
  requireActiveTenant: mockRequireActiveTenant,
  activeTenantApiResponse: vi.fn(),
}));

vi.mock('@/src/lib/gibson-client', () => ({
  listMissions: mockListMissions,
  serializeMission: mockSerializeMission,
}));

function makeRequest(url = 'http://test.local/api/missions'): NextRequest {
  return new NextRequest(url);
}

beforeEach(() => {
  vi.resetModules();
  mockGetServerSession.mockReset();
  mockRequireActiveTenant.mockReset();
  mockListMissions.mockReset();
  mockSerializeMission.mockReset();

  // Default: active tenant resolves to t1.
  mockRequireActiveTenant.mockResolvedValue('t1');
});

describe('GET /api/missions, canonical error mapping', () => {
  // The 9-class table the slice contracts. Every route under app/api
  // must surface daemon failures with these exact HTTP codes + class
  // names, the client-side error-state component branches on class.
  const cases: Array<{
    code: Code;
    httpStatus: number;
    cls: string;
  }> = [
    { code: Code.Unauthenticated, httpStatus: 401, cls: 'unauthenticated' },
    { code: Code.PermissionDenied, httpStatus: 403, cls: 'permission_denied' },
    { code: Code.NotFound, httpStatus: 404, cls: 'not_found' },
    { code: Code.FailedPrecondition, httpStatus: 412, cls: 'failed_precondition' },
    { code: Code.ResourceExhausted, httpStatus: 429, cls: 'resource_exhausted' },
    { code: Code.Unavailable, httpStatus: 503, cls: 'unavailable' },
    { code: Code.DeadlineExceeded, httpStatus: 504, cls: 'deadline_exceeded' },
    { code: Code.InvalidArgument, httpStatus: 400, cls: 'invalid_argument' },
    { code: Code.Internal, httpStatus: 500, cls: 'internal' },
  ];

  it.each(cases)(
    'ConnectError(Code.$cls) from daemon → HTTP $httpStatus + class=$cls',
    async ({ code, httpStatus, cls }) => {
      mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
      mockListMissions.mockRejectedValue(new ConnectError('daemon detail', code));

      const { GET } = await import('../route');
      const res = await GET(makeRequest());

      // HTTP status maps to the canonical class.
      expect(res.status).toBe(httpStatus);

      // Correlation ID surfaces in BOTH the header and the body.
      const headerId = res.headers.get('x-correlation-id');
      expect(headerId).toMatch(/^req-/);

      const body = await res.json();
      expect(body.error.class).toBe(cls);
      expect(body.error.correlationId).toBe(headerId);
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);
      expect(typeof body.error.affordance).toBe('string');

      // No legacy `success: false` envelope (that was the
      // safeErrorResponse anti-pattern).
      expect(body.success).toBeUndefined();
    },
  );

  it('forwards an upstream x-correlation-id header verbatim', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
    mockListMissions.mockRejectedValue(
      new ConnectError('still warming up', Code.FailedPrecondition),
    );

    const { GET } = await import('../route');
    const req = makeRequest();
    req.headers.set('x-correlation-id', 'req-UPSTREAM12345678901234567X');
    const res = await GET(req);

    expect(res.status).toBe(412);
    expect(res.headers.get('x-correlation-id')).toBe(
      'req-UPSTREAM12345678901234567X',
    );
    const body = await res.json();
    expect(body.error.correlationId).toBe(
      'req-UPSTREAM12345678901234567X',
    );
  });
});

describe('GET /api/missions, empty-state vs error-state', () => {
  it('200 with empty data array on empty-state (no missions for tenant)', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
    mockListMissions.mockResolvedValue({ missions: [] });

    const { GET } = await import('../route');
    const res = await GET(makeRequest());

    // Empty-state is HTTP 200, the UI renders the empty-state
    // component. This is the contract that distinguishes "no data"
    // from "the daemon failed to answer".
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    // No error envelope on the happy path.
    expect(body.error).toBeUndefined();
  });

  it('non-200 on daemon failure (error-state UI activates)', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
    mockListMissions.mockRejectedValue(new ConnectError('boom', Code.Unavailable));

    const { GET } = await import('../route');
    const res = await GET(makeRequest());

    // Error-state, distinct HTTP class so the client-side hook can
    // branch on it without inspecting the response body.
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(body.error.class).toBe('unavailable');
  });
});
