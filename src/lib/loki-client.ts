/**
 * Loki Client for querying logs from Grafana Loki
 *
 * Provides a simple interface to query logs for missions and other components.
 */

export interface LokiLogEntry {
  timestamp: Date;
  line: string;
  labels: Record<string, string>;
}

export interface LokiQueryResult {
  status: 'success' | 'error';
  data?: {
    resultType: 'streams' | 'matrix' | 'vector' | 'scalar';
    result: Array<{
      stream: Record<string, string>;
      values: Array<[string, string]>; // [timestamp_ns, line]
    }>;
  };
  error?: string;
  errorType?: string;
}

export interface LokiQueryOptions {
  /** LogQL query string */
  query: string;
  /** Start time (Date or Unix timestamp in nanoseconds) */
  start?: Date | number;
  /** End time (Date or Unix timestamp in nanoseconds) */
  end?: Date | number;
  /** Maximum number of entries to return */
  limit?: number;
  /** Direction: forward or backward */
  direction?: 'forward' | 'backward';
  /** Tenant ID for multi-tenant Loki (sent as X-Scope-OrgID header) */
  tenantId?: string;
}

/**
 * Convert Date to nanosecond timestamp string for Loki
 */
function dateToNanos(date: Date): string {
  return (date.getTime() * 1_000_000).toString();
}

/**
 * Parse nanosecond timestamp string to Date
 */
function nanosToDate(nanos: string): Date {
  return new Date(parseInt(nanos, 10) / 1_000_000);
}

export class LokiClient {
  private baseUrl: string;
  private defaultTenantId?: string;

  constructor(baseUrl?: string, defaultTenantId?: string) {
    // LOKI_URL is REQUIRED at boot (src/lib/env-validator.ts). Callers that
    // pass an explicit baseUrl skip the env read entirely (used in tests).
    // We read process.env directly here rather than through the env-validator
    // proxy to avoid module-load-time throws when this class is instantiated
    // outside of the production boot path (e.g. in unit tests, OR during
    // `next build` page-data collection which import-evaluates modules with
    // no runtime env).
    const fromEnv = process.env.LOKI_URL;
    const isBuildPhase =
      process.env.NEXT_PHASE === 'phase-production-build' ||
      process.env.npm_lifecycle_event === 'build' ||
      process.env.npm_lifecycle_event === 'prebuild';
    if (!baseUrl && !fromEnv) {
      if (isBuildPhase) {
        // Synthetic placeholder so `next build`'s page-data probe can
        // import this module. Runtime requests never reach this branch
        // because validateEnv() fail-fasts the pod when LOKI_URL is
        // missing.
        this.baseUrl = '__BUILD_TIME_STUB_LOKI_URL__';
      } else {
        throw new Error(
          '[LokiClient] LOKI_URL is required (or pass an explicit baseUrl). ' +
            'See src/lib/env-validator.ts, validateEnv() should have caught this at boot.',
        );
      }
    } else {
      this.baseUrl = baseUrl ?? (fromEnv as string);
    }
    // LOKI_TENANT_ID is OPTIONAL (single-tenant Loki deployments omit it).
    this.defaultTenantId = defaultTenantId || process.env.LOKI_TENANT_ID;
  }

  /**
   * Build request headers, including X-Scope-OrgID for multi-tenant Loki.
   * When auth_enabled is true in Loki, every request must carry the
   * X-Scope-OrgID header to identify the tenant organization.
   */
  private buildHeaders(tenantId?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    const orgId = tenantId || this.defaultTenantId;
    if (orgId) {
      headers['X-Scope-OrgID'] = orgId;
    }
    return headers;
  }

  /**
   * Check if Loki is reachable and ready
   */
  async isReady(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/ready`, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Query logs using LogQL
   */
  async query(options: LokiQueryOptions): Promise<LokiLogEntry[]> {
    const { query, start, end, limit = 100, direction = 'backward', tenantId } = options;

    // Default time range: last hour
    const endTime = end instanceof Date ? dateToNanos(end) : end?.toString() || dateToNanos(new Date());
    const startTime =
      start instanceof Date
        ? dateToNanos(start)
        : start?.toString() || dateToNanos(new Date(Date.now() - 60 * 60 * 1000));

    const params = new URLSearchParams({
      query,
      start: startTime,
      end: endTime,
      limit: limit.toString(),
      direction,
    });

    const response = await fetch(`${this.baseUrl}/loki/api/v1/query_range?${params}`, {
      method: 'GET',
      headers: this.buildHeaders(tenantId),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Loki query failed: ${response.status} ${text}`);
    }

    const result: LokiQueryResult = await response.json();

    if (result.status !== 'success') {
      throw new Error(`Loki query error: ${result.error || 'Unknown error'}`);
    }

    // Parse results into log entries
    const entries: LokiLogEntry[] = [];

    if (result.data?.result) {
      for (const stream of result.data.result) {
        for (const [timestampNs, line] of stream.values) {
          entries.push({
            timestamp: nanosToDate(timestampNs),
            line,
            labels: stream.stream,
          });
        }
      }
    }

    // Sort by timestamp (newest first for backward, oldest first for forward)
    entries.sort((a, b) => {
      const diff = b.timestamp.getTime() - a.timestamp.getTime();
      return direction === 'backward' ? diff : -diff;
    });

    return entries;
  }

  /**
   * Query logs for a specific mission
   */
  async queryMissionLogs(
    missionId: string,
    tenantId: string,
    options?: { start?: Date; end?: Date; limit?: number }
  ): Promise<LokiLogEntry[]> {
    // Query logs that contain the mission ID
    // This assumes logs are structured with mission_id in JSON or as a label
    const query = `{namespace="gibson", tenant_id="${tenantId}"} |~ "${missionId}"`;

    return this.query({
      query,
      start: options?.start,
      end: options?.end,
      limit: options?.limit || 200,
      direction: 'backward',
      tenantId,
    });
  }

  /**
   * Query logs for the Gibson daemon filtered by level
   */
  async queryDaemonLogs(
    tenantId: string,
    options?: {
      level?: 'error' | 'warn' | 'info' | 'debug';
      start?: Date;
      end?: Date;
      limit?: number;
      missionId?: string;
    }
  ): Promise<LokiLogEntry[]> {
    let query = `{namespace="gibson", pod=~"gibson-0.*", tenant_id="${tenantId}"}`;

    // Add level filter if specified
    if (options?.level) {
      const levelUpper = options.level.toUpperCase();
      query += ` |~ "level.*${levelUpper}|level=${levelUpper}|\\\"level\\\":\\\"${levelUpper}\\\""`;
    }

    // Add mission ID filter if specified
    if (options?.missionId) {
      query += ` |~ "${options.missionId}"`;
    }

    return this.query({
      query,
      start: options?.start,
      end: options?.end,
      limit: options?.limit || 100,
      direction: 'backward',
      tenantId,
    });
  }

  /**
   * Get available label values for a specific tenant
   */
  async getLabelValues(label: string, tenantId?: string): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/loki/api/v1/label/${label}/values`, {
      method: 'GET',
      headers: this.buildHeaders(tenantId),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Failed to get label values: ${response.status}`);
    }

    const result = await response.json();
    return result.data || [];
  }
}

// Export singleton instance
export const lokiClient = new LokiClient();
