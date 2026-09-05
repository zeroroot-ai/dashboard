/**
 * Correlation ID plumbing via AsyncLocalStorage.
 *
 * Provides a per-request correlation ID that propagates automatically across
 * awaited async boundaries within the same logical request context.
 *
 * NOTE (dashboard#818): an earlier design reused this UUID as a per-request CSP
 * nonce set in middleware.ts. The dashboard no longer emits a CSP from app code
 * (the nonce-CSP was removed in the zitadel-envoy-gateway-migration; see #863).
 * This ID now serves distributed tracing only.
 *
 * Usage:
 *   // In middleware / request entry-point:
 *   await withCorrelation(id, () => handler(req));
 *
 *   // Anywhere downstream (server actions, audit emitters, etc.):
 *   const id = getCorrelationId(); // returns stored id, or a fresh UUID
 */

import { AsyncLocalStorage } from "async_hooks";

const correlationStorage = new AsyncLocalStorage<string>();

/**
 * Run `fn` inside an AsyncLocalStorage context bound to `id`.
 * Awaits the result so the context is kept alive for the full async chain.
 */
export function withCorrelation<T>(
  id: string,
  fn: () => T | Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    correlationStorage.run(id, () => {
      try {
        Promise.resolve(fn()).then(resolve, reject);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Return the correlation ID stored in the current AsyncLocalStorage context.
 * When called outside any `withCorrelation` scope (e.g. background jobs,
 * test helpers), generates and returns a fresh UUID rather than throwing.
 */
export function getCorrelationId(): string {
  return correlationStorage.getStore() ?? crypto.randomUUID();
}
