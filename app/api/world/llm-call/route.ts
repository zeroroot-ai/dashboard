import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';

/**
 * GET /api/world/llm-call?callId=ID
 *
 * The per-tick inspector's transcript fetch (epic ecs-brain, gibson#1059). Returns
 * one LLM call's full record — metadata plus the prompt messages and assistant
 * completion — by wiring the daemon's GetLlmCall (gibson#755). Daemon-mediated and
 * tenant-scoped by gibson.world.v1.WorldService; the dashboard never touches the
 * brain directly. callId is required; an unknown call surfaces as 404.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }

    const callId = req.nextUrl.searchParams.get('callId') ?? '';
    if (!callId) {
      return NextResponse.json(
        { error: { code: 'INVALID_ARGUMENT', message: 'callId is required' } },
        { status: 400 },
      );
    }

    const client = userClient(WorldService);
    const res = await client.getLlmCall({ callId });
    const call = res.call;
    if (!call) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'LLM call not found' } },
        { status: 404 },
      );
    }

    return NextResponse.json({
      callId: call.callId,
      runId: call.runId,
      model: call.model,
      scopeId: call.scopeId,
      promptTokens: call.promptTokens,
      completionTokens: call.completionTokens,
      messages: call.messages.map((m) => ({ role: m.role, content: m.content })),
      completion: call.completion,
    });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
