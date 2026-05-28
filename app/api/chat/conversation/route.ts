/**
 * POST /api/chat/conversation
 *
 * Persists a conversation (metadata + message history) to Redis using the
 * same key schema as the daemon's internal saveConversation path. This
 * allows conversation history to survive across browser sessions and devices
 * and to be read back via the daemon's UserService.ListConversations /
 * GetConversation RPCs.
 *
 * spec: chat-conversation-persistence (dashboard#446)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/src/lib/auth';
import { saveConversation } from '@/src/lib/redis-store';
import { validationErrorResponse, daemonErrorResponse } from '@/src/lib/api-errors';

// ============================================================================
// Request validation
// ============================================================================

const messageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  created_at_unix: z.number().optional(),
});

const conversationSaveSchema = z.object({
  conversationId: z.string().min(1).max(255),
  title: z.string().min(1).max(500),
  agentId: z.string().min(1).max(255),
  messages: z.array(messageSchema).min(1).max(500),
});

// ============================================================================
// POST handler
// ============================================================================

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const parseResult = conversationSaveSchema.safeParse(body);
    if (!parseResult.success) {
      return validationErrorResponse(parseResult.error);
    }

    const { conversationId, title, agentId, messages } = parseResult.data;
    const tenantId = session.user.tenantId ?? '';
    const userId = session.user.id ?? '';

    if (!tenantId) {
      return NextResponse.json({ error: 'No active tenant' }, { status: 400 });
    }

    const saved = await saveConversation({
      tenantId,
      userId,
      conversationId,
      title,
      agentId,
      messages,
    });

    if (!saved) {
      // Redis unavailable — degrade gracefully; the conversation is still in
      // Zustand in-memory state for the current session.
      return NextResponse.json(
        { error: 'Conversation store temporarily unavailable' },
        { status: 503 },
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return daemonErrorResponse(error, { headers: request.headers });
  }
}
