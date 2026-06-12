/**
 * Canonical ConnectError → HTTP error response mapping for every
 * app/api route handler (every `app/api/<path>/route.ts`).
 *
 * Replaces the legacy generic safeErrorResponse pattern that returned
 * 500 + a hardcoded "Failed to ..." string. Every dashboard API route
 * surfaces a daemon gRPC failure as the SAME shape, with:
 *
 *   - one stable user-facing message per ConnectError class,
 *   - one stable HTTP status per ConnectError class,
 *   - a per-request correlation ID exposed both in the response body
 *     (so the error-state UI can render it copy-pasteable) and in the
 *     `x-correlation-id` response header (so support / log search can
 *     match against the daemon's structured log).
 *
 * The 9-class table below is the canonical contract. Routes never invent
 * their own copy. The correlation ID format is `req-<base32 of uuid7>`,
 * which matches the daemon's structured-log convention.
 *
 * Spec: deploy#207 (epic one-code-path M11, "kill safeErrorResponse").
 *
 * @module lib/api-errors
 */
import { NextResponse } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';
import { v7 as uuidv7 } from 'uuid';
import { type ZodError } from 'zod';
import { logger as defaultLogger } from '@/src/lib/logger';

// ---------------------------------------------------------------------------
// Correlation ID
// ---------------------------------------------------------------------------

/**
 * HTTP header name used by the dashboard to forward / surface the
 * per-request correlation ID.
 *
 * The daemon emits a `correlation_id` field in its structured log for
 * every RPC invocation; the request-correlation interceptor forwards
 * the same value back as a gRPC response header. When this header is
 * present on the incoming `Headers` we propagate it verbatim;
 * otherwise we mint a fresh ID at the dashboard's API edge so the
 * dashboard log line and the downstream daemon log line share an ID.
 */
export const CORRELATION_HEADER = 'x-correlation-id';

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Encode a 16-byte UUID v7 into Crockford-style base32 (no padding,
 * no ambiguous chars). Output is always 26 characters long, prefixed
 * with `req-` so it is grep-friendly in logs.
 *
 * Example: `req-01HX5K8ZW9P3T7V0XYZ7N6Q4D8`
 */
export function generateCorrelationId(): string {
  const uuid = uuidv7();
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  // Encode 16 bytes (128 bits) → 26 base32 chars (130 bits, last 2 zero-padded).
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD_BASE32[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += CROCKFORD_BASE32[(value << (5 - bits)) & 0x1f];
  }
  return `req-${out}`;
}

/**
 * Read the correlation ID for an inbound request, falling back to a
 * freshly minted one when no upstream component supplied it.
 *
 * Accepts either a `Headers` object (from `NextRequest.headers`) or a
 * plain header bag.
 */
export function correlationIdFromRequest(
  headers: Headers | Record<string, string | string[] | undefined> | undefined,
): string {
  if (!headers) return generateCorrelationId();
  let raw: string | string[] | null | undefined;
  if (typeof (headers as Headers).get === 'function') {
    raw = (headers as Headers).get(CORRELATION_HEADER);
  } else {
    const bag = headers as Record<string, string | string[] | undefined>;
    raw =
      bag[CORRELATION_HEADER] ??
      bag[CORRELATION_HEADER.toUpperCase()] ??
      bag['X-Correlation-Id'];
  }
  if (Array.isArray(raw)) raw = raw[0];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return generateCorrelationId();
}

// ---------------------------------------------------------------------------
// Canonical 9-class mapping
// ---------------------------------------------------------------------------

/**
 * One of the 10 canonical error classes the dashboard surfaces.
 *
 * Every ConnectError code from the daemon maps to exactly one of
 * these. Every API route returns one of these shapes (or 2xx + body).
 * The error-state UI uses `class` to drive the affordance (retry,
 * sign-in link, upgrade link, ...).
 *
 * `provisioning` is a sub-classification of `failed_precondition`:
 * it fires when the daemon message matches the data-plane-not-yet-
 * provisioned pattern, surfaces HTTP 503 instead of 412, and adds
 * a `Retry-After: 30` response header so the client can auto-retry.
 */
export type ErrorClass =
  | 'unauthenticated'
  | 'permission_denied'
  | 'not_found'
  | 'failed_precondition'
  | 'provisioning'
  | 'resource_exhausted'
  | 'unavailable'
  | 'deadline_exceeded'
  | 'invalid_argument'
  | 'internal';

export interface ErrorClassEntry {
  /** Stable machine-readable class name. */
  class: ErrorClass;
  /** HTTP status the route returns. */
  httpStatus: number;
  /** Default user-facing message, exactly one per class. */
  message: string;
  /** Affordance the error-state UI should render. */
  affordance:
    | 'sign_in'
    | 'back_to_dashboard'
    | 'retry'
    | 'retry_with_support'
    | 'upgrade'
    | 'status_page'
    | 'contact_support';
  /**
   * Whether the daemon's underlying error message is safe to surface.
   * For most classes the canonical copy is preferred; for
   * InvalidArgument we forward the daemon's message because the
   * caller (e.g. a form submission) wants the precise field name.
   */
  preferDaemonMessage?: boolean;
}

/**
 * The canonical contract. Every routing decision in this file branches
 * exclusively on this table, adding or repricing a class is a single
 * source-of-truth edit.
 *
 * Wording rules:
 *   - Warm and actionable, never panicked.
 *   - Never say "Failed to load", that was the old anti-pattern.
 *   - The error-state component appends the correlation ID; copy
 *     here does not need to.
 */
export const ERROR_CLASS_TABLE: Record<ErrorClass, ErrorClassEntry> = {
  unauthenticated: {
    class: 'unauthenticated',
    httpStatus: 401,
    message: 'Your session has expired. Please sign in again to continue.',
    affordance: 'sign_in',
  },
  permission_denied: {
    class: 'permission_denied',
    httpStatus: 403,
    message: "You don't have access to this resource.",
    affordance: 'back_to_dashboard',
  },
  not_found: {
    class: 'not_found',
    httpStatus: 404,
    message:
      "We couldn't find what you were looking for. It may have been removed, or you may not have access.",
    affordance: 'back_to_dashboard',
  },
  failed_precondition: {
    class: 'failed_precondition',
    httpStatus: 412,
    // Warm + actionable per the slice's UX note. Avoids panic words
    // ("error", "failed", "broken") and gives the user a next step.
    message:
      "Your account is still finishing setup. A few features may be unavailable for another moment, please try again shortly. If this keeps happening, share the reference below with support.",
    affordance: 'retry_with_support',
  },
  provisioning: {
    class: 'provisioning',
    httpStatus: 503,
    // Distinct from the general failed_precondition message: this fires
    // specifically when the tenant data-plane saga has not completed yet.
    // "workspace" is the customer-facing term; avoids "data-plane" jargon.
    message:
      'Your workspace is being set up, this usually takes a few minutes. Refresh to check progress.',
    affordance: 'retry',
  },
  resource_exhausted: {
    class: 'resource_exhausted',
    httpStatus: 429,
    message:
      "You've reached your plan's request limit. Wait a moment and try again, or upgrade your plan for higher limits.",
    affordance: 'upgrade',
  },
  unavailable: {
    class: 'unavailable',
    httpStatus: 503,
    message:
      "Our backend is briefly unavailable. We're already on it, please try again in a moment.",
    affordance: 'status_page',
  },
  deadline_exceeded: {
    class: 'deadline_exceeded',
    httpStatus: 504,
    message: 'That request took longer than expected. Please try again.',
    affordance: 'retry',
  },
  invalid_argument: {
    class: 'invalid_argument',
    httpStatus: 400,
    message: 'Your request was missing information or had an invalid value.',
    affordance: 'retry',
    preferDaemonMessage: true,
  },
  internal: {
    class: 'internal',
    httpStatus: 500,
    message:
      "Something went wrong on our end. Our team has been notified, please share the reference below with support if this keeps happening.",
    affordance: 'contact_support',
  },
};

/**
 * Map a `@connectrpc/connect` `Code` to its canonical class.
 *
 * `Code.OK` (and any unrecognised code) is mapped to `internal`
 * defensively so a misuse never returns a 200-shaped error body.
 */
export function classifyConnectCode(code: Code): ErrorClass {
  switch (code) {
    case Code.Unauthenticated:
      return 'unauthenticated';
    case Code.PermissionDenied:
      return 'permission_denied';
    case Code.NotFound:
      return 'not_found';
    case Code.FailedPrecondition:
    case Code.Aborted:
      // Aborted is "concurrent precondition mismatch", surface the
      // same retry-soon affordance as FailedPrecondition.
      return 'failed_precondition';
    case Code.ResourceExhausted:
      return 'resource_exhausted';
    case Code.Unavailable:
      return 'unavailable';
    case Code.DeadlineExceeded:
      return 'deadline_exceeded';
    case Code.InvalidArgument:
    case Code.OutOfRange:
    case Code.AlreadyExists:
      return 'invalid_argument';
    case Code.Internal:
    case Code.Unimplemented:
    case Code.DataLoss:
    case Code.Unknown:
    case Code.Canceled:
    default:
      return 'internal';
  }
}

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

/**
 * Canonical error response body shape. Every error response from
 * `app/api/<path>/route.ts` matches this shape, the client-side
 * error-state component can render any error consistently.
 */
export interface ApiErrorBody {
  error: {
    /** Canonical class name (see `ErrorClass`). */
    class: ErrorClass;
    /** Stable, user-renderable message. */
    message: string;
    /** Affordance the UI should render (retry, sign_in, etc.). */
    affordance: ErrorClassEntry['affordance'];
    /**
     * Per-request correlation ID. ALSO surfaced as the
     * `x-correlation-id` response header.
     */
    correlationId: string;
  };
}

interface DaemonErrorOptions {
  /**
   * Incoming request headers, used to forward an upstream
   * correlation ID when one is present. If omitted, a fresh ID is
   * minted at this edge.
   */
  headers?: Headers | Record<string, string | string[] | undefined>;
  /** Explicit correlation ID, overriding `headers`. */
  correlationId?: string;
  /**
   * Optional logging hook; defaults to the canonical pino logger.
   * Tests use this to capture log calls without needing to mock the
   * shared logger module.
   */
  log?: (record: {
    class: ErrorClass;
    httpStatus: number;
    code?: Code;
    correlationId: string;
    detail: string;
  }) => void;
  /**
   * When true (development-only), include the daemon's underlying
   * error message in the response body under `error.detail`. This is
   * never set in production.
   */
  exposeDetail?: boolean;
  /**
   * Optional logical route label to include in log lines so the same
   * correlation ID can be traced back to the originating handler.
   */
  route?: string;
}

/**
 * Convert an unknown error caught at a route boundary into a
 * canonical `NextResponse`. This is the ONLY helper API routes
 * should use to emit a non-2xx response.
 *
 * Usage:
 *
 *   try {
 *     const data = await listMissions(...);
 *     return NextResponse.json({ data });
 *   } catch (err) {
 *     return daemonErrorResponse(err, { headers: request.headers });
 *   }
 */
export function daemonErrorResponse(
  err: unknown,
  options: DaemonErrorOptions = {},
): NextResponse<ApiErrorBody> {
  const correlationId =
    options.correlationId ?? correlationIdFromRequest(options.headers);

  let cls: ErrorClass;
  let daemonCode: Code | undefined;
  let detail: string;

  if (err instanceof ConnectError) {
    cls = classifyConnectCode(err.code);
    daemonCode = err.code;
    // `ConnectError#message` prepends `[code]` for readability; the
    // raw underlying message is what we want to log + (in the
    // InvalidArgument case) surface to the user.
    detail = err.rawMessage;
    // Distinguish provisioning-in-progress from other precondition
    // failures. The daemon emits this exact message when the
    // DataPlaneProvisioned saga step is still running or has
    // permanently failed for a tenant.
    if (cls === 'failed_precondition' && /tenant data.?plane not provisioned/i.test(detail)) {
      cls = 'provisioning';
    }
  } else if (err instanceof Error) {
    cls = 'internal';
    detail = err.message;
  } else {
    cls = 'internal';
    detail = String(err);
  }

  const entry = ERROR_CLASS_TABLE[cls];

  if (options.log) {
    options.log({
      class: cls,
      httpStatus: entry.httpStatus,
      code: daemonCode,
      correlationId,
      detail,
    });
  } else {
    defaultLogger.error(
      {
        errorClass: cls,
        httpStatus: entry.httpStatus,
        grpcCode: daemonCode,
        correlationId,
        detail,
        route: options.route,
      },
      'dashboard route returned canonical error',
    );
  }

  let message = entry.message;
  if (entry.preferDaemonMessage && detail && err instanceof ConnectError) {
    // For InvalidArgument we forward the daemon's message because
    // it identifies the offending field (the canonical copy is too
    // generic to be actionable for forms).
    message = detail;
  }

  const body: ApiErrorBody = {
    error: {
      class: cls,
      message,
      affordance: entry.affordance,
      correlationId,
    },
  };

  // Development-only: expose the underlying detail so engineers can
  // diagnose without scraping the server log. Default off; never
  // active in production (process.env.NODE_ENV is "production").
  if (options.exposeDetail && process.env.NODE_ENV !== 'production') {
    (body.error as ApiErrorBody['error'] & { detail?: string }).detail = detail;
  }

  const responseHeaders: Record<string, string> = { [CORRELATION_HEADER]: correlationId };
  if (cls === 'provisioning') {
    // Hint to the client that it can retry after 30 seconds; the
    // data-plane saga typically completes within that window.
    responseHeaders['Retry-After'] = '30';
  }

  return NextResponse.json(body, {
    status: entry.httpStatus,
    headers: responseHeaders,
  });
}

/**
 * Build a 400 response from a Zod validation error, returning per-field
 * error messages so the client can display inline feedback.
 *
 * Retained for backwards compatibility with form-handling routes that
 * already validated with Zod. New routes should prefer the daemon's
 * own InvalidArgument response path (which surfaces field info via
 * `error.detail` and is routed through `daemonErrorResponse`).
 */
export function validationErrorResponse(
  zodError: ZodError,
  options: DaemonErrorOptions = {},
): NextResponse {
  const correlationId =
    options.correlationId ?? correlationIdFromRequest(options.headers);
  const entry = ERROR_CLASS_TABLE.invalid_argument;
  return NextResponse.json(
    {
      error: {
        class: entry.class,
        message: entry.message,
        affordance: entry.affordance,
        correlationId,
        fields: zodError.flatten().fieldErrors,
      },
    },
    {
      status: entry.httpStatus,
      headers: { [CORRELATION_HEADER]: correlationId },
    },
  );
}

// ---------------------------------------------------------------------------
// 2xx helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a successful response so the correlation ID also flows on
 * happy-path responses. Crucial for client-side tracing, the same
 * ID lets a user file a ticket about "this loaded but looked wrong".
 *
 * If you need an empty-state ("no results yet"), return a 200 with
 * `{ data: [] }`, the client-side hooks distinguish empty-state
 * (200 + empty array) from error-state (non-200) on the HTTP status.
 */
export function okResponse<T>(
  body: T,
  options: { headers?: Headers; correlationId?: string } = {},
): NextResponse<T> {
  const correlationId =
    options.correlationId ?? correlationIdFromRequest(options.headers);
  return NextResponse.json(body, {
    status: 200,
    headers: { [CORRELATION_HEADER]: correlationId },
  });
}

// ---------------------------------------------------------------------------
// Legacy export
// ---------------------------------------------------------------------------

// DEPRECATED. Use daemonErrorResponse instead.
//
// The legacy safeErrorResponse(error, "Failed to load", 500) pattern
// collapsed every daemon failure to a generic 500 with no correlation
// ID, no affordance, no class, which is the anti-pattern this module
// exists to delete. This shim routes through the canonical mapper so
// any straggling caller still gets a correlation ID and a real class,
// but every callsite is expected to migrate to daemonErrorResponse.
// The CI policy guard rejects new callsites outside this module.
//
// @deprecated Migrate to daemonErrorResponse(err, { headers }).
export function safeErrorResponse(
  error: unknown,
  _fallbackMessage: string,
  _status: number = 500,
): NextResponse {
  return daemonErrorResponse(error);
}
