/**
 * Unit tests for gibson-client/logs.ts
 *
 * Mocks the underlying userClient so the tests run without a live gRPC
 * connection, but exercises the REAL generated logs_pb schemas via `create`
 * so request construction (field names, defaults) is validated. Verifies:
 * - queryMissionLogs / queryDaemonLogs call the right RPC with the right
 *   request fields (mission id, level enum, time range as unix-nanos, limit).
 * - The tenant scope is NEVER supplied by the dashboard (no tenant arg, no
 *   X-Scope-OrgID) — the daemon derives it server-side (dashboard#811).
 * - LogEntry (unix_nanos bigint) is mapped to a Date-bearing dashboard shape.
 *
 * Spec: dashboard#811 (route logs through the daemon LogsService).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockLogsClient = {
  queryMissionLogs: vi.fn(),
  queryDaemonLogs: vi.fn(),
};

vi.mock('@/src/lib/gibson-client', () => ({
  userClient: vi.fn(() => mockLogsClient),
}));

import { queryMissionLogs, queryDaemonLogs } from '../logs';
import { LogLevel } from '@/src/gen/gibson/daemon/logs/v1/logs_pb';

const NS_PER_MS = BigInt(1_000_000);

beforeEach(() => {
  mockLogsClient.queryMissionLogs.mockReset();
  mockLogsClient.queryDaemonLogs.mockReset();
});

describe('queryMissionLogs', () => {
  it('sends mission id + time range as unix-nanos, no tenant scope', async () => {
    mockLogsClient.queryMissionLogs.mockResolvedValue({ entries: [] });

    const start = new Date('2026-06-21T00:00:00.000Z');
    const end = new Date('2026-06-21T01:00:00.000Z');
    await queryMissionLogs('m1', { start, end, limit: 50 });

    expect(mockLogsClient.queryMissionLogs).toHaveBeenCalledTimes(1);
    const req = mockLogsClient.queryMissionLogs.mock.calls[0][0];
    expect(req.missionId).toBe('m1');
    expect(req.startUnixNanos).toBe(BigInt(start.getTime()) * NS_PER_MS);
    expect(req.endUnixNanos).toBe(BigInt(end.getTime()) * NS_PER_MS);
    expect(req.limit).toBe(50);
    // The request carries no tenant field at all — scope is server-derived.
    expect('tenantId' in req).toBe(false);
  });

  it('defaults the time range + limit to 0 (server default window) when omitted', async () => {
    mockLogsClient.queryMissionLogs.mockResolvedValue({ entries: [] });

    await queryMissionLogs('m1');

    const req = mockLogsClient.queryMissionLogs.mock.calls[0][0];
    expect(req.startUnixNanos).toBe(BigInt(0));
    expect(req.endUnixNanos).toBe(BigInt(0));
    expect(req.limit).toBe(0);
  });

  it('maps LogEntry unix_nanos → Date and preserves line + labels', async () => {
    const tsMs = Date.parse('2026-06-21T00:30:00.000Z');
    mockLogsClient.queryMissionLogs.mockResolvedValue({
      entries: [
        {
          unixNanos: BigInt(tsMs) * NS_PER_MS,
          line: '{"level":"info","msg":"hi"}',
          labels: { mission_id: 'm1' },
        },
      ],
    });

    const out = await queryMissionLogs('m1');

    expect(out).toHaveLength(1);
    expect(out[0].timestamp).toBeInstanceOf(Date);
    expect(out[0].timestamp.getTime()).toBe(tsMs);
    expect(out[0].line).toBe('{"level":"info","msg":"hi"}');
    expect(out[0].labels).toEqual({ mission_id: 'm1' });
  });
});

describe('queryDaemonLogs', () => {
  it('maps the level string to the LogLevel enum and forwards filters', async () => {
    mockLogsClient.queryDaemonLogs.mockResolvedValue({ entries: [] });

    await queryDaemonLogs({ level: 'error', missionId: 'm9', limit: 100 });

    const req = mockLogsClient.queryDaemonLogs.mock.calls[0][0];
    expect(req.level).toBe(LogLevel.ERROR);
    expect(req.missionId).toBe('m9');
    expect(req.limit).toBe(100);
    expect('tenantId' in req).toBe(false);
  });

  it('uses LogLevel.UNSPECIFIED when no level filter is given', async () => {
    mockLogsClient.queryDaemonLogs.mockResolvedValue({ entries: [] });

    await queryDaemonLogs({ missionId: 'm9' });

    const req = mockLogsClient.queryDaemonLogs.mock.calls[0][0];
    expect(req.level).toBe(LogLevel.UNSPECIFIED);
    expect(req.missionId).toBe('m9');
  });

  it('maps returned entries to the dashboard log shape', async () => {
    const tsMs = Date.parse('2026-06-21T00:45:00.000Z');
    mockLogsClient.queryDaemonLogs.mockResolvedValue({
      entries: [
        {
          unixNanos: BigInt(tsMs) * NS_PER_MS,
          line: 'plain line',
          labels: {},
        },
      ],
    });

    const out = await queryDaemonLogs({});

    expect(out[0].timestamp.getTime()).toBe(tsMs);
    expect(out[0].line).toBe('plain line');
    expect(out[0].labels).toEqual({});
  });
});
