import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { LokiClient, LokiLogEntry } from '@/src/lib/loki-client';

/**
 * GET /api/missions/:id/logs
 *
 * Fetch logs for a specific mission from Loki.
 * Falls back to returning empty array if Loki is unavailable.
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

    // Authz enforced by daemon ext-authz on the downstream RPC.

    let tenantId: string;
    try {
      tenantId = await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }

    const { id: missionId } = await params;
    const searchParams = request.nextUrl.searchParams;

    // Parse query params
    const level = searchParams.get('level') as 'error' | 'warn' | 'info' | 'debug' | null;
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

    // Initialize Loki client. LOKI_URL is REQUIRED (src/lib/env-validator.ts).
    const { env } = await import('@/src/lib/env-validator');
    const loki = new LokiClient(env.LOKI_URL);

    // Check if Loki is available
    const isReady = await loki.isReady();
    if (!isReady) {
      return NextResponse.json({
        available: false,
        message: 'Log service is not available',
        logs: [],
      });
    }

    // Query logs for this mission
    const logs = await loki.queryDaemonLogs(tenantId, {
      missionId,
      level: level || undefined,
      start,
      end,
      limit,
    });

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
