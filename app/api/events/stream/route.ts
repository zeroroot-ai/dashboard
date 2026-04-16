import { getServerSession } from '@/src/lib/auth';

/**
 * GET /api/events/stream
 *
 * Server-Sent Events endpoint for real-time event streaming.
 * Attempts to proxy the Gibson daemon's Subscribe RPC as SSE.
 * Falls back to a heartbeat-only stream if the daemon stream is unavailable
 * (the Subscribe RPC is not fully implemented yet).
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

      // Attempt to subscribe to the Gibson daemon's event stream
      // This is a best-effort proxy — the Subscribe RPC may not be fully implemented
      void (async () => {
        try {
          const { createClient } = await import('@connectrpc/connect');
          const { createGrpcTransport } = await import('@connectrpc/connect-node');
          const { DaemonService } = await import('@/src/gen/gibson/daemon/v1/daemon_pb');
          const { serverConfig } = await import('@/src/lib/config');

          const transport = createGrpcTransport({
            baseUrl: serverConfig.gibsonDaemonUrl,
          });
          const client = createClient(DaemonService, transport);

          for await (const event of client.subscribe({})) {
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
                const dataAny = event.data as any;
                if (dataAny?.fields) {
                  return Object.fromEntries(
                    Object.entries(dataAny.fields).map(([k, v]: [string, any]) => [k, v?.stringValue ?? v?.intValue?.toString() ?? ''])
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
        } catch {
          // Subscribe RPC not available — heartbeat-only mode is fine.
          // The dashboard will show "Connected" and events will appear
          // once the daemon's Subscribe RPC is implemented.
        }
      })();
    },
    cancel() {
      closed = true;
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
