/**
 * Chat API Route
 *
 * POST /api/chat - Send messages and get a streaming LLM response
 * GET /api/chat - Get chat history for a conversation (placeholder)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { streamText, type ModelMessage } from 'ai';
import { getServerSession } from '@/src/lib/auth';
import { resolveProvider, ProviderNotConfiguredError, ProviderKeyMissingError } from '@/src/lib/ai/provider';
import { getGraphContext } from '@/src/lib/graph/context';
import { getGraphSummary } from '@/src/lib/graph/summary';
import { buildSystemPrompt } from '@/src/lib/ai/prompts';
import { chatMessageSchema } from '@/src/lib/api-validation';
import { validationErrorResponse, safeErrorResponse } from '@/src/lib/api-errors';
import { checkRateLimit, createRateLimitResponse } from '@/src/lib/rate-limiter';
import { getConversation } from '@/src/lib/gibson-client';

// ============================================================================
// Request Validation
// ============================================================================

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(50),
  agentId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

// ============================================================================
// POST Handler - Send message with streaming response
// ============================================================================

export async function POST(request: NextRequest): Promise<Response> {
  try {
    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, 'chat:message', {
      maxRequests: 30,
      windowSeconds: 60,
      identifier: 'user' as const,
    });
    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult);
    }

    // Check authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse and validate request body
    const body = await request.json();
    const parseResult = chatRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return validationErrorResponse(parseResult.error);
    }
    const { messages, agentId, context } = parseResult.data;

    // Resolve the configured LLM provider
    const tenantId = session.user.tenantId ?? '';
    let resolved;
    try {
      resolved = await resolveProvider(tenantId);
    } catch (error) {
      if (error instanceof ProviderNotConfiguredError || error instanceof ProviderKeyMissingError) {
        return NextResponse.json(
          { error: error.message },
          { status: 503 }
        );
      }
      throw error;
    }

    // Fetch graph context and tenant summary in parallel (non-blocking on failure)
    const nodeId = typeof context?.nodeId === 'string' ? context.nodeId : undefined;
    const [graphContext, graphSummaryResult] = await Promise.all([
      nodeId ? getGraphContext(nodeId) : Promise.resolve(undefined),
      getGraphSummary(tenantId).catch(() => null),
    ]);

    // Build the system prompt with layered context
    const system = buildSystemPrompt({
      agentId: agentId || 'general',
      graphContext,
      graphSummary: graphSummaryResult?.summary || undefined,
    });

    // Stream the response — cast validated messages to the SDK type
    const result = streamText({
      model: resolved.model,
      system,
      messages: messages as ModelMessage[],
    });

    return result.toTextStreamResponse();
  } catch (error) {
    return safeErrorResponse(error, 'Chat request failed');
  }
}

// ============================================================================
// GET Handler - Get conversation history (placeholder)
// ============================================================================

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId');

    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversationId is required' },
        { status: 400 }
      );
    }

    const tenantId = session.user.tenantId ?? '';
    try {
      const result = await getConversation(tenantId, conversationId, session.user?.id);
      return NextResponse.json({ conversationId, messages: result.messages });
    } catch {
      // Return empty messages for a new conversation or when daemon is unavailable.
      return NextResponse.json({ conversationId, messages: [] });
    }
  } catch (error) {
    return safeErrorResponse(error, 'Failed to process chat request', 500);
  }
}
