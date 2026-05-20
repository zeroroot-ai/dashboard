/**
 * Per-route contract test for POST /api/missions/:id/start.
 *
 * Verifies the status-branching dispatch:
 *   - paused  → calls resumeMission(id) with the same id
 *   - pending → calls runMission(missionDefinitionId, targetId), returns NEW id
 *   - other   → 409 Conflict
 *
 * Verifies the error-handling contract (auth, csrf, not-found, 422 on
 * pending-without-refs, canonical daemon error mapping via daemonErrorResponse).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';

const mockGetServerSession = vi.fn();
const mockListMissions = vi.fn();
const mockResumeMission = vi.fn();
const mockRunMission = vi.fn();
const mockRequireCsrf = vi.fn();

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/src/lib/auth/csrf', () => ({
  requireCsrf: mockRequireCsrf,
  CsrfError: class CsrfError extends Error {},
  csrfErrorResponse: (err: Error) =>
    new Response(JSON.stringify({ error: { code: 'CSRF', message: err.message } }), {
      status: 403,
    }),
}));

vi.mock('@/src/lib/gibson-client', () => ({
  listMissions: mockListMissions,
  resumeMission: mockResumeMission,
  runMission: mockRunMission,
}));

function makeRequest(): NextRequest {
  return new NextRequest('http://test.local/api/missions/m1/start', {
    method: 'POST',
  });
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.resetModules();
  mockGetServerSession.mockReset();
  mockListMissions.mockReset();
  mockResumeMission.mockReset();
  mockRunMission.mockReset();
  mockRequireCsrf.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/missions/:id/start', () => {
  it('returns 401 when no session', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { POST } = await import('../route');
    const res = await POST(makeRequest(), makeParams('m1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when mission does not exist', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
    mockListMissions.mockResolvedValue({ missions: [] });
    const { POST } = await import('../route');
    const res = await POST(makeRequest(), makeParams('m1'));
    expect(res.status).toBe(404);
  });

  it('dispatches paused mission via ResumeMission and keeps the same id', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
    mockListMissions.mockResolvedValue({
      missions: [
        {
          id: 'm1',
          status: 'MISSION_STATUS_PAUSED',
          missionDefinitionId: 'def1',
          targetId: 'tgt1',
        },
      ],
    });
    mockResumeMission.mockResolvedValue({ success: true, event: { eventType: 'mission_resumed' } });

    const { POST } = await import('../route');
    const res = await POST(makeRequest(), makeParams('m1'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.missionId).toBe('m1');
    expect(mockResumeMission).toHaveBeenCalledWith('m1', 'u1');
    expect(mockRunMission).not.toHaveBeenCalled();
  });

  it('dispatches pending mission via RunMission and surfaces the new id', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
    mockListMissions.mockResolvedValue({
      missions: [
        {
          id: 'm1',
          status: 'MISSION_STATUS_PENDING',
          missionDefinitionId: 'def1',
          targetId: 'tgt1',
        },
      ],
    });
    mockRunMission.mockResolvedValue({
      success: true,
      missionId: 'm2-new',
      event: { eventType: 'mission_started' },
    });

    const { POST } = await import('../route');
    const res = await POST(makeRequest(), makeParams('m1'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.missionId).toBe('m2-new');
    expect(mockRunMission).toHaveBeenCalledWith('def1', 'tgt1', {}, 'isolated', 'u1');
    expect(mockResumeMission).not.toHaveBeenCalled();
  });

  it('returns 422 when a pending mission has no mission_definition_id/target_id', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
    mockListMissions.mockResolvedValue({
      missions: [
        {
          id: 'm1',
          status: 'MISSION_STATUS_PENDING',
          missionDefinitionId: '',
          targetId: '',
        },
      ],
    });

    const { POST } = await import('../route');
    const res = await POST(makeRequest(), makeParams('m1'));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_STATE');
    expect(mockRunMission).not.toHaveBeenCalled();
    expect(mockResumeMission).not.toHaveBeenCalled();
  });

  it('returns 409 for a running mission', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
    mockListMissions.mockResolvedValue({
      missions: [
        {
          id: 'm1',
          status: 'MISSION_STATUS_RUNNING',
          missionDefinitionId: 'def1',
          targetId: 'tgt1',
        },
      ],
    });

    const { POST } = await import('../route');
    const res = await POST(makeRequest(), makeParams('m1'));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
    expect(mockRunMission).not.toHaveBeenCalled();
    expect(mockResumeMission).not.toHaveBeenCalled();
  });

  it('maps a daemon FailedPrecondition into the canonical error response', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
    mockListMissions.mockResolvedValue({
      missions: [
        {
          id: 'm1',
          status: 'MISSION_STATUS_PAUSED',
          missionDefinitionId: 'def1',
          targetId: 'tgt1',
        },
      ],
    });
    mockResumeMission.mockRejectedValue(new ConnectError('not paused', Code.FailedPrecondition));

    const { POST } = await import('../route');
    const res = await POST(makeRequest(), makeParams('m1'));

    expect(res.status).toBe(412);
    const body = await res.json();
    expect(body.error.class).toBe('failed_precondition');
  });
});
