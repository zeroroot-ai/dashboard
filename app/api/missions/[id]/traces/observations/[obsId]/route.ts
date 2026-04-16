import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { hasPermission } from '@/src/lib/auth/schema';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { getTenantLangfuseCredentials, ConnectError, Code } from '@/src/lib/gibson-client';
import { LangfuseClient, LangfuseUnavailableError, LangfuseNotFoundError } from '@/src/lib/langfuse-client';
import { extractMessages } from '@/src/lib/trace-utils';
import { serverConfig } from '@/src/lib/config';

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
    const { id: missionId, obsId } = await params;

    // Validate authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    if (!hasPermission(session, 'missions:read')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
        { status: 403 }
      );
    }

    // Resolve Langfuse credentials: prefer per-tenant, fall back to platform level.
    // A NOT_FOUND gRPC error means the tenant has not been provisioned yet.
    const tenantId = session.user.tenantId;
    let langfuseHost: string;
    let publicKey: string | undefined;
    let secretKey: string | undefined;

    if (tenantId) {
      try {
        const creds = await getTenantLangfuseCredentials(tenantId, session?.user?.id);
        langfuseHost = creds.host || serverConfig.langfuseHost;
        publicKey = creds.publicKey;
        secretKey = creds.secretKey;
      } catch (err) {
        if (err instanceof ConnectError && err.code === Code.NotFound) {
          // Tenant not provisioned yet — fall back to platform credentials
          langfuseHost = serverConfig.langfuseHost;
          publicKey = serverConfig.langfuseAdminPublicKey;
          secretKey = serverConfig.langfuseAdminSecretKey;
        } else {
          throw err;
        }
      }
    } else {
      langfuseHost = serverConfig.langfuseHost;
      publicKey = serverConfig.langfuseAdminPublicKey;
      secretKey = serverConfig.langfuseAdminSecretKey;
    }

    if (!publicKey || !secretKey) {
      return NextResponse.json(
        { error: { code: 'NOT_CONFIGURED', message: 'Observability not configured' } },
        { status: 404 }
      );
    }

    const langfuse = new LangfuseClient({
      host: langfuseHost,
      publicKey,
      secretKey,
    });

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

    return safeErrorResponse(error, 'Failed to process mission request', 500);
  }
}
