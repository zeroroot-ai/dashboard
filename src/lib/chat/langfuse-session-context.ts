import 'server-only';
import { serverConfig } from '@/src/lib/config';
import { LangfuseClient, LangfuseUnavailableError, LangfuseAuthError } from '@/src/lib/langfuse-client';

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
// Helpers
// ============================================================================

function buildClient(): LangfuseClient | null {
  const { langfuseHost, langfuseAdminPublicKey, langfuseAdminSecretKey } = serverConfig;
  if (!langfuseHost || !langfuseAdminPublicKey || !langfuseAdminSecretKey) return null;
  return new LangfuseClient({
    host: langfuseHost,
    publicKey: langfuseAdminPublicKey,
    secretKey: langfuseAdminSecretKey,
  });
}

// ============================================================================
// Context retrieval
// ============================================================================

/**
 * Fetch the user's recent Langfuse agent traces.
 * Gated behind a 500 ms timeout — a slow Langfuse instance must never delay
 * the first streaming token. Returns empty context on any failure.
 */
export async function getLangfuseUserContext(
  userId: string,
  _tenantId: string,
): Promise<LangfuseUserContext> {
  const client = buildClient();
  if (!client) return EMPTY;

  try {
    return await Promise.race([
      fetchTraces(client, userId),
      new Promise<LangfuseUserContext>((resolve) =>
        setTimeout(() => resolve(EMPTY), TIMEOUT_MS),
      ),
    ]);
  } catch {
    return EMPTY;
  }
}

async function fetchTraces(
  client: LangfuseClient,
  userId: string,
): Promise<LangfuseUserContext> {
  try {
    const traces = await client.listTraces(userId, FETCH_LIMIT);

    const recentTraces: LangfuseTraceSummary[] = traces.map((trace) => {
      const outputStr =
        typeof trace.output === 'string'
          ? trace.output
          : trace.output
            ? JSON.stringify(trace.output)
            : '';

      return {
        name: trace.name,
        startTime: trace.timestamp,
        status: (trace.metadata?.error ? 'error' : 'ok') as 'ok' | 'error',
        totalTokens: trace.totalTokens ?? 0,
        outputSnippet: outputStr.slice(0, SNIPPET_MAX_CHARS),
      };
    });

    return { recentTraces };
  } catch (err) {
    if (err instanceof LangfuseUnavailableError || err instanceof LangfuseAuthError) {
      return EMPTY;
    }
    return EMPTY;
  }
}
