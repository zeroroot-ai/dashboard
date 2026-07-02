/**
 * Embedding-provider gate detection (E11 BYO-embedder, gibson#810).
 *
 * Vector features (vector recall, GraphRAG, belief-RAG, finding classification)
 * require a configured embedding provider. When none is configured the daemon
 * returns a graceful "configure an embedding provider" error rather than a
 * bundled-embedder fallback (ADR-0059).
 *
 * The daemon raises this as a GibsonError with code NO_EMBEDDING_PROVIDER whose
 * message is passed through to the caller verbatim (see
 * internal/engine/memory/embedder/errors.go). The daemon's error-scrub
 * interceptor preserves the gRPC status code and the message for this error, so
 * the most robust client-side signal is the canonical message substring. We
 * match it case-insensitively and tolerate both the daemon's exact wording and
 * the shorter "configure an embedding provider" phrasing.
 *
 * Pure functions, no React/Connect dependency, so they can be unit tested and
 * reused by both server routes and client components.
 */

/**
 * The marker substrings the daemon's gate message is guaranteed to contain.
 * Either match classifies an error as the embedding-provider gate.
 */
const GATE_MARKERS = [
  'no embedding provider configured',
  'configure an embedding provider',
] as const;

/**
 * True when `message` is the daemon's "no embedding provider configured" gate.
 */
export function isEmbeddingGateMessage(message: string | undefined | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return GATE_MARKERS.some((m) => lower.includes(m));
}

/**
 * True when `err` (any thrown value — ConnectError, Error, plain object, or a
 * parsed `{ error: { message } }` API body) carries the embedding-provider
 * gate. Checks the common message-bearing shapes without importing Connect.
 */
export function isEmbeddingGateError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === 'string') return isEmbeddingGateMessage(err);

  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    // ConnectError / Error: `.message`; ConnectError also exposes `.rawMessage`.
    if (typeof o.message === 'string' && isEmbeddingGateMessage(o.message)) return true;
    if (typeof o.rawMessage === 'string' && isEmbeddingGateMessage(o.rawMessage)) return true;
    // API error envelopes: `{ error: "<message>" }` (graph routes) or
    // `{ error: { message } }` (api-errors helper / providers route).
    const nested = o.error;
    if (typeof nested === 'string' && isEmbeddingGateMessage(nested)) return true;
    if (nested && typeof nested === 'object') {
      const no = nested as Record<string, unknown>;
      if (typeof no.message === 'string' && isEmbeddingGateMessage(no.message)) return true;
    }
  }
  return false;
}
