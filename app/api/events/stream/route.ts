// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { getServerSession } from '@/src/lib/auth';
import { logger } from '@/src/lib/logger';

/**
 * GET /api/events/stream
 *
 * Server-Sent Events endpoint for real-time event streaming. Mounted
 * unconditionally by DashboardContent, so it opens on every /dashboard
 * render (`useEventStream()`, dashboard#107 follow-up investigation).
 *
 * Attempts to proxy the Gibson daemon's Subscribe RPC as SSE.
 * Falls back to a heartbeat-only stream if the daemon stream is unavailable
 * (the Subscribe RPC is not fully implemented yet).
 *
 * `cancel()` MUST abort the upstream `subscribe` call (dashboard#107 follow-up):
 * the browser's EventSource reconnects with its own exponential backoff
 * (src/hooks/useEventStream.ts) on every network hiccup, each reconnect
 * opens a NEW route handler invocation, and without an AbortSignal threaded
 * into `subscribe()`, the OLD invocation's `for await` loop stays blocked
 * awaiting the daemon's next event forever, since it only checks `closed`
 * between received events, never while waiting for one. A client that
 * reconnects repeatedly (a flaky edge, an Envoy idle timeout, a daemon that
 * never sends anything) leaked one abandoned daemon-subscribe stream, and
 * everything it closes over, per reconnect. Every other SSE bridge in this
 * repo (app/api/jobs/[id]/events, app/api/agents/[runId]/events,
 * app/api/graph/stream) already threads an AbortController into its upstream
 * call for exactly this reason; this route did not.
 */
export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  let closed = false;
  const abort = new AbortController();

  const stream = new ReadableStream({
    start(controller) {
      // Send an initial connected event
      const connectEvent = {
        id: crypto.randomUUID(),
        type: 'system',
        source: 'dashboard',
        timestamp: new Date().toISOString(),
        severity: 'info',
        payload: { message: 'Connected to event stream' },
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(connectEvent)}\n\n`));

      // Send periodic heartbeats to keep the connection alive
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          closed = true;
          clearInterval(heartbeat);
        }
      }, 15000);

      // Attempt to subscribe to the Gibson daemon's event stream.
      //
      // This is a best-effort proxy, the Subscribe RPC may not be fully
      // implemented. The transport goes through Envoy via the user-acting
      // `userClient` factory (spec headline-feature-completion R11 +
      // dashboard-admin-via-envoy), NOT a direct daemon channel, the
      // legacy `createGrpcTransport({ baseUrl: serverConfig.gibsonDaemonUrl })`
      // pattern that lived here previously skipped jwt_authn / ext_authz /
      // SPIFFE mTLS at the Envoy edge.
      void (async () => {
        try {
          const { DaemonService } = await import('@/src/gen/gibson/daemon/v1/daemon_pb');
          const { userClient } = await import('@/src/lib/gibson-client');

          const client = userClient(DaemonService);

          for await (const event of client.subscribe({}, { signal: abort.signal })) {
            if (closed) break;

            const sseEvent = {
              id: crypto.randomUUID(),
              type: event.eventType || 'system',
              source: event.source || 'daemon',
              timestamp: event.timestamp
                ? new Date(Number(event.timestamp) * 1000).toISOString()
                : new Date().toISOString(),
              severity: 'info',
              payload: (() => {
                const dataUnknown = event.data as unknown;
                if (
                  dataUnknown !== null &&
                  typeof dataUnknown === 'object' &&
                  'fields' in dataUnknown &&
                  dataUnknown.fields !== null &&
                  typeof dataUnknown.fields === 'object'
                ) {
                  return Object.fromEntries(
                    Object.entries(dataUnknown.fields as Record<string, { stringValue?: string; intValue?: number }>).map(
                      ([k, v]) => [k, v?.stringValue ?? v?.intValue?.toString() ?? '']
                    )
                  );
                }
                return {};
              })(),
            };

            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(sseEvent)}\n\n`));
            } catch {
              closed = true;
              break;
            }
          }
        } catch (err) {
          // Subscribe RPC not available (or the call above was aborted by
          // cancel()), heartbeat-only mode is fine. The dashboard will show
          // "Connected" and events will appear once the daemon's Subscribe
          // RPC is implemented. Do not log an abort as a failure, it is the
          // expected shutdown path, not an error condition.
          if (!abort.signal.aborted) {
            logger.warn(
              { scope: 'api.events.stream', err },
              'daemon event subscribe failed, continuing in heartbeat-only mode',
            );
          }
        }
      })();
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
