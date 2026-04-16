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

    return response.json();
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
}
