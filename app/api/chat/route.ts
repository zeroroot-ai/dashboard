/**
 * Chat API Route
 *
 * POST /api/chat - Send messages and get a streaming LLM response
 * GET /api/chat - Get chat history for a conversation (placeholder)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { streamText, convertToModelMessages, type ModelMessage, type UIMessage } from 'ai';
import { getServerSession } from '@/src/lib/auth';
import { resolveProvider } from '@/src/lib/ai/provider';
import { listProviders } from '@/src/lib/gibson-client';
import { getGraphContext } from '@/src/lib/graph/context';
import { getGraphSummary } from '@/src/lib/graph/summary';
import { buildSystemPrompt } from '@/src/lib/ai/prompts';
import { getUserActivityContext } from '@/src/lib/chat/user-activity-context';
import { getLangfuseUserContext } from '@/src/lib/chat/langfuse-session-context';
import { getPlatformContext } from '@/src/lib/chat/platform-context';
import { validationErrorResponse, daemonErrorResponse } from '@/src/lib/api-errors';
import { checkRateLimit, createRateLimitResponse } from '@/src/lib/rate-limiter';
import { getStr, delKey } from '@/src/lib/redis-store';
import { logger } from '@/src/lib/logger';
// getConversation removed — ListConversations/GetConversation DEFERRED per
// admin-services-completion spec. Chat history will be wired once the
// chatbot-page spec implements these RPCs on UserService.

// ============================================================================
// Request Validation
// ============================================================================

// AI SDK v6 UIMessage — uses parts[] instead of content: string.
// We accept the full shape permissively and let convertToModelMessages
// do the normalisation before handing off to streamText.
const uiMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(z.record(z.unknown())).default([]),
  metadata: z.record(z.unknown()).optional(),
});

const chatRequestSchema = z.object({
  messages: z.array(uiMessageSchema).min(1).max(50),
  agentId: z.string().optional(),
  context: z.record(z.unknown()).optional(),
  attachmentId: z.string().uuid().optional(),
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
    const { messages, agentId, context, attachmentId } = parseResult.data;

    const tenantId = session.user.tenantId ?? '';
    const userId = session.user.id ?? '';

    // Fetch + consume any attached-file content. Single-use: the key is
    // deleted after read so a stolen attachmentId can't be replayed.
    let attachmentText: string | null = null;
    if (attachmentId) {
      const key = `chatattach:${attachmentId}`;
      try {
        attachmentText = await getStr(key);
        await delKey(key);
      } catch (err) {
        logger.warn(
          { err, route: 'chat', attachmentId },
          'failed to load chat attachment',
        );
      }
    }

    // Resolve the configured LLM provider via daemon — credentials never
    // enter the dashboard process. We look up the tenant's default provider
    // name from the daemon's list, then hand a GibsonLLMAdapter back from
    // resolveProvider so streamText can call through to StreamLLM.
    let providerName: string;
    try {
      const providerList = await listProviders(tenantId, userId);
      const defaultName = providerList.defaultProvider;
      if (!defaultName) {
        return NextResponse.json(
          { error: 'No LLM provider configured. Go to Settings > Providers to set one up.' },
          { status: 503 },
        );
      }
      providerName = defaultName;
    } catch {
      return NextResponse.json(
        { error: 'Unable to fetch provider configuration from daemon.' },
        { status: 503 },
      );
    }

    const model = resolveProvider(providerName, { userId, tenantId });

    // Fetch all context sources in parallel (each fails silently)
    const nodeId = typeof context?.nodeId === 'string' ? context.nodeId : undefined;
    const [graphContext, graphSummaryResult, userActivityContext, langfuseContext, platformContext] =
      await Promise.all([
        nodeId ? getGraphContext(nodeId) : Promise.resolve(undefined),
        getGraphSummary(tenantId).catch(() => null),
        getUserActivityContext(userId, tenantId),
        getLangfuseUserContext(userId, tenantId),
        getPlatformContext(userId, tenantId),
      ]);

    // Build the layered system prompt
    const system = buildSystemPrompt({
      agentId: agentId || 'general',
      graphContext,
      graphSummary: graphSummaryResult?.summary || undefined,
      userActivityContext,
      langfuseContext,
      platformContext,
      nodeId,
    });

    // Convert AI SDK v6 UIMessage[] → ModelMessage[] for streamText.
    // convertToModelMessages handles the parts[] → content normalisation.
    const coreMessages = await convertToModelMessages(messages as UIMessage[]);
    const conversation: ModelMessage[] = attachmentText
      ? [
          {
            role: 'user',
            content: `[Attached file content]:\n\n${attachmentText}`,
          } as ModelMessage,
          ...coreMessages,
        ]
      : coreMessages;

    const result = streamText({
      model,
      system,
      messages: conversation,
    });

    // Expose a per-response trace ID so the client can echo it back when
    // the user clicks thumbs-up / thumbs-down. The real Langfuse trace
    // wiring happens server-side via the provider's telemetry hooks;
    // here we mint a placeholder so the feedback round-trip works even
    // before that hook lands. The client reads this header via a custom
    // transport `fetch` in `ChatContent.tsx` and stashes it on the chat
    // store so the per-message feedback buttons can submit against it.
    const debugRequested = request.headers.get('X-Gibson-Debug') === '1';
    const response = result.toTextStreamResponse();
    response.headers.set('X-Gibson-Trace-Id', crypto.randomUUID());
    if (debugRequested) {
      const debugPayload = system.slice(0, 8192); // 8 KB cap
      response.headers.set('X-Gibson-System-Prompt-Debug', encodeURIComponent(debugPayload));
    }
    return response;
  } catch (error) {
    return daemonErrorResponse(error, { headers: request.headers });
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

    // GetConversation is DEFERRED per admin-services-completion spec.
    // Return empty messages until the chatbot-page spec ships.
    return NextResponse.json({ conversationId, messages: [] });
  } catch (error) {
    return daemonErrorResponse(error, { headers: request.headers });
  }
}
