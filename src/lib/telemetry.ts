/**
 * Telemetry Utilities
 * OpenTelemetry instrumentation with tenant context support
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Span-like interface for adding attributes
 */
interface SpanLike {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus?(status: { code: number; message?: string }): void;
  recordException?(error: Error): void;
  end?(): void;
}

/**
 * Structured log entry
 */
interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  tenantId?: string;
  userId?: string;
  attributes?: Record<string, unknown>;
}

// ============================================================================
// Tenant Context Utilities
// ============================================================================

/**
 * Adds tenant ID attribute to an OpenTelemetry span.
 *
 * @param span - The span to add the attribute to
 * @param tenantId - The tenant ID to add
 *
 * @example
 * const span = tracer.startSpan('operation');
 * addTenantToSpan(span, 'tenant-123');
 */
export function addTenantToSpan(span: SpanLike, tenantId: string): void {
  if (span && tenantId) {
    span.setAttribute('tenant.id', tenantId);
  }
}

/**
 * Adds multiple tenant-related attributes to a span.
 *
 * @param span - The span to add attributes to
 * @param context - Tenant context including ID and optional metadata
 */
export function addTenantContextToSpan(
  span: SpanLike,
  context: {
    tenantId: string;
    tenantName?: string;
    userId?: string;
    action?: string;
  }
): void {
  if (!span) return;

  if (context.tenantId) {
    span.setAttribute('tenant.id', context.tenantId);
  }
  if (context.tenantName) {
    span.setAttribute('tenant.name', context.tenantName);
  }
  if (context.userId) {
    span.setAttribute('user.id', context.userId);
  }
  if (context.action) {
    span.setAttribute('tenant.action', context.action);
  }
}

// ============================================================================
// Structured Logging with Tenant Context
// ============================================================================

/**
 * Creates a structured log entry with tenant context.
 *
 * @param level - Log level
 * @param message - Log message
 * @param tenantId - Optional tenant ID
 * @param attributes - Additional attributes
 * @returns Structured log entry
 */
export function createLogEntry(
  level: LogEntry['level'],
  message: string,
  tenantId?: string,
  attributes?: Record<string, unknown>
): LogEntry {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    tenantId,
    attributes,
  };
}

/**
 * Logger instance with tenant context support
 */
export const tenantLogger = {
  /**
   * Log a debug message
   */
  debug(message: string, tenantId?: string, attributes?: Record<string, unknown>): void {
    const entry = createLogEntry('debug', message, tenantId, attributes);
    if (process.env.NODE_ENV === 'development') {
      console.debug('[Tenant]', entry);
    }
  },

  /**
   * Log an info message
   */
  info(message: string, tenantId?: string, attributes?: Record<string, unknown>): void {
    const entry = createLogEntry('info', message, tenantId, attributes);
    console.info('[Tenant]', entry);
  },

  /**
   * Log a warning message
   */
  warn(message: string, tenantId?: string, attributes?: Record<string, unknown>): void {
    const entry = createLogEntry('warn', message, tenantId, attributes);
    console.warn('[Tenant]', entry);
  },

  /**
   * Log an error message
   */
  error(
    message: string,
    error?: Error,
    tenantId?: string,
    attributes?: Record<string, unknown>
  ): void {
    const entry = createLogEntry('error', message, tenantId, {
      ...attributes,
      error: error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : undefined,
    });
    console.error('[Tenant]', entry);
  },
};

// ============================================================================
// Tenant Switch Tracking
// ============================================================================

/**
 * Track a tenant switch event for analytics.
 *
 * @param fromTenantId - Previous tenant ID
 * @param toTenantId - New tenant ID
 * @param userId - User performing the switch
 */
export function trackTenantSwitch(
  fromTenantId: string | null,
  toTenantId: string,
  userId?: string
): void {
  tenantLogger.info('Tenant switch', toTenantId, {
    fromTenantId,
    toTenantId,
    userId,
    action: 'switch',
  });

  // In production, this would send to analytics
  // Example: analytics.track('tenant_switch', { fromTenantId, toTenantId, userId });
}

// ============================================================================
// Error Tracking with Tenant Context
// ============================================================================

/**
 * Track an error with tenant context.
 *
 * @param error - The error to track
 * @param tenantId - Current tenant ID
 * @param context - Additional context
 */
export function trackTenantError(
  error: Error,
  tenantId?: string,
  context?: {
    userId?: string;
    action?: string;
    component?: string;
  }
): void {
  tenantLogger.error('Tenant error occurred', error, tenantId, {
    ...context,
    errorType: error.name,
  });

  // In production, this would send to error tracking
  // Example: Sentry.captureException(error, { tags: { tenantId }, extra: context });
}

// ============================================================================
// Performance Tracking
// ============================================================================

/**
 * Measures the duration of an async operation with tenant context.
 *
 * @param name - Operation name
 * @param tenantId - Tenant ID
 * @param operation - Async operation to measure
 * @returns Operation result
 */
export async function measureTenantOperation<T>(
  name: string,
  tenantId: string,
  operation: () => Promise<T>
): Promise<T> {
  const startTime = performance.now();

  try {
    const result = await operation();
    const duration = performance.now() - startTime;

    tenantLogger.debug(`Operation ${name} completed`, tenantId, {
      duration: `${duration.toFixed(2)}ms`,
      success: true,
    });

    return result;
  } catch (error) {
    const duration = performance.now() - startTime;

    tenantLogger.error(
      `Operation ${name} failed`,
      error instanceof Error ? error : new Error(String(error)),
      tenantId,
      {
        duration: `${duration.toFixed(2)}ms`,
        success: false,
      }
    );

    throw error;
  }
}

// ============================================================================
// Middleware Helpers
// ============================================================================

/**
 * Extracts tenant context from request headers for span annotation.
 *
 * This helper is for observability enrichment (span attributes) only — it is
 * NOT an authorization gate. API route handlers that need a tenant ID for an
 * RPC must call `requireActiveTenant()` from `@/src/lib/auth/active-tenant`
 * directly; this function must not be used as a substitute.
 *
 * The `x-tenant-id` header is an internal tracing header set by Envoy when
 * routing a request, not a trust boundary. No authorization decision may be
 * based on it.
 *
 * @param headers - Request headers (for internal `x-tenant-id` tracing header)
 * @returns Tenant ID string from the tracing header, or null
 */
export function extractTenantFromRequest(
  headers: Headers,
): string | null {
  const headerTenantId = headers.get('x-tenant-id');
  if (headerTenantId) {
    return headerTenantId;
  }

  return null;
}

// ============================================================================
// Prometheus Metrics Helpers
// ============================================================================

/**
 * Creates a metric label set with tenant ID.
 *
 * @param tenantId - Tenant ID for the label
 * @param additionalLabels - Additional labels to include
 * @returns Label set for Prometheus metrics
 */
export function createTenantMetricLabels(
  tenantId: string,
  additionalLabels?: Record<string, string>
): Record<string, string> {
  return {
    tenant_id: tenantId,
    ...additionalLabels,
  };
}

/**
 * Formats a metric name with tenant prefix.
 *
 * @param baseName - Base metric name
 * @returns Formatted metric name
 */
export function formatTenantMetricName(baseName: string): string {
  return `gibson_tenant_${baseName}`;
}
