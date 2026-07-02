/**
 * Per-request correlation ID for the auth path.
 *
 * Middleware injects `x-gibson-correlation-id` on every request that
 * passes through the matcher (generating a UUID v4 when the header is
 * absent). Server Components, route handlers, and Server Actions read
 * the value via `readCorrelationId()` and include it in:
 *
 *   - the `/login/error` page (shown to the user as an opaque ID for
 *     support to correlate against logs);
 *   - structured WARN/ERROR logs emitted on auth failures
 *     (`logAuthError`);
 *   - audit-event metadata when applicable.
 *
 * The ID is intentionally opaque, it does NOT reuse OTel trace IDs
 * (those are internal). It is HTTP-header-safe (UUID v4 hex with
 * hyphens, never quoted).
 *
 * Spec: auth-resolution-hardening (R2.5, R3.5).
 *
 * @module auth/correlation
 */

import 'server-only';

import { headers } from 'next/headers';
import { v4 as uuidv4 } from 'uuid';

export const CORRELATION_HEADER = 'x-gibson-correlation-id';

/**
 * Returns the correlation ID for the current request, falling back to
 * a freshly-generated UUID when the header is absent (e.g., requests
 * that bypass the middleware matcher, or Server Components running
 * outside a request scope during static generation).
 */
export async function readCorrelationId(): Promise<string> {
  try {
    const h = await headers();
    const existing = h.get(CORRELATION_HEADER);
    if (existing && existing.length > 0) return existing;
  } catch {
    // headers() throws outside a request scope (e.g., static prerender).
  }
  return generateCorrelationId();
}

/**
 * Generates a fresh correlation ID. Used by middleware when the header
 * isn't already on the incoming request, and by `readCorrelationId()`
 * as a defensive fallback.
 */
export function generateCorrelationId(): string {
  return uuidv4();
}
