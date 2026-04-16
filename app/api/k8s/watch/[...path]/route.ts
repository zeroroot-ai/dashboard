import { NextRequest } from 'next/server';

import { k8s } from '@/src/lib/k8s/client';
import { CRDKind, GibsonCRD, WatchEvent } from '@/src/lib/k8s/types';

// Disable Next.js caching — SSE streams must not be cached.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_KINDS: CRDKind[] = ['Tenant', 'TenantMember', 'AgentEnrollment', 'ComponentGrant'];

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const [kindRaw, namespace] = path;
  const kind = kindRaw as CRDKind;
  if (!VALID_KINDS.includes(kind)) {
    return new Response('invalid kind', { status: 400 });
  }

  const encoder = new TextEncoder();
  let watchController: { abort: () => void } | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: WatchEvent<GibsonCRD>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };
      const sendError = (msg: string) => {
        controller.enqueue(encoder.encode(`event: error\ndata: ${msg}\n\n`));
      };
      try {
        watchController = await k8s().watch(
          kind,
          namespace,
          sendEvent,
          (err) => sendError(err.message),
        );
      } catch (e) {
        sendError((e as Error).message);
        controller.close();
        return;
      }
      // Keepalive every 30s to prevent proxy timeout.
      const keepalive = setInterval(() => {
        controller.enqueue(encoder.encode(`: keepalive\n\n`));
      }, 30_000);
      req.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
        watchController?.abort();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      watchController?.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
