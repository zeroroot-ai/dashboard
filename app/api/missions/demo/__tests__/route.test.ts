/**
 * Per-route contract test for POST /api/missions/demo.
 *
 * Verifies the three-step orchestration:
 *   1. createMissionDefinition → definition id
 *   2. createMission with the demo target + definition id
 *   3. runMission → running mission id
 *
 * Plus the error-handling contract (auth, csrf, daemon error mapping).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';

const mockGetServerSession = vi.fn();
const mockUserClient = vi.fn();
const mockRunMission = vi.fn();
const mockRequireCsrf = vi.fn();
const mockCreateMissionDefinition = vi.fn();
const mockCreateMission = vi.fn();

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
  userClient: () => mockUserClient(),
  runMission: mockRunMission,
}));

function makeRequest(): NextRequest {
  return new NextRequest('http://test.local/api/missions/demo', { method: 'POST' });
}

beforeEach(() => {
  vi.resetModules();
  mockGetServerSession.mockReset();
  mockUserClient.mockReset();
  mockRunMission.mockReset();
  mockRequireCsrf.mockReset().mockResolvedValue(undefined);
  mockCreateMissionDefinition.mockReset();
  mockCreateMission.mockReset();
});

describe('POST /api/missions/demo', () => {
  it('returns 401 when no session', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { POST } = await import('../route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('orchestrates createDefinition + createMission + runMission and returns the running mission id', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
    mockCreateMissionDefinition.mockResolvedValue({ missionDefinitionId: 'def-demo-1' });
    mockCreateMission.mockResolvedValue({
      success: true,
      mission: { id: 'm-pending-1' },
    });
    mockUserClient.mockReturnValue({
      createMissionDefinition: mockCreateMissionDefinition,
      createMission: mockCreateMission,
    });
    mockRunMission.mockResolvedValue({
      success: true,
      missionId: 'm-running-1',
      event: { eventType: 'mission_started' },
    });

    const { POST } = await import('../route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.missionId).toBe('m-running-1');
    expect(body.target).toBe('scanme.nmap.org');

    // Definition step: a single-node mission targeting scanme.nmap.org via nmap-agent.
    expect(mockCreateMissionDefinition).toHaveBeenCalledTimes(1);
    const defArg = mockCreateMissionDefinition.mock.calls[0][0];
    expect(defArg.definition.targetRef).toBe('scanme.nmap.org');
    expect(defArg.definition.entryPoints).toEqual(['scan']);
    expect(defArg.definition.exitPoints).toEqual(['scan']);

    // CreateMission step references the new definition + the demo target.
    expect(mockCreateMission).toHaveBeenCalledWith({
      name: expect.stringContaining('nmap'),
      description: expect.stringContaining('scanme.nmap.org'),
      targetId: 'scanme.nmap.org',
      missionDefinitionId: 'def-demo-1',
      variables: {},
      memoryContinuity: 'isolated',
    });

    // RunMission step uses the definition + target, isolated memory, user id.
    expect(mockRunMission).toHaveBeenCalledWith(
      'def-demo-1',
      'scanme.nmap.org',
      {},
      'isolated',
      'u1',
    );
  });

  it('falls back to the created mission id when runMission returns no id', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
    mockCreateMissionDefinition.mockResolvedValue({ missionDefinitionId: 'def-demo-2' });
    mockCreateMission.mockResolvedValue({
      success: true,
      mission: { id: 'm-pending-2' },
    });
    mockUserClient.mockReturnValue({
      createMissionDefinition: mockCreateMissionDefinition,
      createMission: mockCreateMission,
    });
    mockRunMission.mockResolvedValue({ success: true });

    const { POST } = await import('../route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.missionId).toBe('m-pending-2');
  });

  it('returns 500 when createMissionDefinition does not return an id', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
    mockCreateMissionDefinition.mockResolvedValue({ missionDefinitionId: '' });
    mockUserClient.mockReturnValue({
      createMissionDefinition: mockCreateMissionDefinition,
      createMission: mockCreateMission,
    });

    const { POST } = await import('../route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(mockCreateMission).not.toHaveBeenCalled();
    expect(mockRunMission).not.toHaveBeenCalled();
  });

  it('returns 500 when createMission rejects', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
    mockCreateMissionDefinition.mockResolvedValue({ missionDefinitionId: 'def-3' });
    mockCreateMission.mockResolvedValue({ success: false, message: 'quota exceeded' });
    mockUserClient.mockReturnValue({
      createMissionDefinition: mockCreateMissionDefinition,
      createMission: mockCreateMission,
    });

    const { POST } = await import('../route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toContain('quota exceeded');
    expect(mockRunMission).not.toHaveBeenCalled();
  });

  it('maps a daemon ResourceExhausted via the canonical error envelope', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 't1' } });
    mockCreateMissionDefinition.mockRejectedValue(
      new ConnectError('over quota', Code.ResourceExhausted),
    );
    mockUserClient.mockReturnValue({
      createMissionDefinition: mockCreateMissionDefinition,
      createMission: mockCreateMission,
    });

    const { POST } = await import('../route');
    const res = await POST(makeRequest());

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.class).toBe('resource_exhausted');
  });
});
