import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { getMissionHistory, getTenantLangfuseCredentials, ConnectError, Code } from '@/src/lib/gibson-client';
import { LangfuseClient, LangfuseUnavailableError, LangfuseAuthError, LangfuseNotFoundError } from '@/src/lib/langfuse-client';
import { buildTraceTree, aggregateTokenUsage, extractDecisions } from '@/src/lib/trace-utils';
import { serverConfig } from '@/src/lib/config';

/**
 * GET /api/missions/[id]/traces
 *
 * Fetch the full LLM trace tree for a mission.
 * Uses the requesting tenant's Langfuse project credentials.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: missionId } = await params;

    // Validate authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    // Authz enforced by daemon ext-authz on the downstream RPC.

    // Get mission history to find trace_id
    // The mission name is the missionId in this context
    let traceId: string | undefined;
    try {
      const history = await getMissionHistory(missionId, 1, 0, session?.user?.id);
      const run = history.runs?.[0];
      if (run) {
        traceId = run.traceId;
      }
    } catch {
      // If getMissionHistory fails, try using missionId directly as trace lookup
    }

    if (!traceId) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Traces not available for this mission. The mission may predate trace recording.' } },
        { status: 404 }
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
        { error: { code: 'NOT_CONFIGURED', message: 'LLM trace viewing requires observability configuration. Contact your administrator.' } },
        { status: 404 }
      );
    }

    // Construct Langfuse client with resolved credentials
    const langfuse = new LangfuseClient({
      host: langfuseHost,
      publicKey,
      secretKey,
    });

    // Fetch trace and observations from Langfuse
    const [trace, observations] = await Promise.all([
      langfuse.getTrace(traceId),
      langfuse.getObservations(traceId),
    ]);

    // Transform data
    const traceTree = buildTraceTree(observations);
    const tokenSummary = aggregateTokenUsage(observations);
    const decisions = extractDecisions(observations);

    const startTime = trace.timestamp;
    const endTime = observations.length > 0
      ? observations.reduce((latest, obs) => {
          const end = obs.endTime || obs.startTime;
          return end > latest ? end : latest;
        }, observations[0].startTime)
      : trace.timestamp;

    const totalDurationMs = new Date(endTime).getTime() - new Date(startTime).getTime();

    return NextResponse.json({
      traceId: trace.id,
      missionId,
      startTime,
      endTime,
      totalDurationMs,
      tokenSummary,
      decisions,
      traceTree,
    });
  } catch (error) {
    if (error instanceof LangfuseUnavailableError) {
      return NextResponse.json(
        { error: { code: 'SERVICE_UNAVAILABLE', message: 'Trace data temporarily unavailable' } },
        { status: 503 }
      );
    }
    if (error instanceof LangfuseAuthError) {
      return NextResponse.json(
        { error: { code: 'CONFIG_ERROR', message: 'Invalid Langfuse credentials for this tenant' } },
        { status: 500 }
      );
    }
    if (error instanceof LangfuseNotFoundError) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Trace not found in Langfuse' } },
        { status: 404 }
      );
    }

    return safeErrorResponse(error, 'Failed to process mission request', 500);
  }
}
