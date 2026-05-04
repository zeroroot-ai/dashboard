/**
 * Graph Stream SSE Route — Phase 4, Task 16
 *
 * GET /api/graph/stream — bridges WatchGraphUpdates gRPC server-stream to
 * browser-consumable SSE (text/event-stream). Each GraphUpdate from the daemon
 * is forwarded as:
 *
 *   event: graph-update
 *   data: <JSON>
 *
 * On daemon error:
 *
 *   event: error
 *   data: <JSON>
 *
 * On client disconnect (AbortSignal), the gRPC stream is cancelled.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { getServerSession } from '@/src/lib/auth';
import { userClient } from '@/src/lib/gibson-client';
import { GraphService } from '@/src/gen/gibson/graph/v1/graph_pb';

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const abortController = new AbortController();

      // Wire request abort (client disconnect) to cancel the gRPC stream.
      request.signal.addEventListener('abort', () => {
        abortController.abort();
      });

      try {
        const client = userClient(GraphService);
        const grpcStream = client.watchGraphUpdates(
          {},
          { signal: abortController.signal }
        );

        for await (const update of grpcStream) {
          if (request.signal.aborted) break;

          // Serialize the proto update to a plain object for JSON emission.
          const payload: Record<string, unknown> = {
            kind: update.kind,
            at: update.at ? Number(update.at.seconds) * 1000 + Math.floor(update.at.nanos / 1e6) : null,
          };

          if (update.entity.case === 'node') {
            const node = update.entity.value;
            const properties: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(node.properties)) {
              try {
                properties[k] = JSON.parse(v);
              } catch {
                properties[k] = v;
              }
            }
            payload.node = { id: node.id, labels: node.labels, properties, severity: node.severity };
          } else if (update.entity.case === 'edge') {
            const edge = update.entity.value;
            payload.edge = { id: edge.id, source: edge.sourceId, target: edge.targetId, type: edge.type };
          }

          controller.enqueue(encoder.encode(sseEvent('graph-update', payload)));
        }
      } catch (err) {
        if (!request.signal.aborted) {
          const message = err instanceof ConnectError ? err.message : 'Stream error';
          controller.enqueue(encoder.encode(sseEvent('error', { message })));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering for SSE
    },
  });
}
