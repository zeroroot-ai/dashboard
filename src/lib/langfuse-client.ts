/**
 * Server-side Langfuse REST API client.
 * Constructed per-request with tenant-specific credentials.
 * MUST NOT be imported by browser-side code.
 */

// Error types
export class LangfuseApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'LangfuseApiError';
  }
}

export class LangfuseUnavailableError extends LangfuseApiError {
  constructor(message: string) {
    super(message, 503, 'SERVICE_UNAVAILABLE');
    this.name = 'LangfuseUnavailableError';
  }
}

export class LangfuseAuthError extends LangfuseApiError {
  constructor() {
    super('Invalid Langfuse credentials', 401, 'UNAUTHORIZED');
    this.name = 'LangfuseAuthError';
  }
}

export class LangfuseNotFoundError extends LangfuseApiError {
  constructor(resource: string) {
    super(`${resource} not found in Langfuse`, 404, 'NOT_FOUND');
    this.name = 'LangfuseNotFoundError';
  }
}

// Raw Langfuse API response types (not exported to browser code)
export interface LangfuseTrace {
  id: string;
  name: string;
  timestamp: string;
  metadata: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  tags: string[];
  userId?: string;
  sessionId?: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  latency: number;
  observations: string[];
}

export interface LangfuseObservation {
  id: string;
  traceId: string;
  type: 'GENERATION' | 'SPAN' | 'EVENT';
  name: string;
  startTime: string;
  endTime?: string;
  parentObservationId?: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  level: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
  statusMessage?: string;
  modelParameters?: Record<string, unknown>;
}

interface LangfuseClientOptions {
  host: string;
  publicKey: string;
  secretKey: string;
}

/** Page envelope returned by the paginated trace-list endpoint. */
export interface LangfuseTracePage {
  data: LangfuseTrace[];
  meta: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  };
}

export class LangfuseClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(options: LangfuseClientOptions) {
    // Remove trailing slash from host
    this.baseUrl = options.host.replace(/\/+$/, '');
    // HTTP Basic Auth: base64(publicKey:secretKey)
    const credentials = Buffer.from(`${options.publicKey}:${options.secretKey}`).toString('base64');
    this.authHeader = `Basic ${credentials}`;
  }

  private async request<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      throw new LangfuseUnavailableError(
        `Failed to connect to Langfuse: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    if (response.status === 401) {
      throw new LangfuseAuthError();
    }

    if (response.status === 404) {
      throw new LangfuseNotFoundError(path);
    }

    if (!response.ok) {
      throw new LangfuseApiError(
        `Langfuse API error: ${response.statusText}`,
        response.status,
        'API_ERROR'
      );
    }

    // A 2xx response whose body is not valid JSON (a proxy HTML error page,
    // an empty body, a gateway interstitial) makes response.json() throw a
    // raw SyntaxError. Left unguarded it escapes the route's typed-error
    // handling and surfaces as the generic "something went wrong" 500 banner;
    // wrap it as a typed unavailable error so callers map it to a 503
    // instead (dashboard#515).
    try {
      return await response.json();
    } catch {
      throw new LangfuseUnavailableError(
        `Langfuse returned an unparseable response for ${path}`
      );
    }
  }

  /**
   * Fetch a trace by ID (metadata + stats)
   */
  async getTrace(traceId: string): Promise<LangfuseTrace> {
    return this.request<LangfuseTrace>(`/api/public/traces/${traceId}`);
  }

  /**
   * Fetch all observations for a trace, handling pagination.
   * Langfuse returns max ~100 observations per page.
   */
  async getObservations(traceId: string): Promise<LangfuseObservation[]> {
    const allObservations: LangfuseObservation[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const result = await this.request<{ data: LangfuseObservation[]; meta: { totalItems: number; page: number; totalPages: number } }>(
        `/api/public/observations?traceId=${encodeURIComponent(traceId)}&limit=100&page=${page}`
      );
      allObservations.push(...result.data);
      hasMore = page < result.meta.totalPages;
      page++;
    }

    return allObservations;
  }

  /**
   * Fetch a single observation's full detail (for on-demand content loading)
   */
  async getObservation(observationId: string): Promise<LangfuseObservation> {
    return this.request<LangfuseObservation>(`/api/public/observations/${observationId}`);
  }

  /**
   * List traces filtered by userId, newest first.
   */
  async listTraces(userId: string, limit = 5): Promise<LangfuseTrace[]> {
    const params = new URLSearchParams({
      userId,
      limit: String(limit),
      // Langfuse v3 expects orderBy as a single `column.DIRECTION` string
      // (DIRECTION ∈ ASC|DESC), e.g. `timestamp.DESC`. Neither the legacy
      // `orderBy=timestamp&order=DESC` pair nor a JSON object is accepted —
      // both 400 with a ZodError at path ["orderBy","order"].
      orderBy: 'timestamp.DESC',
    });
    const result = await this.request<{ data: LangfuseTrace[] }>(
      `/api/public/traces?${params.toString()}`,
    );
    return result.data ?? [];
  }

  /**
   * List traces in the project with pagination + optional filters, newest
   * first. Unlike {@link listTraces}, this does NOT constrain to a single
   * userId — project scoping comes from the credentials themselves, so this
   * returns every trace in the tenant's project. Returns the page envelope
   * (data + meta) so callers can drive pagination controls.
   */
  async listTracesPaged(opts: {
    page?: number;
    limit?: number;
    fromTimestamp?: string;
    toTimestamp?: string;
    name?: string;
    userId?: string;
    tags?: string[];
  }): Promise<LangfuseTracePage> {
    const params = new URLSearchParams({
      // Langfuse v3 expects orderBy as a single `column.DIRECTION` string
      // (DIRECTION ∈ ASC|DESC), e.g. `timestamp.DESC`. Neither the legacy
      // `orderBy=timestamp&order=DESC` pair nor a JSON object is accepted —
      // both 400 with a ZodError at path ["orderBy","order"].
      orderBy: 'timestamp.DESC',
    });
    if (opts.page != null) params.set('page', String(opts.page));
    if (opts.limit != null) params.set('limit', String(opts.limit));
    if (opts.fromTimestamp) params.set('fromTimestamp', opts.fromTimestamp);
    if (opts.toTimestamp) params.set('toTimestamp', opts.toTimestamp);
    if (opts.name) params.set('name', opts.name);
    if (opts.userId) params.set('userId', opts.userId);
    // Langfuse accepts a repeated `tags` param (AND semantics); a trace must
    // carry every requested tag to match.
    for (const tag of opts.tags ?? []) {
      if (tag) params.append('tags', tag);
    }

    const result = await this.request<{
      data: LangfuseTrace[];
      meta?: Partial<LangfuseTracePage['meta']>;
    }>(`/api/public/traces?${params.toString()}`);

    const data = result.data ?? [];
    const meta = result.meta ?? {};
    return {
      data,
      meta: {
        page: meta.page ?? opts.page ?? 1,
        limit: meta.limit ?? opts.limit ?? data.length,
        totalItems: meta.totalItems ?? data.length,
        totalPages: meta.totalPages ?? 1,
      },
    };
  }

  /**
   * Create a score (feedback) on a trace.
   * value: 1 = positive, 0 = negative.
   */
  async createScore(opts: {
    traceId: string;
    name: string;
    value: number;
    comment?: string;
  }): Promise<void> {
    await fetch(`${this.baseUrl}/api/public/scores`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(opts),
    });
  }
}
