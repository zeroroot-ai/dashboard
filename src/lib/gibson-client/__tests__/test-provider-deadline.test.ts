// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The daemon waits up to 45 seconds in TestProvider for the route of a new
 * provider (gibson#1394). The call must carry a bound above 45 seconds, and
 * not the 20 second default, or the dashboard cuts a good test.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/src/lib/auth/user-token', () => ({ requireUserToken: vi.fn(async () => 't') }));

const { testProvider, withCallDeadline } = vi.hoisted(() => ({
  testProvider: vi.fn(),
  withCallDeadline: vi.fn((ms: number) => ({ deadlineMs: ms })),
}));
vi.mock('@/src/lib/gibson-client/transport', () => ({
  userClient: vi.fn(() => ({ testProvider })),
  serviceClient: vi.fn(),
  withCallDeadline,
}));

import { daemonTestProvider } from '@/src/lib/gibson-client';

describe('daemonTestProvider', () => {
  it('sends the name with a deadline above the 45 second wait of the daemon', async () => {
    testProvider.mockResolvedValue({ ok: true, latencyMs: BigInt(7), model: 'm', error: '', models: [] });
    const out = await daemonTestProvider('claude-prod');
    expect(testProvider).toHaveBeenCalledTimes(1);
    expect(testProvider.mock.calls[0][0]).toEqual({ name: 'claude-prod' });
    const ms = withCallDeadline.mock.calls[0][0];
    expect(ms).toBeGreaterThan(45_000);
    expect(testProvider.mock.calls[0][1]).toEqual({ deadlineMs: ms });
    expect(out).toMatchObject({ ok: true, latencyMs: 7 });
  });
});
