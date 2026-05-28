/**
 * Chat Feedback API Route
 *
 * POST /api/chat/feedback — record a thumbs-up / thumbs-down on a
 * specific assistant message. The score is forwarded to the platform
 * trace store as a Langfuse score (`name: 'user-feedback'`,
 * `value: 1 | 0`) keyed by the provider trace ID the streaming chat
 * response surfaced via `X-Gibson-Trace-Id`.
 *
 * If trace recording is not configured for this deploy (i.e.
 * `serverConfig.langfuseHost` is null), the route is a no-op 204 — the
 * UI will still show the optimistic filled-thumb so single-tenant
 * dev environments aren't blocked.
 *
 * Closes dashboard#441.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/src/lib/auth';
import { LangfuseClient, LangfuseUnavailableError } from '@/src/lib/langfuse-client';
import { serverConfig } from '@/src/lib/config';
import { validationErrorResponse, daemonErrorResponse } from '@/src/lib/api-errors';
import { logger } from '@/src/lib/logger';

// ============================================================================
// Request Validation
// ============================================================================

const feedbackRequestSchema = z.object({
  messageId: z.string().min(1).max(256),
  traceId: z.string().min(1).max(256),
  rating: z.enum(['up', 'down']),
});

// ============================================================================
// POST Handler — record user feedback
// ============================================================================

export async function POST(request: NextRequest): Promise<Response> {
  try {
    // Authenticate
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse + validate body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const parseResult = feedbackRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return validationErrorResponse(parseResult.error, {
        headers: request.headers,
      });
    }
    const { traceId, rating } = parseResult.data;

    // No Langfuse configured → no-op 204. This is a deliberate decision:
    // the UI optimistically shows the filled thumb regardless, so a
    // missing trace backend doesn't block the feedback affordance for
    // single-tenant dev environments. The user experience is identical.
    if (!serverConfig.langfuseHost) {
      return new NextResponse(null, { status: 204 });
    }

    const client = new LangfuseClient({
      host: serverConfig.langfuseHost,
      publicKey: serverConfig.langfuseAdminPublicKey,
      secretKey: serverConfig.langfuseAdminSecretKey,
    });

    try {
      await client.createScore({
        traceId,
        name: 'user-feedback',
        value: rating === 'up' ? 1 : 0,
      });
    } catch (err) {
      if (err instanceof LangfuseUnavailableError) {
        logger.warn(
          { traceId, rating, err: err.message },
          'feedback unavailable — trace backend unreachable',
        );
        return NextResponse.json(
          { error: 'Feedback service unavailable' },
          { status: 503 },
        );
      }
      throw err;
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return daemonErrorResponse(error, { headers: request.headers });
  }
}
