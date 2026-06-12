import 'server-only';
import { userClient } from '@/src/lib/gibson-client';
import { TracesService } from '@/src/gen/gibson/traces/v1/traces_pb';
import { timestampToISO } from '@/src/lib/gibson-client';

// ============================================================================
// Types
// ============================================================================

export interface LangfuseTraceSummary {
  name: string;
  startTime: string;
  status: 'ok' | 'error' | 'unknown';
  totalTokens: number;
  outputSnippet: string;
}

export interface LangfuseUserContext {
  recentTraces: LangfuseTraceSummary[];
}

const EMPTY: LangfuseUserContext = { recentTraces: [] };

const FETCH_LIMIT = 5;
const SNIPPET_MAX_CHARS = 200;
const TIMEOUT_MS = 500;

// ============================================================================
// Context retrieval
// ============================================================================

/**
 * Fetch the user's recent agent traces via the daemon's TracesService.
 * Gated behind a 500 ms timeout, a slow trace backend must never delay
 * the first streaming token. Returns empty context on any failure.
 *
 * The daemon resolves per-tenant Langfuse credentials server-side;
 * the dashboard never constructs a direct Langfuse client (dashboard#588).
 */
export async function getLangfuseUserContext(
  userId: string,
  _tenantId: string,
): Promise<LangfuseUserContext> {
  try {
    return await Promise.race([
      fetchTraces(userId),
      new Promise<LangfuseUserContext>((resolve) =>
        setTimeout(() => resolve(EMPTY), TIMEOUT_MS),
      ),
    ]);
  } catch {
    return EMPTY;
  }
}

async function fetchTraces(userId: string): Promise<LangfuseUserContext> {
  try {
    const resp = await userClient(TracesService).listTraces({
      pageSize: FETCH_LIMIT,
      pageToken: '',
      fromTimestamp: '',
      toTimestamp: '',
      name: '',
      userId,
      tags: [],
    });

    const recentTraces: LangfuseTraceSummary[] = resp.traces.map((trace) => {
      return {
        name: trace.name,
        startTime: timestampToISO(trace.timestamp) ?? new Date().toISOString(),
        status: 'ok' as const,
        totalTokens: Number(trace.totalTokens ?? 0),
        outputSnippet: '',
      };
    });

    return { recentTraces };
  } catch {
    return EMPTY;
  }
}
