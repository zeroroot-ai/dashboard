import { NextRequest, NextResponse } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { logger } from '@/src/lib/logger';
import {
  queryDaemonLogs,
  type DashboardLogLevel,
} from '@/src/lib/gibson-client/logs';

/**
 * GET /api/missions/:id/logs
 *
 * Fetch logs for a specific mission via the daemon LogsService
 * (gibson.daemon.logs.v1.QueryDaemonLogs). The daemon derives the tenant
 * scope from the authenticated identity and queries Loki server-side; the
 * dashboard never talks to Loki directly (dashboard#811). Returns an empty,
 * `available: false` payload when the daemon's log backend is unavailable.
 *
 * Query params:
 * - level: Filter by log level (error, warn, info, debug)
 * - limit: Maximum number of entries (default 100, max 500)
 * - start: Start time (ISO string or Unix ms)
 * - end: End time (ISO string or Unix ms)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    // Authz + tenant scoping are enforced by the daemon on the downstream
    // RPC (ext-authz tenant#member; tenant derived from the caller's
    // identity). We still require an active-tenant cookie so userClient can
    // attach the x-gibson-tenant header and fail closed on stale/absent
    // selection.
    try {
      await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }

    const { id: missionId } = await params;
    const searchParams = request.nextUrl.searchParams;

    // Parse query params
    const level = searchParams.get('level') as DashboardLogLevel | null;
    const limitParam = searchParams.get('limit');
    const limit = Math.min(500, Math.max(1, parseInt(limitParam || '100', 10)));
    const startParam = searchParams.get('start');
    const endParam = searchParams.get('end');

    const start = startParam
      ? new Date(isNaN(Number(startParam)) ? startParam : Number(startParam))
      : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours

    const end = endParam
      ? new Date(isNaN(Number(endParam)) ? endParam : Number(endParam))
      : new Date();

    // Query logs for this mission through the daemon. A transient backend
    // failure (Unavailable) is surfaced as `available: false` rather than a
    // 5xx, matching the prior Loki-readiness behaviour.
    let logs;
    try {
      logs = await queryDaemonLogs({
        missionId,
        level: level || undefined,
        start,
        end,
        limit,
      });
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.Unavailable) {
        logger.warn(
          { route: 'missions/logs', missionId, err },
          'daemon log backend unavailable',
        );
        return NextResponse.json({
          available: false,
          message: 'Log service is not available',
          logs: [],
        });
      }
      throw err;
    }

    // Parse JSON log lines and extract relevant fields
    const parsedLogs = logs.map((entry) => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(entry.line);
      } catch {
        // Not JSON, use raw line
        parsed = { msg: entry.line };
      }

      return {
        timestamp: entry.timestamp.toISOString(),
        level: (parsed.level as string)?.toLowerCase() || 'info',
        message: parsed.msg || parsed.message || entry.line,
        component: parsed.component,
        missionId: parsed.mission_id,
        missionName: parsed.mission_name,
        error: parsed.error,
        labels: entry.labels,
        raw: entry.line,
      };
    });

    return NextResponse.json({
      available: true,
      missionId,
      logs: parsedLogs,
      query: {
        level,
        limit,
        start: start.toISOString(),
        end: end.toISOString(),
      },
    });
  } catch (error) {
    return daemonErrorResponse(error, { headers: request.headers });
  }
}
