import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import {
  LangfuseUnavailableError,
  LangfuseAuthError,
} from '@/src/lib/langfuse-client';
import {
  resolveLangfuseClient,
  listTenantTraces,
} from '@/src/lib/langfuse-tenant-service';
import type { TraceSummary, TraceListResponse } from '@/src/types/trace';

/**
 * GET /api/traces
 *
 * Tenant-wide list of Gibson Traces across all of the caller's missions.
 * Project scoping is enforced by the tenant's own credentials (resolved in
 * LangfuseTenantService), so only the caller's tenant's traces are returned.
 *
 * Query params:
 *   page   — 1-based page number (default 1)
 *   limit  — page size (default 25, capped at 100)
 *   from   — inclusive lower bound on date (YYYY-MM-DD)
 *   to     — inclusive upper bound on date (YYYY-MM-DD)
 *   name   — substring filter on trace name
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** YYYY-MM-DD → start-of-day ISO; returns undefined for blank/invalid input. */
function startOfDayIso(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** YYYY-MM-DD → end-of-day ISO; returns undefined for blank/invalid input. */
function endOfDayIso(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const d = new Date(`${raw}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }

    const langfuse = await resolveLangfuseClient(
      session.user.tenantId,
      session?.user?.id,
    );
    if (!langfuse) {
      return NextResponse.json(
        {
          error: {
            code: 'NOT_CONFIGURED',
            message:
              'Trace viewing requires observability configuration. Contact your administrator.',
          },
        },
        { status: 404 },
      );
    }

    const sp = request.nextUrl.searchParams;
    const page = parsePositiveInt(sp.get('page'), 1);
    const limit = Math.min(parsePositiveInt(sp.get('limit'), DEFAULT_LIMIT), MAX_LIMIT);
    const name = sp.get('name')?.trim() || undefined;

    const result = await listTenantTraces(langfuse, {
      page,
      limit,
      fromTimestamp: startOfDayIso(sp.get('from')),
      toTimestamp: endOfDayIso(sp.get('to')),
      name,
    });

    const data: TraceSummary[] = result.data.map((trace) => ({
      id: trace.id,
      name: trace.name,
      timestamp: trace.timestamp,
      status: trace.metadata?.error ? 'error' : 'ok',
      totalTokens: trace.totalTokens ?? 0,
      promptTokens: trace.promptTokens ?? 0,
      completionTokens: trace.completionTokens ?? 0,
      latencyMs: trace.latency ?? 0,
      tags: trace.tags ?? [],
      sessionId: trace.sessionId,
    }));

    const body: TraceListResponse = {
      data,
      meta: {
        page: result.meta.page,
        totalPages: result.meta.totalPages,
        totalItems: result.meta.totalItems,
      },
    };

    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof LangfuseUnavailableError) {
      return NextResponse.json(
        { error: { code: 'SERVICE_UNAVAILABLE', message: 'Trace data temporarily unavailable' } },
        { status: 503 },
      );
    }
    if (error instanceof LangfuseAuthError) {
      return NextResponse.json(
        { error: { code: 'CONFIG_ERROR', message: 'Invalid trace credentials for this tenant' } },
        { status: 500 },
      );
    }
    return daemonErrorResponse(error);
  }
}
