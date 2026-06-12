/**
 * Chat Feedback API Route
 *
 * POST /api/chat/feedback, record a thumbs-up / thumbs-down on a
 * specific assistant message. The score is forwarded to the platform
 * trace store via TracesService.AddTraceScore, keyed by the provider
 * trace ID the streaming chat response surfaced via `X-Gibson-Trace-Id`.
 *
 * The daemon resolves per-tenant Langfuse credentials server-side;
 * the dashboard never constructs a direct Langfuse client.
 *
 * Closes dashboard#441 (original implementation).
 * Cutover to daemon TracesService: dashboard#588.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { validationErrorResponse, daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { TracesService } from '@/src/gen/gibson/traces/v1/traces_pb';
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
// POST Handler, record user feedback
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

    // Resolve active tenant (fail-closed). The daemon's TracesService
    // derives the tenant from the caller's identity automatically, but
    // resolving the cookie first gives a fast, user-friendly 412 if no
    // tenant is selected.
    try {
      await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }

    try {
      await userClient(TracesService).addTraceScore({
        traceId,
        name: 'user-feedback',
        value: rating === 'up' ? 1.0 : 0.0,
        comment: '',
      });
    } catch (err) {
      logger.warn(
        { traceId, rating, err: err instanceof Error ? err.message : String(err) },
        'feedback unavailable, trace backend unreachable or not configured',
      );
      // Return 204 so the UI optimistic fill-thumb isn't reverted: a
      // missing/unreachable trace backend must not block the feedback affordance.
      return new NextResponse(null, { status: 204 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return daemonErrorResponse(error, { headers: request.headers });
  }
}
