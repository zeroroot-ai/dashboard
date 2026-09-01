/**
 * GET /api/jobs/:id/events, Server-Sent Events bridge for one job's events
 * (JobService/StreamJobEvents). gibson#1706 lane E3. Same shape as the agent
 * console bridge (app/api/agents/[runId]/events).
 *
 * Frames: `: open` and `: heartbeat` comments; `event: job` with a
 * JobEventView payload and the seq as the SSE id; `event: end` when the job
 * closed; `event: notfound`; `event: error`.
 */

import { NextRequest } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';
import { logger } from '@/src/lib/logger';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { streamJobEvents, toJobEventView } from '@/src/lib/gibson-client/jobs';

const HEARTBEAT_INTERVAL_MS = 15000;

function parseSince(raw: string | null): bigint | null {
  if (raw === null || raw === '') return BigInt(0);
  if (!/^\d{1,18}$/.test(raw)) return null;
  return BigInt(raw);
}

function sseFrame(event: string, data: unknown, id?: string): string {
  const lines: string[] = [];
  if (id) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  for (const line of JSON.stringify(data).split('\n')) lines.push(`data: ${line}`);
  lines.push('', '');
  return lines.join('\n');
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }
  const { id: jobId } = await params;
  if (!jobId) return Response.json({ error: 'job id required' }, { status: 400 });
  const sinceSeq = parseSince(request.nextUrl.searchParams.get('since'));
  if (sinceSeq === null) {
    return Response.json({ error: 'since must be a non-negative integer' }, { status: 400 });
  }

  const baseLog = { route: 'jobs/events', jobId, sinceSeq: sinceSeq.toString() } as const;
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string): boolean => {
        try {
          controller.enqueue(encoder.encode(text));
          return true;
        } catch {
          return false;
        }
      };
      logger.info(baseLog, 'job events SSE bridge opened');
      if (!send(`: open\n\n`)) return;
      heartbeat = setInterval(() => {
        if (!send(`: heartbeat\n\n`)) clearInterval(heartbeat);
      }, HEARTBEAT_INTERVAL_MS);
      try {
        for await (const ev of streamJobEvents(jobId, sinceSeq, abort.signal)) {
          const view = toJobEventView(ev);
          if (!send(sseFrame('job', view, view.seq))) break;
        }
        send(sseFrame('end', { jobId }));
      } catch (err) {
        if (!abort.signal.aborted) {
          if (err instanceof ConnectError && err.code === Code.NotFound) {
            send(sseFrame('notfound', { jobId }));
          } else {
            logger.warn({ ...baseLog, err }, 'job event stream failed');
            send(sseFrame('error', { message: 'stream unavailable' }));
          }
        }
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      clearInterval(heartbeat);
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
