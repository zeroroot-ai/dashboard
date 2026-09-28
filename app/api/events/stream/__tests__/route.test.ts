// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Regression test for the dashboard#107 follow-up: GET /api/events/stream
 * used to leave the upstream `DaemonService.Subscribe` call running forever
 * after the client disconnected, because `cancel()` only flipped a local
 * `closed` flag that the blocked `for await` loop never gets a chance to
 * check (it is waiting on the daemon's NEXT event, not polling).
 *
 * This route is opened unconditionally on every `/dashboard` render
 * (`useEventStream()` in components/gibson/dashboard/DashboardContent.tsx),
 * and the browser's EventSource reconnects with its own backoff on every
 * network hiccup. Each reconnect is a brand new invocation of this route
 * handler; without the fix, each one leaks one abandoned subscribe stream.
 */
import { describe, it, expect, vi } from 'vitest';

const { mockGetServerSession } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('server-only', () => ({}));

let capturedSignal: AbortSignal | undefined;

vi.mock('@/src/lib/gibson-client', () => ({
  userClient: vi.fn().mockReturnValue({
    subscribe: (_req: unknown, options?: { signal?: AbortSignal }) => {
      capturedSignal = options?.signal;
      // A real Subscribe RPC that has accepted the stream but has nothing to
      // say yet (the common case today, per the route's own comment: "the
      // Subscribe RPC may not be fully implemented"). The generator never
      // yields and never returns on its own, exactly the shape that needs
      // the caller's AbortSignal to ever terminate.
      return (async function* (): AsyncGenerator<never> {
        await new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        });
      })();
    },
  }),
}));

describe('GET /api/events/stream', () => {
  it('aborts the daemon subscribe call when the client disconnects (dashboard#107 follow-up)', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1' } });
    const { GET } = await import('../route');

    const response = await GET();
    expect(response.body).not.toBeNull();
    const reader = response.body!.getReader();

    // Read the initial "connected" frame so the background subscribe() IIFE
    // has had a chance to run and register its signal.
    await reader.read();
    await vi.waitFor(() => {
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
    });

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);

    // The browser closing the EventSource (or the platform tearing down the
    // response because the underlying HTTP request was aborted) cancels the
    // stream's reader, which must call the ReadableStream's cancel().
    await reader.cancel();

    expect(capturedSignal?.aborted).toBe(true);
  });

  it('returns 401 without touching the daemon when there is no session', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const { GET } = await import('../route');

    const response = await GET();

    expect(response.status).toBe(401);
  });
});
