import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { LangfuseUnavailableError, LangfuseNotFoundError } from '@/src/lib/langfuse-client';
import { resolveLangfuseClient } from '@/src/lib/langfuse-tenant-service';
import { extractMessages } from '@/src/lib/trace-utils';

/**
 * GET /api/missions/[id]/traces/observations/[obsId]
 *
 * Fetch a single observation's detail (conversation content).
 * Used for on-demand loading when user expands a decision entry.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; obsId: string }> }
) {
  try {
    const { obsId } = await params;

    // Validate authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    // Authz enforced by daemon ext-authz on the downstream RPC.

    // Resolve a tenant-scoped Langfuse client. Credential resolution lives
    // entirely in LangfuseTenantService — this route owns none of it.
    const langfuse = await resolveLangfuseClient(
      session.user.tenantId,
      session?.user?.id,
    );

    if (!langfuse) {
      return NextResponse.json(
        { error: { code: 'NOT_CONFIGURED', message: 'Observability not configured' } },
        { status: 404 }
      );
    }

    // Fetch the observation
    const observation = await langfuse.getObservation(obsId);

    // Extract structured messages
    const messages = extractMessages(observation);
    const contentAvailable = observation.input != null || observation.output != null;

    return NextResponse.json({
      observation: {
        id: observation.id,
        contentAvailable,
        messages,
        metadata: {
          model: observation.model || 'unknown',
          temperature: observation.modelParameters?.temperature as number | undefined,
          maxTokens: observation.modelParameters?.max_tokens as number | undefined,
          topP: observation.modelParameters?.top_p as number | undefined,
          inputTokens: observation.promptTokens ?? 0,
          outputTokens: observation.completionTokens ?? 0,
          latencyMs: observation.endTime
            ? new Date(observation.endTime).getTime() - new Date(observation.startTime).getTime()
            : 0,
          estimatedCostUsd: 0, // Calculated client-side from model pricing
        },
      },
    });
  } catch (error) {
    if (error instanceof LangfuseUnavailableError) {
      return NextResponse.json(
        { error: { code: 'SERVICE_UNAVAILABLE', message: 'Trace data temporarily unavailable' } },
        { status: 503 }
      );
    }
    if (error instanceof LangfuseNotFoundError) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Observation not found' } },
        { status: 404 }
      );
    }

    return daemonErrorResponse(error);
  }
}
