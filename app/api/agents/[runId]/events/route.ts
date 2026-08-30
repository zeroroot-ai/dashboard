/**
 * GET /api/agents/:runId/events
 *
 * Dashboard-side Server-Sent Events bridge for ONE running agent's live
 * output (ADR-0016 S12, dashboard#1134). Read-only: it forwards the daemon's
 * server-stream `AgentConsoleService.StreamAgentEvents` to the browser, one
 * SSE frame per relayed chunk. There is no input path, and this route never
 * writes to the agent.
 *
 * Frames:
 *   - `: open` / `: heartbeat`  , SSE comments; flip EventSource to OPEN and
 *                                 keep the connection alive.
 *   - `event: chunk`            , one raw output chunk. Payload:
 *                                 { unixNanos: string, dataB64: string }.
 *                                 `dataB64` is the base64 of the daemon's raw
 *                                 bytes; the daemon does not parse them and
 *                                 neither does this bridge. The browser hook
 *                                 decodes + reassembles the opencode NDJSON.
 *   - `event: end`              , the run reached a terminal state; the daemon
 *                                 closed the feed. The client closes.
 *   - `event: notfound`         , the run id is not a live instance in this
 *                                 tenant (daemon returned NOT_FOUND). The
 *                                 client closes.
 *   - `event: error`            , any other upstream failure. The client
 *                                 closes.
 *
 * Security model:
 *   - The call runs through `userClient` -> Envoy (JWT + SPIFFE mTLS) +
 *     ext-authz -> daemon, per dashboard `CLAUDE.md`. No direct daemon channel.
 *   - The tenant scope is derived server-side; a run id owned by another
 *     tenant is indistinguishable from one that never existed (NOT_FOUND).
 *   - Browser disconnect aborts the upstream stream via the AbortController,
 *     so the daemon's in-flight server stream is cancelled promptly.
 */

import { NextRequest } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';

import { logger } from '@/src/lib/logger';
import { getServerSession } from '@/src/lib/auth';
import {
  requireActiveTenant,
  activeTenantApiResponse,
} from '@/src/lib/auth/active-tenant';
import { streamAgentEvents } from '@/src/lib/gibson-client/agent-console';

const HEARTBEAT_INTERVAL_MS = 15000;

/** Parses the `since` query value. Missing means 0; anything else must be a non-negative integer. */
function parseSince(raw: string | null): bigint | null {
  if (raw === null || raw === '') return BigInt(0);
  if (!/^\d{1,18}$/.test(raw)) return null;
  return BigInt(raw);
}

/** SSE frame builder; always terminates with the canonical blank line. */
function sseFrame(event: string, data: unknown, id?: string): string {
  const lines: string[] = [];
  if (id) lines.push(`id: ${id}`);
  if (event) lines.push(`event: ${event}`);
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  for (const line of json.split('\n')) {
    lines.push(`data: ${line}`);
  }
  lines.push('');
  lines.push('');
  return lines.join('\n');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  const { runId } = await params;
  if (!runId) {
    return new Response(JSON.stringify({ error: 'runId required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // `since` is the last event sequence the client saw. The daemon replays
  // its backlog after it, so a client that reconnects backfills its tail
  // without a gap or a duplicate. Missing or zero means the whole backlog.
  const sinceSeq = parseSince(request.nextUrl.searchParams.get('since'));
  if (sinceSeq === null) {
    return new Response(JSON.stringify({ error: 'since must be a non-negative integer' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const baseLog = { route: 'agents/events', runId, sinceSeq: sinceSeq.toString() } as const;
  const encoder = new TextEncoder();

  // Aborts the daemon server stream on teardown (browser disconnect).
  const abort = new AbortController();
  let heartbeatHandle: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      logger.info(baseLog, 'agent events SSE bridge opened');

      try {
        controller.enqueue(encoder.encode(`: open\n\n`));
      } catch {
        return;
      }

      heartbeatHandle = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeatHandle);
        }
      }, HEARTBEAT_INTERVAL_MS);

      try {
        const events = streamAgentEvents(runId, sinceSeq, abort.signal);
        for await (const ev of events) {
          const seq = ev.seq.toString();
          const frame = sseFrame(
            'chunk',
            {
              unixNanos: ev.unixNanos.toString(),
              dataB64: Buffer.from(ev.data).toString('base64'),
              seq,
            },
            seq,
          );
          try {
            controller.enqueue(encoder.encode(frame));
          } catch {
            // Controller closed (client gone); stop pumping.
            break;
          }
        }
        // The loop ended without error: the run reached a terminal state.
        try {
          controller.enqueue(encoder.encode(sseFrame('end', { runId })));
        } catch {
          // client already gone
        }
      } catch (err) {
        // An abort on disconnect is expected; do not surface it.
        if (!abort.signal.aborted) {
          const notFound =
            err instanceof ConnectError && err.code === Code.NotFound;
          if (notFound) {
            try {
              controller.enqueue(
                encoder.encode(sseFrame('notfound', { runId })),
              );
            } catch {
              // client gone
            }
          } else {
            logger.warn({ ...baseLog, err }, 'agent event stream failed');
            try {
              controller.enqueue(
                encoder.encode(
                  sseFrame('error', { message: 'stream unavailable' }),
                ),
              );
            } catch {
              // client gone
            }
          }
        }
      } finally {
        clearInterval(heartbeatHandle);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      logger.info(baseLog, 'agent events SSE bridge cancelled by client');
      clearInterval(heartbeatHandle);
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
