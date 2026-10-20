// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

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

import {
  queryMissionLogs,
  queryDaemonLogs,
  } from '../logs';
import { DEFAULT_MAX_PAGES, MAX_PAGE_SIZE } from '../paging';
import { LogLevel } from '@/src/gen/gibson/daemon/logs/v1/logs_pb';

const NS_PER_MS = BigInt(1_000_000);

beforeEach(() => {
  mockLogsClient.queryMissionLogs.mockReset();
  mockLogsClient.queryDaemonLogs.mockReset();
});

describe('queryMissionLogs', () => {
  it('sends mission id + time range as unix-nanos, no tenant scope', async () => {
    mockLogsClient.queryMissionLogs.mockResolvedValue({ entries: [], nextPageToken: '' });

    const start = new Date('2026-06-21T00:00:00.000Z');
    const end = new Date('2026-06-21T01:00:00.000Z');
    await queryMissionLogs('m1', { start, end, limit: 50 });

    expect(mockLogsClient.queryMissionLogs).toHaveBeenCalledTimes(1);
    const req = mockLogsClient.queryMissionLogs.mock.calls[0][0];
    expect(req.missionId).toBe('m1');
    expect(req.startUnixNanos).toBe(BigInt(start.getTime()) * NS_PER_MS);
    expect(req.endUnixNanos).toBe(BigInt(end.getTime()) * NS_PER_MS);
    expect(req.pageSize).toBe(50);
    expect(req.pageToken).toBe('');
    expect('limit' in req).toBe(false);
    // The request carries no tenant field at all — scope is server-derived.
    expect('tenantId' in req).toBe(false);
  });

  it('defaults the time range to 0 (server default window) and asks for the largest page when no limit is given', async () => {
    mockLogsClient.queryMissionLogs.mockResolvedValue({ entries: [] });

    await queryMissionLogs('m1');

    const req = mockLogsClient.queryMissionLogs.mock.calls[0][0];
    expect(req.startUnixNanos).toBe(BigInt(0));
    expect(req.endUnixNanos).toBe(BigInt(0));
    expect(req.pageSize).toBe(MAX_PAGE_SIZE);
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
    expect(req.pageSize).toBe(100);
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

describe('paging', () => {
  const entry = (n: number) => ({
    unixNanos: BigInt(n) * NS_PER_MS,
    line: `line ${n}`,
    labels: {},
  });

  it('walks pages with page_token until the limit is met', async () => {
    mockLogsClient.queryMissionLogs
      .mockResolvedValueOnce({ entries: [entry(1), entry(2)], nextPageToken: 't1' })
      .mockResolvedValueOnce({ entries: [entry(3), entry(4)], nextPageToken: 't2' });

    const out = await queryMissionLogs('m1', { limit: 3 });

    expect(out.map((e) => e.line)).toEqual(['line 1', 'line 2', 'line 3']);
    const calls = mockLogsClient.queryMissionLogs.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].pageToken).toBe('');
    expect(calls[0][0].pageSize).toBe(3);
    expect(calls[1][0].pageToken).toBe('t1');
    expect(calls[1][0].pageSize).toBe(1);
  });

  it('stops when the daemon returns an empty next_page_token', async () => {
    mockLogsClient.queryDaemonLogs.mockResolvedValueOnce({
      entries: [entry(1)],
      nextPageToken: '',
    });

    const out = await queryDaemonLogs({ limit: 50 });

    expect(out).toHaveLength(1);
    expect(mockLogsClient.queryDaemonLogs).toHaveBeenCalledTimes(1);
  });

  it('stops after DEFAULT_MAX_PAGES pages', async () => {
    let n = 0;
    mockLogsClient.queryMissionLogs.mockImplementation(async () => ({
      entries: [entry(1)],
      nextPageToken: `again${++n}`,
    }));

    const out = await queryMissionLogs('m1', { limit: 5000 });

    expect(mockLogsClient.queryMissionLogs).toHaveBeenCalledTimes(DEFAULT_MAX_PAGES);
    expect(out).toHaveLength(DEFAULT_MAX_PAGES);
  });

  it('caps page_size at the daemon maximum', async () => {
    mockLogsClient.queryMissionLogs.mockResolvedValue({
      entries: [],
      nextPageToken: '',
    });

    await queryMissionLogs('m1', { limit: 5000 });

    expect(mockLogsClient.queryMissionLogs.mock.calls[0][0].pageSize).toBe(
      MAX_PAGE_SIZE,
    );
  });
});
