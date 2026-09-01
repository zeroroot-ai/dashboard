/**
 * GET /api/banks/:id/members/:memberId/sign-in/events, Server-Sent Events
 * bridge for one member's sign-in flow (BankService/StreamSignIn).
 * gibson#1706 lane E2.
 *
 * Frames: `: open` and `: heartbeat`; `event: step` with a SignInStepView;
 * `event: end` when the daemon closed the stream (after done or error);
 * `event: notfound`; `event: error`. Nothing here is logged beyond the ids:
 * the URL and the code prompt pass through, the token never exists here.
 */

import { NextRequest } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';
import { logger } from '@/src/lib/logger';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { streamSignIn } from '@/src/lib/gibson-client/banks';

const HEARTBEAT_INTERVAL_MS = 15000;

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const session = await getServerSession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }
  const { id: bankId, memberId } = await params;
  const baseLog = { route: 'banks/sign-in/events', bankId, memberId } as const;
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
      logger.info(baseLog, 'sign-in SSE bridge opened');
      if (!send(`: open\n\n`)) return;
      heartbeat = setInterval(() => {
        if (!send(`: heartbeat\n\n`)) clearInterval(heartbeat);
      }, HEARTBEAT_INTERVAL_MS);
      try {
        for await (const step of streamSignIn(bankId, memberId, abort.signal)) {
          if (!send(sseFrame('step', step))) break;
        }
        send(sseFrame('end', { memberId }));
      } catch (err) {
        if (!abort.signal.aborted) {
          if (err instanceof ConnectError && err.code === Code.NotFound) {
            send(sseFrame('notfound', { memberId }));
          } else {
            logger.warn({ ...baseLog, code: err instanceof ConnectError ? err.code : undefined }, 'sign-in stream failed');
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
