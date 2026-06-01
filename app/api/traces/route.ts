import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client';
import { TracesService } from '@/src/gen/gibson/traces/v1/traces_pb';
import type { TraceSummary, TraceListResponse } from '@/src/types/trace';
import { timestampToISO } from '@/src/lib/gibson-client';

/**
 * GET /api/traces
 *
 * Tenant-wide list of Gibson Traces across all of the caller's missions.
 * Project scoping is enforced by the daemon's TracesService, which resolves
 * per-tenant Langfuse credentials server-side. The dashboard never sees
 * Langfuse host/keys.
 *
 * Query params:
 *   page   — 1-based page number (default 1)
 *   limit  — page size (default 25, capped at 100)
 *   from   — inclusive lower bound on date (YYYY-MM-DD)
 *   to     — inclusive upper bound on date (YYYY-MM-DD)
 *   name   — substring filter on trace name
 *   userId — restrict to traces attributed to a specific end-user
 *   tags   — repeated param; restrict to traces carrying ALL specified tags
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** YYYY-MM-DD → start-of-day ISO; returns empty string for blank/invalid input. */
function startOfDayIso(raw: string | null): string {
  if (!raw) return '';
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** YYYY-MM-DD → end-of-day ISO; returns empty string for blank/invalid input. */
function endOfDayIso(raw: string | null): string {
  if (!raw) return '';
  const d = new Date(`${raw}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
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

    try {
      await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }

    const sp = request.nextUrl.searchParams;
    const page = parsePositiveInt(sp.get('page'), 1);
    const limit = Math.min(parsePositiveInt(sp.get('limit'), DEFAULT_LIMIT), MAX_LIMIT);
    const name = sp.get('name')?.trim() || '';
    const userId = sp.get('userId')?.trim() || '';
    const tags = sp.getAll('tags').map((t) => t.trim()).filter(Boolean);

    // AIP-158 page_token: encode the 1-based page number as a decimal string.
    // The daemon uses this as a Langfuse offset-pagination cursor.
    const pageToken = page > 1 ? String(page) : '';

    const resp = await userClient(TracesService).listTraces({
      pageSize: limit,
      pageToken,
      fromTimestamp: startOfDayIso(sp.get('from')),
      toTimestamp: endOfDayIso(sp.get('to')),
      name,
      userId,
      tags,
    });

    const data: TraceSummary[] = resp.traces.map((trace) => ({
      id: trace.id,
      name: trace.name,
      timestamp: timestampToISO(trace.timestamp) ?? new Date().toISOString(),
      status: 'ok' as const,
      totalTokens: Number(trace.totalTokens ?? 0),
      promptTokens: Number(trace.promptTokens ?? 0),
      completionTokens: Number(trace.completionTokens ?? 0),
      latencyMs: trace.latencyMs ?? 0,
      tags: trace.tags ?? [],
      sessionId: trace.sessionId || undefined,
    }));

    // Decode next_page_token back to a 1-based page number for the meta.
    const returnedPage =
      resp.nextPageToken ? Number(resp.nextPageToken) - 1 : page;
    const totalItems = Number(resp.totalItems ?? 0);
    const totalPages = totalItems > 0 ? Math.ceil(totalItems / limit) : 1;

    const body: TraceListResponse = {
      data,
      meta: {
        page: returnedPage > 0 ? returnedPage : page,
        totalPages,
        totalItems,
      },
    };

    return NextResponse.json(body);
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
